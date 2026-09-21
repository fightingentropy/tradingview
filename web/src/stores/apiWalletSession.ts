import { createSignal } from "solid-js";
import type { VaultPayload } from "./apiWalletVault";

type PasskeyRequirement = "every-refresh" | "five-minutes" | "one-hour";

type StoredPasskeyRequirement = {
  version: 1;
  requirement: PasskeyRequirement;
};

type StoredSessionHandle = {
  version: 1;
  sessionId: string;
};

type StoredHandoff = {
  version: 1;
  sessionId: string;
  handoffToken: string;
};

type WorkerResponse = {
  type:
    | "cache-result"
    | "commit-result"
    | "restore-result"
    | "revoke-vault-result";
  requestId: string;
  ok?: boolean;
  payload?: VaultPayload | null;
};

type PendingRequest = {
  resolve: (response: WorkerResponse | null) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type ExtendedSharedWorkerOptions = WorkerOptions & {
  extendedLifetime?: boolean;
};

const PASSKEY_REQUIREMENT_STORAGE_KEY =
  "trade-xyz-api-wallet-passkey-requirement";
const SESSION_HANDLE_STORAGE_KEY = "trade-xyz-api-wallet-session-v1";
const HANDOFF_STORAGE_KEY = "trade-xyz-api-wallet-handoff-v1";
const SHARED_WORKER_NAME = "trade-xyz-api-wallet-session-v1";
const REQUEST_TIMEOUT_MS = 2_500;
const SESSION_ID_PATTERN = /^[0-9a-f]{64}$/u;
const HANDOFF_TOKEN_PATTERN = /^[0-9a-f]{64}$/u;
const DEFAULT_PASSKEY_REQUIREMENT: PasskeyRequirement = "one-hour";

const PASSKEY_REQUIREMENT_DURATIONS: Record<PasskeyRequirement, number> = {
  "every-refresh": 0,
  "five-minutes": 5 * 60_000,
  "one-hour": 60 * 60_000,
};

const isPasskeyRequirement = (value: unknown): value is PasskeyRequirement =>
  value === "every-refresh" || value === "five-minutes" || value === "one-hour";

const parseStoredPasskeyRequirement = (
  raw: string | null,
): PasskeyRequirement => {
  if (raw === null) return DEFAULT_PASSKEY_REQUIREMENT;
  try {
    const value = JSON.parse(raw) as Partial<StoredPasskeyRequirement>;
    return value.version === 1 && isPasskeyRequirement(value.requirement)
      ? value.requirement
      : "every-refresh";
  } catch {
    return "every-refresh";
  }
};

const persistPasskeyRequirement = (
  storage: Pick<Storage, "setItem">,
  value: PasskeyRequirement,
): boolean => {
  try {
    const stored: StoredPasskeyRequirement = {
      version: 1,
      requirement: value,
    };
    storage.setItem(PASSKEY_REQUIREMENT_STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
};

const readPasskeyRequirement = (
  storage: Pick<Storage, "getItem">,
): PasskeyRequirement => {
  try {
    return parseStoredPasskeyRequirement(
      storage.getItem(PASSKEY_REQUIREMENT_STORAGE_KEY),
    );
  } catch {
    return "every-refresh";
  }
};

const loadPasskeyRequirement = (): PasskeyRequirement => {
  if (typeof window === "undefined") return DEFAULT_PASSKEY_REQUIREMENT;
  try {
    return readPasskeyRequirement(window.localStorage);
  } catch {
    return "every-refresh";
  }
};

const [passkeyRequirement, setPasskeyRequirementSignal] =
  createSignal<PasskeyRequirement>(loadPasskeyRequirement());

let sharedWorker: SharedWorker | null | undefined;
let sharedWorkerUnavailableReason: "unsupported" | "failed" | null = null;
let requestSequence = 0;
let activeSessionId: string | null = null;
const pendingRequests = new Map<string, PendingRequest>();

const randomCapability = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  try {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } finally {
    bytes.fill(0);
  }
};

const settlePendingRequests = () => {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timeout);
    pending.resolve(null);
  }
  pendingRequests.clear();
};

