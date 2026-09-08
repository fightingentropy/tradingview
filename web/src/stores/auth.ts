import { createMemo, createRoot, createSignal } from "solid-js";
import { api } from "../../convex/_generated/api";
import { convex, convexPublic, createConvexQuery } from "../lib/convex";

type AuthUser = {
  email: string;
  name?: string;
};

type AuthSession = {
  token: string;
  expiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
  deviceId: string;
  user: AuthUser;
};

const STORAGE_KEY = "trade_xyz_auth_session";
const DEVICE_STORAGE_KEY = "trade_xyz_device_id";
const REFRESH_EARLY_MS = 60_000;

const signInRef = api.auth.signIn;
const signUpRef = api.auth.signUp;
const refreshSessionRef = api.auth.refreshSession;
const currentUserRef = api.users.getCurrentUser;

const {
  authReady,
  isAuthenticated,
  authUser,
  isAdmin,
  adminReady,
  authOpen,
  authLoading,
  authError,
  login,
  logout,
  closeAuth,
  clearAuthError,
  signIn,
  signUp,
} = createRoot(() => {
  const [authReady, setAuthReady] = createSignal(false);
  const [isAuthenticated, setIsAuthenticated] = createSignal(false);
  const [authUser, setAuthUser] = createSignal<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = createSignal(false);
  const [authLoading, setAuthLoading] = createSignal(false);
  const [authError, setAuthError] = createSignal<string | null>(null);
  const [, setAuthToken] = createSignal<string | null>(null);
  const [, setAuthExpiresAt] = createSignal<number | null>(null);
  const currentUserQuery = createConvexQuery(currentUserRef, () =>
    isAuthenticated() ? {} : null,
  );
  const adminReady = createMemo(() => {
    if (!isAuthenticated()) return true;
    return currentUserQuery() !== undefined;
  });
  const isAdmin = createMemo(() => !!currentUserQuery()?.isAdmin);
  let refreshInFlight: Promise<AuthSession | null> | null = null;

  const getDeviceId = () => {
    if (typeof window === "undefined") return "server_render_device";
    const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
    const deviceId = crypto.randomUUID().replaceAll("-", "");
    window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
    return deviceId;
  };

  const readSession = (): AuthSession | null => {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AuthSession;
      if (
        !parsed?.token ||
        !parsed?.expiresAt ||
        !parsed?.refreshToken ||
        !parsed?.refreshExpiresAt ||
        !parsed?.deviceId ||
        !parsed?.user?.email
      ) {
        return null;
      }
      return parsed;
    } catch (error) {
      console.warn("Failed to parse auth session:", error);
      return null;
    }
  };

  const writeSession = (session: AuthSession) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  };

  const clearSession = () => {
    setAuthToken(null);
    setAuthExpiresAt(null);
    setIsAuthenticated(false);
    setAuthUser(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const refreshStoredSession = async (session: AuthSession) => {
    if (!refreshInFlight) {
      refreshInFlight = convexPublic
        .action(refreshSessionRef, {
          refreshToken: session.refreshToken,
          deviceId: session.deviceId,
        })
        .then((refreshed) => {
          if (!refreshed?.token || refreshed.deviceId !== session.deviceId) {
            return null;
          }
          setAuthToken(refreshed.token);
          setAuthExpiresAt(refreshed.expiresAt);
          setAuthUser(refreshed.user);
          setIsAuthenticated(true);
          writeSession(refreshed);
          return refreshed;
        })
        .catch(() => null)
        .finally(() => {
          refreshInFlight = null;
        });
    }
    return await refreshInFlight;
  };

  const getValidToken = async () => {
    const session = readSession();
    if (!session) return null;
    const now = Date.now();
    if (session.expiresAt - now > REFRESH_EARLY_MS) return session.token;
    if (session.refreshExpiresAt > now) {
      const refreshed = await refreshStoredSession(session);
      if (refreshed) return refreshed.token;
    }
    if (session.expiresAt > Date.now()) return session.token;
    clearSession();
    return null;
  };

  const attachConvexAuth = () => {
    convex.setAuth(getValidToken);
  };

  const ensureBackendUser = async (retries = 8, baseDelayMs = 200) => {
    if (!isAuthenticated()) return;
    // Verify token is available before making authenticated request
    const token = await getValidToken();
    if (!token) {
      console.warn("Token not available for ensureBackendUser");
      return;
    }

    // Give Convex time to establish the authenticated connection
    // after setAuth() is called
    await new Promise((resolve) => setTimeout(resolve, 300));

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await convex.mutation(api.users.ensureUser, {});
        return; // Success, exit
      } catch (error) {
        const isAuthError =
          error instanceof Error && error.message.includes("Not authenticated");

        if (isAuthError && attempt < retries - 1) {
          // Auth not ready yet, wait and retry with exponential backoff
          const delay = baseDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Non-auth error or final attempt
        console.error("Failed to initialize user:", error);
        return;
      }
    }
  };

  const applySession = async (session: AuthSession) => {
    setAuthToken(session.token);
    setAuthExpiresAt(session.expiresAt);
    setAuthUser(session.user);
    setIsAuthenticated(true);
    writeSession(session);
    attachConvexAuth();
    await ensureBackendUser();
  };

  const initAuth = async () => {
    const session = readSession();
    if (session && session.refreshExpiresAt > Date.now()) {
      setAuthToken(session.token);
      setAuthExpiresAt(session.expiresAt);
      setAuthUser(session.user);
      setIsAuthenticated(true);
      attachConvexAuth();
      if (await getValidToken()) {
        // ensureBackendUser has retry logic to wait for Convex auth to be ready
        await ensureBackendUser();
      } else {
        clearSession();
      }
    } else {
      clearSession();
      attachConvexAuth();
    }
    setAuthReady(true);
  };

  const login = () => {
    setAuthError(null);
    setAuthOpen(true);
  };

  const closeAuth = () => {
    setAuthError(null);
    setAuthOpen(false);
  };

  const clearAuthError = () => {
    setAuthError(null);
  };

  const signIn = async ({
    email,
    password,
  }: {
    email: string;
    password: string;
  }) => {
    if (!email.trim() || !password.trim()) {
      setAuthError("Email and password are required.");
      return false;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const session = (await convexPublic.action(signInRef, {
        email,
        password,
        deviceId: getDeviceId(),
      })) as AuthSession;
      if (!session?.token) {
        throw new Error("Sign in failed.");
      }
      await applySession(session);
      setAuthOpen(false);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sign in failed.";
      setAuthError(message);
      return false;
    } finally {
      setAuthLoading(false);
    }
  };

  const signUp = async ({
    email,
    password,
    name,
    turnstileToken,
  }: {
    email: string;
    password: string;
    name?: string;
    turnstileToken?: string;
  }) => {
    if (!email.trim() || !password.trim()) {
      setAuthError("Email and password are required.");
      return false;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const session = (await convexPublic.action(signUpRef, {
        email,
        password,
        name,
        deviceId: getDeviceId(),
        turnstileToken,
      })) as AuthSession;
      if (!session?.token) {
        throw new Error("Sign up failed.");
      }
      await applySession(session);
      setAuthOpen(false);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sign up failed.";
      setAuthError(message);
      return false;
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    // Best-effort: revoke server-side sessions before clearing local state.
    try {
      if (await getValidToken()) {
        await convex.mutation(api.users.revokeSessions, {});
      }
    } catch (error) {
      console.warn("Failed to revoke sessions on logout:", error);
    }
    clearSession();
    attachConvexAuth();
  };

  void initAuth();

  return {
    authReady,
    isAuthenticated,
    authUser,
    isAdmin,
    adminReady,
    authOpen,
    authLoading,
    authError,
    login,
    logout,
    closeAuth,
    clearAuthError,
    signIn,
    signUp,
  };
});

export {
  authReady,
  isAuthenticated,
  authUser,
  isAdmin,
  adminReady,
  authOpen,
  authLoading,
  authError,
  login,
  logout,
  closeAuth,
  clearAuthError,
  signIn,
  signUp,
};
