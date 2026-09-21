import { createSignal } from "solid-js";
import type { HyperliquidNetwork } from "./hyperliquidExecution";
import {
  type PasskeyRequirement,
  cacheApiWalletSession,
  clearApiWalletSession,
  clearApiWalletSessionsForVault,
  revokeApiWalletSessionsForVault,
  restoreApiWalletSession,
} from "./apiWalletSession";

const VAULT_DATABASE_NAME = "trade-xyz-api-wallet-vault";
const VAULT_DATABASE_VERSION = 1;
const VAULT_OBJECT_STORE = "vaults";
const VAULT_RECORD_KEY = "primary";
const VAULT_BROADCAST_CHANNEL = "trade-xyz-api-wallet-vault-events";
const VAULT_SCHEMA_VERSION = 1 as const;
const VAULT_PURPOSE = "trade-xyz-hyperliquid-api-wallet";
const WEBAUTHN_TIMEOUT_MS = 120_000;
const PASSKEY_LABEL = "TradingView API Wallet";

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

type ApiWalletVaultMetadata = {
  network: HyperliquidNetwork;
  masterAddress: `0x${string}`;
  agentAddress: `0x${string}`;
  createdAt: number;
};

type StoredApiWalletVault = ApiWalletVaultMetadata & {
  version: typeof VAULT_SCHEMA_VERSION;
  origin: string;
  rpId: string;
  vaultId: string;
  credentialId: string;
  prfInput: string;
  hkdfSalt: string;
  iv: string;
  ciphertext: string;
};

type VaultPayload = {
  version: typeof VAULT_SCHEMA_VERSION;
  network: HyperliquidNetwork;
  masterAddress: `0x${string}`;
  agentAddress: `0x${string}`;
  apiWalletPrivateKey: `0x${string}`;
};

type EnrollApiWalletVaultInput = {
  network: HyperliquidNetwork;
  masterAddress: string;
  agentAddress: string;
  apiWalletPrivateKey: string;
};

type UnlockApiWalletVaultResult =
  | {
      ok: true;
      payload: VaultPayload;
      vaultId: string;
      reloadGraceReady: boolean;
    }
  | { ok: false; error: string };

type UnlockApiWalletVaultOptions = {
  cacheRequirement?: PasskeyRequirement | false;
};

type VaultActionResult =
  | { ok: true; reloadGraceReady?: boolean }
  | { ok: false; error: string };

type EncryptionSeed = {
  origin: string;
  rpId: string;
  vaultId: string;
  credentialId: string;
  prfInput: Uint8Array<ArrayBuffer>;
  hkdfSalt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  createdAt: number;
};

type ApiWalletVaultBroadcastEvent =
  | { version: 1; type: "changed" }
  | { version: 1; type: "forgot"; vaultId?: string };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const [apiWalletVaultMetadata, setApiWalletVaultMetadata] =
  createSignal<ApiWalletVaultMetadata>();
const [apiWalletVaultReady, setApiWalletVaultReady] = createSignal(false);
const [apiWalletVaultHasRecord, setApiWalletVaultHasRecord] =
  createSignal(false);
const [apiWalletVaultError, setApiWalletVaultError] = createSignal<string>();
const [apiWalletVaultRestorePending, setApiWalletVaultRestorePending] =
  createSignal(false);
const [apiWalletVaultUnlockPending, setApiWalletVaultUnlockPending] =
  createSignal(false);
const [apiWalletVaultRevocationEpoch, setApiWalletVaultRevocationEpoch] =
  createSignal(0);

const hasSavedApiWalletVault = () => apiWalletVaultHasRecord();
let initializationPromise: Promise<void> | null = null;
let vaultBroadcastChannel: BroadcastChannel | null = null;

const postVaultBroadcastEvent = (event: ApiWalletVaultBroadcastEvent) => {
  vaultBroadcastChannel?.postMessage(event);
};