const getSharedWorker = (): SharedWorker | null => {
  if (sharedWorker !== undefined) return sharedWorker;
  if (typeof window === "undefined" || typeof SharedWorker === "undefined") {
    sharedWorkerUnavailableReason = "unsupported";
    sharedWorker = null;
    return sharedWorker;
  }
  try {
    const worker = new SharedWorker(
      new URL("./apiWalletSession.shared.ts", import.meta.url),
      {
        name: SHARED_WORKER_NAME,
        type: "module",
        extendedLifetime: true,
      } as ExtendedSharedWorkerOptions,
    );
    worker.port.addEventListener("message", (event: MessageEvent) => {
      const response = event.data as Partial<WorkerResponse>;
      if (
        typeof response.requestId !== "string" ||
        (response.type !== "cache-result" &&
          response.type !== "commit-result" &&
          response.type !== "restore-result" &&
          response.type !== "revoke-vault-result")
      ) {
        return;
      }
      const pending = pendingRequests.get(response.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingRequests.delete(response.requestId);
      pending.resolve(response as WorkerResponse);
    });
    worker.addEventListener("error", () => {
      if (sharedWorker === worker) {
        sharedWorker = undefined;
        sharedWorkerUnavailableReason = "failed";
      }
      worker.port.close();
      settlePendingRequests();
    });
    worker.port.start();
    sharedWorkerUnavailableReason = null;
    sharedWorker = worker;
    return worker;
  } catch {
    sharedWorkerUnavailableReason = "failed";
    sharedWorker = null;
    return sharedWorker;
  }
};

const requestWorker = (
  message: Record<string, unknown>,
): Promise<WorkerResponse | null> => {
  const worker = getSharedWorker();
  if (!worker) return Promise.resolve(null);
  const requestId = `${Date.now().toString(36)}-${(requestSequence += 1)}`;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve(null);
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, timeout });
    try {
      worker.port.postMessage({ ...message, requestId });
    } catch {
      clearTimeout(timeout);
      pendingRequests.delete(requestId);
      resolve(null);
    }
  });
};

const readSessionHandle = (): StoredSessionHandle | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_HANDLE_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSessionHandle>;
    if (
      value.version !== 1 ||
      typeof value.sessionId !== "string" ||
      !SESSION_ID_PATTERN.test(value.sessionId)
    ) {
      window.sessionStorage.removeItem(SESSION_HANDLE_STORAGE_KEY);
      return null;
    }
    activeSessionId = value.sessionId;
    return value as StoredSessionHandle;
  } catch {
    return null;
  }
};

const writeSessionHandle = (handle: StoredSessionHandle): boolean => {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(
      SESSION_HANDLE_STORAGE_KEY,
      JSON.stringify(handle),
    );
    activeSessionId = handle.sessionId;
    return true;
  } catch {
    return false;
  }
};

const readAndRemoveHandoff = (): StoredHandoff | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_STORAGE_KEY);
    window.sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredHandoff>;
    if (
      value.version !== 1 ||
      typeof value.sessionId !== "string" ||
      !SESSION_ID_PATTERN.test(value.sessionId) ||
      typeof value.handoffToken !== "string" ||
      !HANDOFF_TOKEN_PATTERN.test(value.handoffToken)
    ) {
      return null;
    }
    return value as StoredHandoff;
  } catch {
    return null;
  }
};

const removeSessionStorage = () => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_HANDLE_STORAGE_KEY);
    window.sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
  } catch {
    // A blocked storage area already prevents reload restoration.
  }
};

const postClearSession = (sessionId: string) => {
  try {
    getSharedWorker()?.port.postMessage({ type: "clear", sessionId });
  } catch {
    // Losing the worker also loses its in-memory key.
  }
};

const clearApiWalletSession = () => {
  const handle = readSessionHandle();
  const sessionId = handle?.sessionId ?? activeSessionId;
  removeSessionStorage();
  activeSessionId = null;
  if (sessionId) postClearSession(sessionId);
};

const clearApiWalletSessionsForVault = (vaultId: string) => {
  clearApiWalletSession();
  try {
    getSharedWorker()?.port.postMessage({ type: "clear-vault", vaultId });
  } catch {
    // Losing the worker also loses its in-memory key.
  }
};

const revokeApiWalletSessionsForVault = async (
  vaultId: string,
): Promise<boolean> => {
  clearApiWalletSession();
  if (!getSharedWorker()) {
    return sharedWorkerUnavailableReason === "unsupported";
  }
  const response = await requestWorker({ type: "revoke-vault", vaultId });
  return response?.type === "revoke-vault-result" && response.ok === true;
};

