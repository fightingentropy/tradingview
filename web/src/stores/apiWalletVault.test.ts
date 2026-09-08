import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { __test } from "./apiWalletVault";

const PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const MASTER_ADDRESS = "0x1111111111111111111111111111111111111111";
const AGENT_ADDRESS = privateKeyToAccount(PRIVATE_KEY).address.toLowerCase();

const bytes = (length: number, start: number) =>
  Uint8Array.from({ length }, (_, index) => (start + index) % 256);

const encryptionSeed = (ivStart = 97) => ({
  origin: "https://trade-xyz.pages.dev",
  rpId: "trade-xyz.pages.dev",
  vaultId: __test.encodeBase64Url(bytes(16, 1)),
  credentialId: __test.encodeBase64Url(bytes(32, 17)),
  prfInput: bytes(32, 33),
  hkdfSalt: bytes(32, 65),
  iv: bytes(12, ivStart),
  createdAt: 1_788_102_000_000,
});

const enrollmentInput = {
  network: "mainnet" as const,
  masterAddress: MASTER_ADDRESS,
  agentAddress: AGENT_ADDRESS,
  apiWalletPrivateKey: PRIVATE_KEY,
};

describe("Touch ID API-wallet vault cryptography", () => {
  test("round-trips the key while persisting ciphertext only", async () => {
    const prfOutput = bytes(32, 129);
    const record = await __test.encryptVaultRecord(
      enrollmentInput,
      encryptionSeed(),
      prfOutput,
    );

    expect(JSON.stringify(record)).not.toContain(PRIVATE_KEY);
    expect(record.ciphertext).not.toBe("pending");
    expect(record.network).toBe("mainnet");

    const payload = await __test.decryptVaultRecord(record, prfOutput);
    expect(payload).toEqual({
      version: 1,
      network: "mainnet",
      masterAddress: MASTER_ADDRESS,
      agentAddress: AGENT_ADDRESS,
      apiWalletPrivateKey: PRIVATE_KEY,
    });
  });

  test("fails closed with the wrong authenticator PRF output", async () => {
    const record = await __test.encryptVaultRecord(
      enrollmentInput,
      encryptionSeed(),
      bytes(32, 129),
    );

    await expect(
      __test.decryptVaultRecord(record, bytes(32, 130)),
    ).rejects.toThrow();
  });

  test("rejects ciphertext and authenticated metadata tampering", async () => {
    const prfOutput = bytes(32, 129);
    const record = await __test.encryptVaultRecord(
      enrollmentInput,
      encryptionSeed(),
      prfOutput,
    );
    const ciphertextBytes = __test.decodeBase64Url(record.ciphertext);
    ciphertextBytes[0] ^= 1;

    await expect(
      __test.decryptVaultRecord(
        {
          ...record,
          ciphertext: __test.encodeBase64Url(ciphertextBytes),
        },
        prfOutput,
      ),
    ).rejects.toThrow();

    await expect(
      __test.decryptVaultRecord(
        { ...record, network: "testnet" },
        prfOutput,
      ),
    ).rejects.toThrow();
  });

  test("uses a fresh IV to produce different ciphertext", async () => {
    const prfOutput = bytes(32, 129);
    const first = await __test.encryptVaultRecord(
      enrollmentInput,
      encryptionSeed(97),
      prfOutput,
    );
    const second = await __test.encryptVaultRecord(
      enrollmentInput,
      encryptionSeed(109),
      prfOutput,
    );

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  test("rejects malformed persisted records", async () => {
    const record = await __test.encryptVaultRecord(
      enrollmentInput,
      encryptionSeed(),
      bytes(32, 129),
    );

    expect(() => __test.parseStoredVault({ ...record, iv: "broken" })).toThrow(
      "failed validation",
    );
  });

  test("revalidates a reload handoff against the encrypted vault binding", async () => {
    const record = await __test.encryptVaultRecord(
      enrollmentInput,
      encryptionSeed(),
      bytes(32, 129),
    );
    const payload = {
      version: 1 as const,
      network: record.network,
      masterAddress: record.masterAddress,
      agentAddress: record.agentAddress,
      apiWalletPrivateKey: PRIVATE_KEY as `0x${string}`,
    };

    await expect(__test.validateVaultPayload(record, payload)).resolves.toEqual(
      payload,
    );
    await expect(
      __test.validateVaultPayload(record, {
        ...payload,
        masterAddress: "0x2222222222222222222222222222222222222222",
      }),
    ).rejects.toThrow("failed validation");
    await expect(
      __test.validateVaultPayload(record, {
        ...payload,
        apiWalletPrivateKey:
          "0x0000000000000000000000000000000000000000000000000000000000000002",
      }),
    ).rejects.toThrow("failed validation");
  });
});

describe("Touch ID API-wallet vault capability boundary", () => {
  test("requires platform user verification and never uses Web Storage", async () => {
    const source = await Bun.file(
      new URL("./apiWalletVault.ts", import.meta.url),
    ).text();

    expect(source).toContain('authenticatorAttachment: "platform"');
    expect(source).toContain('userVerification: "required"');
    expect(source).toContain('attestation: "none"');
    expect(source).toContain('const PASSKEY_LABEL = "TradingView API Wallet"');
    expect(source).toContain("name: PASSKEY_LABEL");
    expect(source).toContain("displayName: PASSKEY_LABEL");
    expect(source).not.toContain("api-wallet-${vaultId.slice(0, 12)}");
    expect(source).toContain('capabilities["extension:prf"] !== true');
    expect(source).toContain(".add(record, VAULT_RECORD_KEY)");
    expect(source).not.toContain(".put(record, VAULT_RECORD_KEY)");
    expect(source).toContain("new BroadcastChannel");
    expect(source).toContain("AES-GCM");
    expect(source).toContain("HKDF");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).toContain("await cacheApiWalletSession(");
    expect(source).toContain("await restoreApiWalletSession(record.vaultId)");
    expect(source).toContain("if (apiWalletVaultUnlockPending())");
    expect(source).toContain("setApiWalletVaultUnlockPending(true)");
    expect(source).toContain("setApiWalletVaultUnlockPending(false)");
    expect(source).not.toMatch(/console\.(?:log|info|warn|error)/u);
  });

  test("renames only the stored discoverable credential after user verification", async () => {
    const source = await Bun.file(
      new URL("./apiWalletVault.ts", import.meta.url),
    ).text();

    expect(source).toContain("allowCredentials: []");
    expect(source).toContain(
      "typeof PublicKeyCredential.signalCurrentUserDetails",
    );
    expect(source).toContain(
      "encodeBase64Url(publicKeyCredential.rawId) !== record.credentialId",
    );
    expect(source).toContain("publicKeyCredential.response.userHandle");
    expect(source).toContain(
      "await PublicKeyCredential.signalCurrentUserDetails",
    );
  });

  test("revokes late vault work before a signer can be republished", async () => {
    const vaultSource = await Bun.file(
      new URL("./apiWalletVault.ts", import.meta.url),
    ).text();
    const appSource = await Bun.file(
      new URL("../App.tsx", import.meta.url),
    ).text();
    const executionSource = await Bun.file(
      new URL("./hyperliquidExecution.ts", import.meta.url),
    ).text();

    expect(vaultSource).toContain("revokeApiWalletSessionsForVault");
    expect(vaultSource).toContain("const finalRecord = parseStoredVault");
    expect(vaultSource.match(/type: "forgot"/gu)?.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(appSource).toContain("apiWalletVaultRevocationEpoch");
    expect(appSource).toContain("disconnectHyperliquid();");
    expect(executionSource).toContain(
      "releaseSessionLock(sessionLockEpoch);",
    );
  });
});