const recordMatches = (
  left: StoredApiWalletVault,
  right: StoredApiWalletVault,
) =>
  left.version === right.version &&
  left.origin === right.origin &&
  left.rpId === right.rpId &&
  left.vaultId === right.vaultId &&
  left.credentialId === right.credentialId &&
  left.prfInput === right.prfInput &&
  left.hkdfSalt === right.hkdfSalt &&
  left.iv === right.iv &&
  left.ciphertext === right.ciphertext &&
  left.network === right.network &&
  left.masterAddress === right.masterAddress &&
  left.agentAddress === right.agentAddress &&
  left.createdAt === right.createdAt;

const randomBytes = (length: number): Uint8Array<ArrayBuffer> =>
  crypto.getRandomValues(new Uint8Array(length));

const encodeBase64Url = (value: BufferSource): string => {
  const bytes = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const decodeBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  if (!value || !BASE64URL_PATTERN.test(value)) {
    throw new Error("The saved Touch ID vault contains invalid data.");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const normalizeAddress = (value: string): `0x${string}` | null => {
  const normalized = value.trim().toLowerCase();
  return ADDRESS_PATTERN.test(normalized)
    ? (normalized as `0x${string}`)
    : null;
};

const normalizePrivateKey = (value: string): `0x${string}` | null => {
  const normalized = value.trim();
  return PRIVATE_KEY_PATTERN.test(normalized)
    ? (normalized as `0x${string}`)
    : null;
};

const isHyperliquidNetwork = (value: unknown): value is HyperliquidNetwork =>
  value === "mainnet" || value === "testnet";

const isBoundedString = (
  value: unknown,
  minimum: number,
  maximum: number,
): value is string =>
  typeof value === "string" &&
  value.length >= minimum &&
  value.length <= maximum;

const parseStoredVault = (value: unknown): StoredApiWalletVault => {
  if (!value || typeof value !== "object") {
    throw new Error("The saved Touch ID vault is unreadable.");
  }
  const record = value as Partial<StoredApiWalletVault>;
  if (
    record.version !== VAULT_SCHEMA_VERSION ||
    !isBoundedString(record.origin, 1, 512) ||
    !isBoundedString(record.rpId, 1, 253) ||
    !isBoundedString(record.vaultId, 16, 128) ||
    !isBoundedString(record.credentialId, 16, 2048) ||
    !isBoundedString(record.prfInput, 32, 128) ||
    !isBoundedString(record.hkdfSalt, 32, 128) ||
    !isBoundedString(record.iv, 12, 64) ||
    !isBoundedString(record.ciphertext, 32, 4096) ||
    !isHyperliquidNetwork(record.network) ||
    typeof record.masterAddress !== "string" ||
    normalizeAddress(record.masterAddress) !== record.masterAddress ||
    typeof record.agentAddress !== "string" ||
    normalizeAddress(record.agentAddress) !== record.agentAddress ||
    typeof record.createdAt !== "number" ||
    !Number.isFinite(record.createdAt) ||
    record.createdAt <= 0
  ) {
    throw new Error("The saved Touch ID vault failed validation.");
  }
  for (const encoded of [
    record.vaultId,
    record.credentialId,
    record.prfInput,
    record.hkdfSalt,
    record.iv,
    record.ciphertext,
  ]) {
    if (!BASE64URL_PATTERN.test(encoded)) {
      throw new Error("The saved Touch ID vault contains invalid encoding.");
    }
  }
  if (decodeBase64Url(record.prfInput).byteLength !== 32) {
    throw new Error("The saved Touch ID vault contains an invalid PRF input.");
  }
  if (decodeBase64Url(record.hkdfSalt).byteLength !== 32) {
    throw new Error("The saved Touch ID vault contains an invalid HKDF salt.");
  }
  if (decodeBase64Url(record.iv).byteLength !== 12) {
    throw new Error("The saved Touch ID vault contains an invalid IV.");
  }
  return record as StoredApiWalletVault;
};

const metadataFromRecord = (
  record: StoredApiWalletVault,
): ApiWalletVaultMetadata => ({
  network: record.network,
  masterAddress: record.masterAddress,
  agentAddress: record.agentAddress,
  createdAt: record.createdAt,
});

const transactionCompletion = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Touch ID vault storage failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Touch ID vault storage was aborted."));
  });

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Touch ID vault storage failed."));
  });

const openVaultDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Encrypted browser storage is unavailable."));
      return;
    }
    const request = indexedDB.open(
      VAULT_DATABASE_NAME,
      VAULT_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(VAULT_OBJECT_STORE)) {
        database.createObjectStore(VAULT_OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open encrypted browser storage."));
    request.onblocked = () =>
      reject(new Error("Encrypted browser storage is blocked by another tab."));
  });

const readRawVaultRecord = async (): Promise<unknown> => {
  const database = await openVaultDatabase();
  try {
    const transaction = database.transaction(VAULT_OBJECT_STORE, "readonly");
    const completion = transactionCompletion(transaction);
    const value = await requestResult(
      transaction.objectStore(VAULT_OBJECT_STORE).get(VAULT_RECORD_KEY),
    );
    await completion;
    return value;
  } finally {
    database.close();
  }
};

const createVaultRecord = async (record: StoredApiWalletVault) => {
  const database = await openVaultDatabase();
  try {
    const transaction = database.transaction(VAULT_OBJECT_STORE, "readwrite");
    const completion = transactionCompletion(transaction);
    transaction
      .objectStore(VAULT_OBJECT_STORE)
      .add(record, VAULT_RECORD_KEY);
    await completion;
  } finally {
    database.close();
  }
};

const deleteVaultRecord = async () => {
  const database = await openVaultDatabase();
  try {
    const transaction = database.transaction(VAULT_OBJECT_STORE, "readwrite");
    const completion = transactionCompletion(transaction);
    transaction.objectStore(VAULT_OBJECT_STORE).delete(VAULT_RECORD_KEY);
    await completion;
  } finally {
    database.close();
  }
};

const deleteVaultRecordIfMatches = async (
  expected: StoredApiWalletVault,
): Promise<void> => {
  const database = await openVaultDatabase();
  try {
    const transaction = database.transaction(VAULT_OBJECT_STORE, "readwrite");
    const completion = transactionCompletion(transaction);
    const store = transaction.objectStore(VAULT_OBJECT_STORE);
    const rawRecord = await requestResult(store.get(VAULT_RECORD_KEY));
    try {
      if (recordMatches(expected, parseStoredVault(rawRecord))) {
        store.delete(VAULT_RECORD_KEY);
      }
    } catch {
      // Never delete a missing, malformed, or replacement record here.
    }
    await completion;
  } finally {
    database.close();
  }
};

const currentOrigin = () => {
  if (typeof location === "undefined" || !location.origin) {
    throw new Error("Touch ID unlock is available only in a browser.");
  }
  return location.origin;
};

const currentRpId = () => {
  if (typeof location === "undefined" || !location.hostname) {
    throw new Error("Touch ID unlock is available only in a browser.");
  }
  return location.hostname;
};

const additionalData = (record: StoredApiWalletVault) =>
  textEncoder.encode(
    [
      VAULT_PURPOSE,
      String(record.version),
      record.origin,
      record.rpId,
      record.vaultId,
      record.credentialId,
      record.network,
      record.masterAddress,
      record.agentAddress,
      String(record.createdAt),
    ].join("\n"),
  );