const setPasskeyRequirement = (value: PasskeyRequirement): boolean => {
  if (!isPasskeyRequirement(value)) return false;
  let persisted = true;
  if (typeof window !== "undefined") {
    try {
      persisted = persistPasskeyRequirement(window.localStorage, value);
    } catch {
      persisted = false;
    }
  }
  if (!persisted && value !== "every-refresh") return false;
  clearApiWalletSession();
  setPasskeyRequirementSignal(value);
  return persisted;
};

const cacheApiWalletSession = async (
  payload: VaultPayload,
  vaultId: string,
  requirement = passkeyRequirement(),
): Promise<boolean> => {
  const durationMs = PASSKEY_REQUIREMENT_DURATIONS[requirement];
  if (durationMs === 0) {
    clearApiWalletSession();
    return false;
  }

  const sessionId = randomCapability();
  const response = await requestWorker({
    type: "cache",
    sessionId,
    vaultId,
    durationMs,
    payload,
  });
  if (response?.type !== "cache-result" || response.ok !== true) {
    postClearSession(sessionId);
    return false;
  }
  if (writeSessionHandle({ version: 1, sessionId })) {
    const commitResponse = await requestWorker({ type: "commit", sessionId });
    if (
      commitResponse?.type === "commit-result" &&
      commitResponse.ok === true
    ) {
      return true;
    }
  }
  postClearSession(sessionId);
  removeSessionStorage();
  activeSessionId = null;
  return false;
};

const prepareApiWalletReloadHandoff = () => {
  if (
    typeof window === "undefined" ||
    passkeyRequirement() === "every-refresh"
  ) {
    return;
  }
  const handle = readSessionHandle();
  const worker = getSharedWorker();
  if (!handle || !worker) return;
  const handoffToken = randomCapability();
  try {
    const handoff: StoredHandoff = {
      version: 1,
      sessionId: handle.sessionId,
      handoffToken,
    };
    window.sessionStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(handoff));
    worker.port.postMessage({
      type: "prepare-handoff",
      sessionId: handle.sessionId,
      handoffToken,
    });
  } catch {
    removeSessionStorage();
  }
};

const isApiWalletReloadNavigation = () => {
  if (typeof performance === "undefined") return false;
  const navigation = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return navigation?.type === "reload";
};

const waitForHandoff = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

const restoreApiWalletSession = async (
  vaultId: string,
): Promise<VaultPayload | null> => {
  const handoff = readAndRemoveHandoff();
  if (
    passkeyRequirement() === "every-refresh" ||
    !isApiWalletReloadNavigation() ||
    !handoff
  ) {
    clearApiWalletSession();
    return null;
  }
  const handle = readSessionHandle();
  if (!handle || handle.sessionId !== handoff.sessionId) {
    clearApiWalletSession();
    return null;
  }

  for (const delayMs of [0, 50, 150]) {
    if (delayMs > 0) await waitForHandoff(delayMs);
    const response = await requestWorker({
      type: "restore",
      sessionId: handle.sessionId,
      handoffToken: handoff.handoffToken,
      vaultId,
    });
    if (response?.type === "restore-result" && response.payload) {
      return response.payload;
    }
  }
  postClearSession(handle.sessionId);
  removeSessionStorage();
  activeSessionId = null;
  return null;
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) prepareApiWalletReloadHandoff();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== PASSKEY_REQUIREMENT_STORAGE_KEY) return;
    clearApiWalletSession();
    setPasskeyRequirementSignal(parseStoredPasskeyRequirement(event.newValue));
  });
}

const __test = {
  isPasskeyRequirement,
  isReloadNavigation: isApiWalletReloadNavigation,
  parseStoredPasskeyRequirement,
  persistPasskeyRequirement,
  readPasskeyRequirement,
  defaultRequirement: DEFAULT_PASSKEY_REQUIREMENT,
  durations: PASSKEY_REQUIREMENT_DURATIONS,
};

export {
  type PasskeyRequirement,
  __test,
  cacheApiWalletSession,
  clearApiWalletSession,
  clearApiWalletSessionsForVault,
  isApiWalletReloadNavigation,
  passkeyRequirement,
  revokeApiWalletSessionsForVault,
  restoreApiWalletSession,
  setPasskeyRequirement,
};
