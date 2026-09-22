import {
  ApiWalletSessionBroker,
  type SessionVaultPayload,
} from "./apiWalletSessionBroker";

type CacheMessage = {
  type: "cache";
  requestId: string;
  sessionId: string;
  vaultId: string;
  durationMs: number;
  payload: SessionVaultPayload;
};

type PrepareHandoffMessage = {
  type: "prepare-handoff";
  sessionId: string;
  handoffToken: string;
};

type CommitMessage = {
  type: "commit";
  requestId: string;
  sessionId: string;
};

type RestoreMessage = {
  type: "restore";
  requestId: string;
  sessionId: string;
  handoffToken: string;
  vaultId: string;
};

type ClaimMessage = {
  type: "claim";
  requestId: string;
  sessionId: string;
  handoffToken: string;
};

type RestoreOwnedMessage = {
  type: "restore-owned";
  requestId: string;
  sessionId: string;
  vaultId: string;
};

type ClearMessage = {
  type: "clear";
  sessionId: string;
};

type ClearVaultMessage = {
  type: "clear-vault";
  vaultId: string;
};

type RevokeVaultMessage = {
  type: "revoke-vault";
  requestId: string;
  vaultId: string;
};

type SessionMessage =
  | CacheMessage
  | CommitMessage
  | PrepareHandoffMessage
  | RestoreMessage
  | ClaimMessage
  | RestoreOwnedMessage
  | ClearMessage
  | ClearVaultMessage
  | RevokeVaultMessage;

type SharedWorkerScope = typeof globalThis & {
  onconnect: ((event: MessageEvent) => void) | null;
};

const SESSION_ID_PATTERN = /^[0-9a-f]{64}$/u;
const HANDOFF_TOKEN_PATTERN = /^[0-9a-f]{64}$/u;
const VAULT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/u;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const ALLOWED_DURATIONS_MS = new Set([5 * 60_000, 60 * 60_000]);
const HANDOFF_LIFETIME_MS = 15_000;
const PROVISIONAL_LIFETIME_MS = 15_000;

const broker = new ApiWalletSessionBroker<MessagePort>({
  wallNow: () => Date.now(),
  monotonicNow: () => performance.now(),
});
let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

const isVaultPayload = (value: unknown): value is SessionVaultPayload => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<SessionVaultPayload>;
  return (
    payload.version === 1 &&
    (payload.network === "mainnet" || payload.network === "testnet") &&
    typeof payload.masterAddress === "string" &&
    ADDRESS_PATTERN.test(payload.masterAddress) &&
    typeof payload.agentAddress === "string" &&
    ADDRESS_PATTERN.test(payload.agentAddress) &&
    typeof payload.apiWalletPrivateKey === "string" &&
    PRIVATE_KEY_PATTERN.test(payload.apiWalletPrivateKey)
  );
};

const scheduleCleanup = () => {
  if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
  cleanupTimer = undefined;
  const nextDelay = broker.nextDelay();
  if (nextDelay === undefined) return;
  cleanupTimer = setTimeout(() => {
    cleanupTimer = undefined;
    broker.clearExpired();
    scheduleCleanup();
  }, nextDelay);
};

const isCacheMessage = (message: SessionMessage): message is CacheMessage =>
  message.type === "cache" &&
  typeof message.requestId === "string" &&
  SESSION_ID_PATTERN.test(message.sessionId) &&
  VAULT_ID_PATTERN.test(message.vaultId) &&
  ALLOWED_DURATIONS_MS.has(message.durationMs) &&
  isVaultPayload(message.payload);

const isRestoreMessage = (message: SessionMessage): message is RestoreMessage =>
  message.type === "restore" &&
  typeof message.requestId === "string" &&
  SESSION_ID_PATTERN.test(message.sessionId) &&
  HANDOFF_TOKEN_PATTERN.test(message.handoffToken) &&
  VAULT_ID_PATTERN.test(message.vaultId);