const deriveEncryptionKey = async (
  prfOutput: BufferSource,
  hkdfSalt: BufferSource,
  origin: string,
) => {
  const material = await crypto.subtle.importKey(
    "raw",
    prfOutput,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: hkdfSalt,
      info: textEncoder.encode(`${VAULT_PURPOSE}\n${origin}`),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

const encryptVaultRecord = async (
  input: EnrollApiWalletVaultInput,
  seed: EncryptionSeed,
  prfOutput: BufferSource,
): Promise<StoredApiWalletVault> => {
  const masterAddress = normalizeAddress(input.masterAddress);
  const expectedAgentAddress = normalizeAddress(input.agentAddress);
  const apiWalletPrivateKey = normalizePrivateKey(input.apiWalletPrivateKey);
  if (!masterAddress || !expectedAgentAddress || !apiWalletPrivateKey) {
    throw new Error("The API-wallet details are invalid.");
  }
  const { privateKeyToAccount } = await import(
    "../lib/hyperliquidExecutionSdk"
  );
  const derivedAgentAddress = privateKeyToAccount(
    apiWalletPrivateKey,
  ).address.toLowerCase();
  if (derivedAgentAddress !== expectedAgentAddress) {
    throw new Error(
      "The API-wallet key does not match the verified agent address.",
    );
  }
  const record: StoredApiWalletVault = {
    version: VAULT_SCHEMA_VERSION,
    origin: seed.origin,
    rpId: seed.rpId,
    vaultId: seed.vaultId,
    credentialId: seed.credentialId,
    prfInput: encodeBase64Url(seed.prfInput),
    hkdfSalt: encodeBase64Url(seed.hkdfSalt),
    iv: encodeBase64Url(seed.iv),
    ciphertext: "pending",
    network: input.network,
    masterAddress,
    agentAddress: expectedAgentAddress,
    createdAt: seed.createdAt,
  };
  const payload: VaultPayload = {
    version: VAULT_SCHEMA_VERSION,
    network: input.network,
    masterAddress,
    agentAddress: expectedAgentAddress,
    apiWalletPrivateKey,
  };
  const plaintext = textEncoder.encode(JSON.stringify(payload));
  try {
    const key = await deriveEncryptionKey(
      prfOutput,
      seed.hkdfSalt,
      seed.origin,
    );
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: seed.iv,
        additionalData: additionalData(record),
        tagLength: 128,
      },
      key,
      plaintext,
    );
    record.ciphertext = encodeBase64Url(ciphertext);
    return record;
  } finally {
    plaintext.fill(0);
  }
};

const decryptVaultRecord = async (
  record: StoredApiWalletVault,
  prfOutput: BufferSource,
): Promise<VaultPayload> => {
  const hkdfSalt = decodeBase64Url(record.hkdfSalt);
  const iv = decodeBase64Url(record.iv);
  const ciphertext = decodeBase64Url(record.ciphertext);
  try {
    const key = await deriveEncryptionKey(prfOutput, hkdfSalt, record.origin);
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: additionalData(record),
          tagLength: 128,
        },
        key,
        ciphertext,
      ),
    );
    try {
      return await validateVaultPayload(
        record,
        JSON.parse(textDecoder.decode(plaintext)),
      );
    } finally {
      plaintext.fill(0);
    }
  } finally {
    hkdfSalt.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
  }
};

const validateVaultPayload = async (
  record: StoredApiWalletVault,
  value: unknown,
): Promise<VaultPayload> => {
  if (!value || typeof value !== "object") {
    throw new Error("The decrypted API-wallet vault failed validation.");
  }
  const payload = value as Partial<VaultPayload>;
  const privateKey =
    typeof payload.apiWalletPrivateKey === "string"
      ? normalizePrivateKey(payload.apiWalletPrivateKey)
      : null;
  const { privateKeyToAccount } = await import(
    "../lib/hyperliquidExecutionSdk"
  );
  if (
    payload.version !== VAULT_SCHEMA_VERSION ||
    payload.network !== record.network ||
    payload.masterAddress !== record.masterAddress ||
    payload.agentAddress !== record.agentAddress ||
    !privateKey ||
    privateKeyToAccount(privateKey).address.toLowerCase() !==
      record.agentAddress
  ) {
    throw new Error("The decrypted API-wallet vault failed validation.");
  }
  return {
    version: VAULT_SCHEMA_VERSION,
    network: record.network,
    masterAddress: record.masterAddress,
    agentAddress: record.agentAddress,
    apiWalletPrivateKey: privateKey,
  };
};

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "AbortError") {
      return "Touch ID or Mac verification was canceled.";
    }
    if (error.name === "NotSupportedError") {
      return "This browser or passkey provider does not support encrypted Touch ID unlock.";
    }
    if (error.name === "SecurityError") {
      return "Touch ID unlock requires this exact HTTPS site.";
    }
    if (error.name === "InvalidStateError") {
      return "This Touch ID credential is already registered or unavailable.";
    }
  }
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
};

const ensureTouchIdSupport = async (): Promise<VaultActionResult> => {
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    typeof indexedDB === "undefined" ||
    typeof crypto?.subtle === "undefined" ||
    typeof PublicKeyCredential === "undefined" ||
    typeof navigator.credentials?.create !== "function" ||
    typeof navigator.credentials?.get !== "function"
  ) {
    return {
      ok: false,
      error: "Touch ID unlock requires a supported browser on this exact HTTPS site.",
    };
  }
  try {
    const platformAvailable =
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!platformAvailable) {
      return {
        ok: false,
        error: "No Touch ID or device-verification authenticator is available.",
      };
    }
    if (typeof PublicKeyCredential.getClientCapabilities === "function") {
      const capabilities = await PublicKeyCredential.getClientCapabilities();
      if (capabilities["extension:prf"] !== true) {
        return {
          ok: false,
          error: "This browser does not support encrypted Touch ID unlock.",
        };
      }
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error, "Could not check Touch ID availability."),
    };
  }
};

const prfOutputFromCredential = (
  credential: PublicKeyCredential,
): Uint8Array<ArrayBuffer> | null => {
  const first = credential.getClientExtensionResults().prf?.results?.first;
  if (!first) return null;
  const bytes = ArrayBuffer.isView(first)
    ? new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
    : new Uint8Array(first);
  return bytes.byteLength === 32 ? new Uint8Array(bytes) : null;
};

const requestPrfOutput = async (
  rpId: string,
  credentialId: string,
  prfInput: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> => {
  const rawCredentialId = decodeBase64Url(credentialId);
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId,
      allowCredentials: [
        {
          id: rawCredentialId,
          type: "public-key",
          transports: ["internal"],
        },
      ],
      userVerification: "required",
      timeout: WEBAUTHN_TIMEOUT_MS,
      extensions: {
        prf: {
          evalByCredential: {
            [credentialId]: { first: prfInput },
          },
        },
      },
    },
  });
  if (!credential || credential.type !== "public-key") {
    throw new Error("Touch ID did not return a public-key credential.");
  }
  const publicKeyCredential = credential as PublicKeyCredential;
  if (encodeBase64Url(publicKeyCredential.rawId) !== credentialId) {
    throw new Error("Touch ID returned the wrong saved credential.");
  }
  const output = prfOutputFromCredential(publicKeyCredential);
  if (!output) {
    throw new Error(
      "The selected passkey provider does not support encrypted Touch ID unlock.",
    );
  }
  return output;
};

const loadApiWalletVaultState = async () => {
  try {
    const rawRecord = await readRawVaultRecord();
    if (rawRecord === undefined) {
      setApiWalletVaultHasRecord(false);
      setApiWalletVaultMetadata(undefined);
      setApiWalletVaultError(undefined);
      return;
    }
    setApiWalletVaultHasRecord(true);
    const record = parseStoredVault(rawRecord);
    setApiWalletVaultMetadata(metadataFromRecord(record));
    setApiWalletVaultError(undefined);
  } catch (error) {
    setApiWalletVaultError(
      errorMessage(error, "Could not read the saved Touch ID vault."),
    );
  } finally {
    setApiWalletVaultReady(true);
  }
};

const refreshApiWalletVaultState = async () => {
  if (initializationPromise) await initializationPromise;
  initializationPromise = loadApiWalletVaultState();
  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
};

const initializeApiWalletVault = async () => {
  if (apiWalletVaultReady()) return;
  if (!initializationPromise) {
    initializationPromise = (async () => {
      await loadApiWalletVaultState();
    })();
  }
  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
};