const handleMessage = (port: MessagePort, value: unknown) => {
  if (!value || typeof value !== "object" || !("type" in value)) return;
  const message = value as SessionMessage;
  broker.clearExpired();

  if (isCacheMessage(message)) {
    const ok = broker.cache({
      sessionId: message.sessionId,
      vaultId: message.vaultId,
      durationMs: message.durationMs,
      provisionalLifetimeMs: PROVISIONAL_LIFETIME_MS,
      payload: message.payload,
      owner: port,
    });
    scheduleCleanup();
    port.postMessage({
      type: "cache-result",
      requestId: message.requestId,
      ok,
    });
    return;
  }

  if (
    message.type === "commit" &&
    typeof message.requestId === "string" &&
    SESSION_ID_PATTERN.test(message.sessionId)
  ) {
    const ok = broker.commit(message.sessionId, port);
    if (ok) scheduleCleanup();
    port.postMessage({
      type: "commit-result",
      requestId: message.requestId,
      ok,
    });
    return;
  }

  if (
    message.type === "prepare-handoff" &&
    SESSION_ID_PATTERN.test(message.sessionId) &&
    HANDOFF_TOKEN_PATTERN.test(message.handoffToken)
  ) {
    if (
      broker.prepareHandoff({
        sessionId: message.sessionId,
        handoffToken: message.handoffToken,
        handoffLifetimeMs: HANDOFF_LIFETIME_MS,
        owner: port,
      })
    ) {
      scheduleCleanup();
    }
    return;
  }

  if (isRestoreMessage(message)) {
    const payload = broker.restore({
      sessionId: message.sessionId,
      handoffToken: message.handoffToken,
      vaultId: message.vaultId,
      owner: port,
    });
    if (!payload) {
      port.postMessage({
        type: "restore-result",
        requestId: message.requestId,
        payload: null,
      });
      return;
    }

    port.postMessage({
      type: "restore-result",
      requestId: message.requestId,
      payload,
    });
    scheduleCleanup();
    return;
  }

  if (
    message.type === "claim" && typeof message.requestId === "string" &&
    SESSION_ID_PATTERN.test(message.sessionId) && HANDOFF_TOKEN_PATTERN.test(message.handoffToken)
  ) {
    const ok = broker.claimHandoff({ ...message, owner: port });
    scheduleCleanup();
    port.postMessage({ type: "claim-result", requestId: message.requestId, ok });
    return;
  }

  if (
    message.type === "restore-owned" && typeof message.requestId === "string" &&
    SESSION_ID_PATTERN.test(message.sessionId) && VAULT_ID_PATTERN.test(message.vaultId)
  ) {
    const payload = broker.restoreOwned({ ...message, owner: port });
    scheduleCleanup();
    port.postMessage({ type: "restore-result", requestId: message.requestId, payload });
    return;
  }

  if (message.type === "clear" && SESSION_ID_PATTERN.test(message.sessionId)) {
    if (broker.clear(message.sessionId, port)) {
      scheduleCleanup();
    }
    return;
  }

  if (
    message.type === "clear-vault" &&
    VAULT_ID_PATTERN.test(message.vaultId)
  ) {
    broker.clearVault(message.vaultId);
    scheduleCleanup();
    return;
  }

  if (
    message.type === "revoke-vault" &&
    typeof message.requestId === "string" &&
    VAULT_ID_PATTERN.test(message.vaultId)
  ) {
    broker.revokeVault(message.vaultId);
    scheduleCleanup();
    port.postMessage({
      type: "revoke-vault-result",
      requestId: message.requestId,
      ok: true,
    });
  }
};

const workerScope = globalThis as SharedWorkerScope;
workerScope.onconnect = (event) => {
  const port = event.ports[0];
  if (!port) return;
  port.onmessage = (messageEvent) => handleMessage(port, messageEvent.data);
  port.start();
};