const enrollApiWalletVault = async (
  input: EnrollApiWalletVaultInput,
): Promise<VaultActionResult> => {
  await initializeApiWalletVault();
  const revocationEpoch = apiWalletVaultRevocationEpoch();
  if (apiWalletVaultHasRecord()) {
    return {
      ok: false,
      error: "Forget the saved API wallet before enrolling another one.",
    };
  }
  const support = await ensureTouchIdSupport();
  if (!support.ok) return support;

  const origin = currentOrigin();
  const rpId = currentRpId();
  const vaultId = encodeBase64Url(randomBytes(16));
  const prfInput = randomBytes(32);
  const hkdfSalt = randomBytes(32);
  const iv = randomBytes(12);
  let prfOutput: Uint8Array<ArrayBuffer> | null = null;
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { id: rpId, name: "TradingView" },
        user: {
          id: randomBytes(32),
          name: PASSKEY_LABEL,
          displayName: PASSKEY_LABEL,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        attestation: "none",
        timeout: WEBAUTHN_TIMEOUT_MS,
        extensions: { prf: { eval: { first: prfInput } } },
      },
    });
    if (!credential || credential.type !== "public-key") {
      throw new Error("Touch ID did not create a public-key credential.");
    }
    const publicKeyCredential = credential as PublicKeyCredential;
    const extensionResults = publicKeyCredential.getClientExtensionResults();
    if (extensionResults.prf?.enabled !== true) {
      throw new Error(
        "The selected passkey provider does not support encrypted Touch ID unlock. Choose iCloud Keychain or Google Password Manager if offered.",
      );
    }
    const credentialId = encodeBase64Url(publicKeyCredential.rawId);
    prfOutput =
      prfOutputFromCredential(publicKeyCredential) ??
      (await requestPrfOutput(rpId, credentialId, prfInput));
    const record = await encryptVaultRecord(
      input,
      {
        origin,
        rpId,
        vaultId,
        credentialId,
        prfInput,
        hkdfSalt,
        iv,
        createdAt: Date.now(),
      },
      prfOutput,
    );
    if (apiWalletVaultRevocationEpoch() !== revocationEpoch) {
      throw new Error("API-wallet setup was canceled because the vault changed.");
    }
    await createVaultRecord(record);
    const cachePayload: VaultPayload = {
      version: VAULT_SCHEMA_VERSION,
      network: record.network,
      masterAddress: record.masterAddress,
      agentAddress: record.agentAddress,
      apiWalletPrivateKey: normalizePrivateKey(input.apiWalletPrivateKey)!,
    };
    let reloadGraceReady = false;
    try {
      reloadGraceReady = await cacheApiWalletSession(
        cachePayload,
        record.vaultId,
      );
    } finally {
      cachePayload.apiWalletPrivateKey = "0x";
    }
    const currentRecord = parseStoredVault(await readRawVaultRecord());
    if (
      !recordMatches(record, currentRecord) ||
      apiWalletVaultRevocationEpoch() !== revocationEpoch
    ) {
      clearApiWalletSessionsForVault(record.vaultId);
      if (recordMatches(record, currentRecord)) {
        await deleteVaultRecordIfMatches(record);
      }
      throw new Error("API-wallet setup was canceled because the vault changed.");
    }
    setApiWalletVaultHasRecord(true);
    setApiWalletVaultMetadata(metadataFromRecord(record));
    setApiWalletVaultError(undefined);
    postVaultBroadcastEvent({ version: 1, type: "changed" });
    return { ok: true, reloadGraceReady };
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "ConstraintError"
        ? "Another tab already saved an API wallet. Refresh and unlock or forget that vault first."
        : errorMessage(error, "Could not set up Touch ID unlock.");
    return {
      ok: false,
      error: message,
    };
  } finally {
    prfOutput?.fill(0);
    prfInput.fill(0);
    hkdfSalt.fill(0);
    iv.fill(0);
  }
};

const unlockApiWalletVault = async (
  options: UnlockApiWalletVaultOptions = {},
): Promise<UnlockApiWalletVaultResult> => {
  if (apiWalletVaultUnlockPending()) {
    return {
      ok: false,
      error: "Touch ID or Mac verification is already in progress.",
    };
  }
  setApiWalletVaultUnlockPending(true);
  let prfOutput: Uint8Array<ArrayBuffer> | null = null;
  let payload: VaultPayload | null = null;
  try {
    await initializeApiWalletVault();
    const revocationEpoch = apiWalletVaultRevocationEpoch();
    const support = await ensureTouchIdSupport();
    if (!support.ok) return support;
    const record = parseStoredVault(await readRawVaultRecord());
    if (record.origin !== currentOrigin() || record.rpId !== currentRpId()) {
      throw new Error(
        "This saved API wallet belongs to a different site. Re-enroll it on this domain.",
      );
    }
    const prfInput = decodeBase64Url(record.prfInput);
    try {
      prfOutput = await requestPrfOutput(
        record.rpId,
        record.credentialId,
        prfInput,
      );
    } finally {
      prfInput.fill(0);
    }
    payload = await decryptVaultRecord(record, prfOutput);
    const currentRecord = parseStoredVault(await readRawVaultRecord());
    if (
      !recordMatches(record, currentRecord) ||
      apiWalletVaultRevocationEpoch() !== revocationEpoch
    ) {
      throw new Error("The saved API wallet was removed during verification.");
    }
    const reloadGraceReady =
      options.cacheRequirement === false
        ? false
        : await cacheApiWalletSession(
            payload,
            record.vaultId,
            options.cacheRequirement,
          );
    const finalRecord = parseStoredVault(await readRawVaultRecord());
    if (
      !recordMatches(record, finalRecord) ||
      apiWalletVaultRevocationEpoch() !== revocationEpoch
    ) {
      clearApiWalletSessionsForVault(record.vaultId);
      throw new Error("The saved API wallet was removed during verification.");
    }
    return { ok: true, payload, vaultId: record.vaultId, reloadGraceReady };
  } catch (error) {
    if (payload) payload.apiWalletPrivateKey = "0x";
    return {
      ok: false,
      error: errorMessage(error, "Could not unlock the saved API wallet."),
    };
  } finally {
    prfOutput?.fill(0);
    setApiWalletVaultUnlockPending(false);
  }
};

const restoreApiWalletVaultSession = async (): Promise<
  { ok: true; payload: VaultPayload } | { ok: false }
> => {
  const revocationEpoch = apiWalletVaultRevocationEpoch();
  setApiWalletVaultRestorePending(true);
  let record: StoredApiWalletVault | undefined;
  let cachedPayload: VaultPayload | null = null;
  try {
    await initializeApiWalletVault();
    record = parseStoredVault(await readRawVaultRecord());
    if (record.origin !== currentOrigin() || record.rpId !== currentRpId()) {
      clearApiWalletSessionsForVault(record.vaultId);
      return { ok: false };
    }
    cachedPayload = await restoreApiWalletSession(record.vaultId);
    if (!cachedPayload) return { ok: false };
    const currentRecord = parseStoredVault(await readRawVaultRecord());
    if (
      !recordMatches(record, currentRecord) ||
      currentRecord.origin !== currentOrigin() ||
      currentRecord.rpId !== currentRpId() ||
      apiWalletVaultRevocationEpoch() !== revocationEpoch
    ) {
      throw new Error("The saved API wallet changed during reload.");
    }
    const payload = await validateVaultPayload(currentRecord, cachedPayload);
    return { ok: true, payload };
  } catch {
    if (record) clearApiWalletSessionsForVault(record.vaultId);
    else clearApiWalletSession();
    return { ok: false };
  } finally {
    if (cachedPayload) cachedPayload.apiWalletPrivateKey = "0x";
    setApiWalletVaultRestorePending(false);
  }
};

const renameApiWalletPasskey = async (): Promise<VaultActionResult> => {
  await initializeApiWalletVault();
  try {
    if (
      typeof window === "undefined" ||
      !window.isSecureContext ||
      typeof PublicKeyCredential === "undefined" ||
      typeof PublicKeyCredential.signalCurrentUserDetails !== "function" ||
      typeof navigator.credentials?.get !== "function"
    ) {
      return {
        ok: false,
        error: "This browser cannot update saved passkey names.",
      };
    }

    const record = parseStoredVault(await readRawVaultRecord());
    if (record.origin !== currentOrigin() || record.rpId !== currentRpId()) {
      throw new Error(
        "This saved API wallet belongs to a different site. Re-enroll it on this domain.",
      );
    }

    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: record.rpId,
        allowCredentials: [],
        userVerification: "required",
        timeout: WEBAUTHN_TIMEOUT_MS,
      },
    });
    if (!credential || credential.type !== "public-key") {
      throw new Error(
        "Passkey verification did not return a public-key credential.",
      );
    }

    const publicKeyCredential = credential as PublicKeyCredential;
    if (encodeBase64Url(publicKeyCredential.rawId) !== record.credentialId) {
      throw new Error(
        "Select the passkey saved for this TradingView API wallet.",
      );
    }
    if (
      typeof AuthenticatorAssertionResponse === "undefined" ||
      !(publicKeyCredential.response instanceof AuthenticatorAssertionResponse)
    ) {
      throw new Error("Passkey verification did not return an assertion.");
    }

    const userHandle = publicKeyCredential.response.userHandle;
    if (
      !userHandle ||
      userHandle.byteLength === 0 ||
      userHandle.byteLength > 64
    ) {
      throw new Error(
        "The selected passkey did not return its account identifier.",
      );
    }

    const userId = new Uint8Array(userHandle);
    try {
      await PublicKeyCredential.signalCurrentUserDetails({
        rpId: record.rpId,
        userId: encodeBase64Url(userId),
        name: PASSKEY_LABEL,
        displayName: PASSKEY_LABEL,
      });
    } finally {
      userId.fill(0);
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error, "Could not update the saved passkey name."),
    };
  }
};

const forgetApiWalletVault = async (): Promise<VaultActionResult> => {
  try {
    let vaultId: string | undefined;
    const rawRecord = await readRawVaultRecord();
    if (rawRecord !== undefined) {
      try {
        vaultId = parseStoredVault(rawRecord).vaultId;
      } catch {
        // A malformed vault must still be removable.
      }
    }
    setApiWalletVaultRevocationEpoch((value) => value + 1);
    postVaultBroadcastEvent({ version: 1, type: "forgot", vaultId });
    if (vaultId) {
      const revoked = await revokeApiWalletSessionsForVault(vaultId);
      if (!revoked) {
        throw new Error(
          "Could not revoke the saved API-wallet session. Try again.",
        );
      }
    } else {
      clearApiWalletSession();
    }
    await deleteVaultRecord();
    setApiWalletVaultHasRecord(false);
    setApiWalletVaultMetadata(undefined);
    setApiWalletVaultError(undefined);
    setApiWalletVaultRevocationEpoch((value) => value + 1);
    postVaultBroadcastEvent({ version: 1, type: "forgot", vaultId });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error, "Could not forget the saved API wallet."),
    };
  }
};

if (typeof window !== "undefined") {
  if (typeof BroadcastChannel !== "undefined") {
    vaultBroadcastChannel = new BroadcastChannel(VAULT_BROADCAST_CHANNEL);
    vaultBroadcastChannel.onmessage = (event: MessageEvent) => {
      const message = event.data as
        | Partial<ApiWalletVaultBroadcastEvent>
        | "changed";
      if (
        message !== "changed" &&
        message.version === 1 &&
        message.type === "forgot"
      ) {
        setApiWalletVaultRevocationEpoch((value) => value + 1);
      }
      void refreshApiWalletVaultState();
    };
  }
  window.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshApiWalletVaultState();
  });
  void initializeApiWalletVault();
}

const __test = {
  decodeBase64Url,
  decryptVaultRecord,
  encodeBase64Url,
  encryptVaultRecord,
  parseStoredVault,
  validateVaultPayload,
};

export {
  type ApiWalletVaultMetadata,
  type EnrollApiWalletVaultInput,
  type StoredApiWalletVault,
  type VaultPayload,
  __test,
  apiWalletVaultError,
  apiWalletVaultMetadata,
  apiWalletVaultReady,
  apiWalletVaultRevocationEpoch,
  apiWalletVaultRestorePending,
  apiWalletVaultUnlockPending,
  enrollApiWalletVault,
  ensureTouchIdSupport,
  forgetApiWalletVault,
  hasSavedApiWalletVault,
  initializeApiWalletVault,
  renameApiWalletPasskey,
  restoreApiWalletVaultSession,
  unlockApiWalletVault,
};
