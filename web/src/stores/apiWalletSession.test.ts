import { describe, expect, test } from "bun:test";
import { __test } from "./apiWalletSession";
import {
  ApiWalletSessionBroker,
  type SessionVaultPayload,
} from "./apiWalletSessionBroker";

const createPayload = (privateKeyByte = "1"): SessionVaultPayload => ({
  version: 1,
  network: "mainnet",
  masterAddress: "0x1111111111111111111111111111111111111111",
  agentAddress: "0x2222222222222222222222222222222222222222",
  apiWalletPrivateKey: `0x${privateKeyByte.repeat(64)}`,
});

describe("API-wallet passkey requirement", () => {
  test("defaults missing settings to one hour and fails closed for malformed values", () => {
    expect(__test.defaultRequirement).toBe("one-hour");
    expect(__test.parseStoredPasskeyRequirement(null)).toBe("one-hour");
    expect(__test.parseStoredPasskeyRequirement("")).toBe("every-refresh");
    expect(__test.parseStoredPasskeyRequirement("not-json")).toBe(
      "every-refresh",
    );
    expect(
      __test.parseStoredPasskeyRequirement(
        JSON.stringify({ version: 1, requirement: "never" }),
      ),
    ).toBe("every-refresh");
    expect(
      __test.parseStoredPasskeyRequirement(
        JSON.stringify({ version: 3, requirement: "one-hour" }),
      ),
    ).toBe("every-refresh");
  });

  test("accepts only the three fixed policies and durations", () => {
    for (const requirement of [
      "every-refresh",
      "five-minutes",
      "one-hour",
    ] as const) {
      expect(
        __test.parseStoredPasskeyRequirement(
          JSON.stringify({ version: 2, requirement }),
        ),
      ).toBe(requirement);
    }
    expect(__test.durations).toEqual({
      "every-refresh": 0,
      "five-minutes": 300_000,
      "one-hour": 3_600_000,
    });
  });

  test("upgrades old five-minute and forced-refresh settings once, then keeps explicit choices", () => {
    for (const previous of ["five-minutes", "every-refresh", "one-hour"]) {
      let stored = JSON.stringify({ version: 1, requirement: previous });
      let migrations = 0;
      const storage = {
        getItem: () => stored,
        setItem: (_key: string, value: string) => { stored = value; },
      };
      const onMigration = () => { migrations += 1; };

      expect(__test.readPasskeyRequirement(storage, onMigration)).toBe("one-hour");
      expect(JSON.parse(stored)).toEqual({ version: 2, requirement: "one-hour" });
      expect(migrations).toBe(1);
      expect(__test.readPasskeyRequirement(storage, onMigration)).toBe("one-hour");
      expect(migrations).toBe(1);

      __test.persistPasskeyRequirement(storage, "five-minutes");
      expect(__test.readPasskeyRequirement(storage, onMigration)).toBe("five-minutes");
      __test.persistPasskeyRequirement(storage, "every-refresh");
      expect(__test.readPasskeyRequirement(storage, onMigration)).toBe("every-refresh");
      expect(migrations).toBe(1);
    }
  });

  test("requires verification if the one-hour upgrade cannot be saved", () => {
    let migrated = false;
    expect(__test.readPasskeyRequirement({
      getItem: () => JSON.stringify({ version: 1, requirement: "five-minutes" }),
      setItem: () => { throw new DOMException("blocked", "SecurityError"); },
    }, () => { migrated = true; })).toBe("every-refresh");
    expect(migrated).toBe(false);
  });

  test("requires durable storage for timed choices and fails closed on reads", () => {
    let stored = "";
    expect(
      __test.persistPasskeyRequirement(
        {
          setItem: (_key, value) => {
            stored = value;
          },
        },
        "five-minutes",
      ),
    ).toBe(true);
    expect(__test.parseStoredPasskeyRequirement(stored)).toBe("five-minutes");
    expect(
      __test.persistPasskeyRequirement(
        {
          setItem: () => {
            throw new DOMException("blocked", "SecurityError");
          },
        },
        "one-hour",
      ),
    ).toBe(false);
    expect(
      __test.readPasskeyRequirement({
        getItem: () => {
          throw new DOMException("blocked", "SecurityError");
        },
        setItem: () => {},
      }),
    ).toBe("every-refresh");
  });
});

describe("API-wallet reload handoff boundary", () => {
  test("keeps wallet material out of persistent browser storage", async () => {
    const source = await Bun.file(
      new URL("./apiWalletSession.ts", import.meta.url),
    ).text();
    const viteConfig = await Bun.file(
      new URL("../../vite.config.ts", import.meta.url),
    ).text();
    const appSource = await Bun.file(
      new URL("../App.tsx", import.meta.url),
    ).text();
    const connectionSource = await Bun.file(
      new URL("./apiWalletConnection.ts", import.meta.url),
    ).text();
    const connectionControlSource = await Bun.file(
      new URL("../components/AccountConnectionControl.tsx", import.meta.url),
    ).text();
    const connectModalSource = await Bun.file(
      new URL("../components/ConnectModal.tsx", import.meta.url),
    ).text();

    expect(source).toContain("window.localStorage");
    expect(source).toContain("storage.setItem(PASSKEY_REQUIREMENT_STORAGE_KEY");
    expect(source).toContain("window.sessionStorage.setItem(");
    expect(source).toContain("HANDOFF_STORAGE_KEY");
    expect(source).toContain('navigation?.type === "reload"');
    expect(source).not.toContain("indexedDB");
    expect(source).not.toMatch(
      /sessionStorage\.setItem\([\s\S]{0,200}(?:apiWalletPrivateKey|payload|prfOutput)/u,
    );
    expect(source).toContain(
      'sharedWorkerUnavailableReason === "unsupported"',
    );
    expect(viteConfig).toContain("entryFileNames: 'assets/[name].js'");
    expect(appSource).toContain("restoreSavedApiWalletOnStartup");
    expect(connectionSource).not.toContain(
      "if (!isApiWalletReloadNavigation()) return;",
    );
    expect(connectionSource).toContain(
      "const restored = await restoreApiWalletVaultSession()",
    );
    expect(connectionSource).toContain(
      "const unlocked = await unlockApiWalletVault()",
    );
    expect(connectionControlSource).toContain("shouldUnlockDirectly()");
    expect(connectionControlSource).toContain(
      "const result = await unlockSavedApiWallet()",
    );
    expect(connectModalSource).toContain("shouldUnlockSavedWallet()");
    expect(connectModalSource).toContain(
      "const result = await unlockSavedApiWallet()",
    );
    expect(connectModalSource).toContain("handOffTo(openSettings)");
  });

  test("zeros and clears an uncommitted provisional entry at the exact boundary", () => {
    let now = 1_000;
    const broker = new ApiWalletSessionBroker<object>(() => now);
    const payload = createPayload();

    expect(
      broker.cache({
        sessionId: "session-a",
        vaultId: "vault-a",
        durationMs: 300_000,
        provisionalLifetimeMs: 15_000,
        payload,
        owner: {},
      }),
    ).toBe(true);
    expect(broker.nextDeadline()).toBe(16_000);

    now = 15_999;
    broker.clearExpired();
    expect(payload.apiWalletPrivateKey).not.toBe("0x");
    expect(broker.nextDelay()).toBe(1);

    now = 16_000;
    broker.clearExpired();
    expect(payload.apiWalletPrivateKey).toBe("0x");
    expect(broker.nextDeadline()).toBeUndefined();
  });

  test("commit removes the provisional deadline and permits handoff", () => {
    const broker = new ApiWalletSessionBroker<object>(() => 100);
    const owner = {};

    expect(
      broker.cache({
        sessionId: "session-a",
        vaultId: "vault-a",
        durationMs: 300_000,
        provisionalLifetimeMs: 15_000,
        payload: createPayload(),
        owner,
      }),
    ).toBe(true);
    expect(
      broker.prepareHandoff({
        sessionId: "session-a",
        handoffToken: "too-early",
        handoffLifetimeMs: 15_000,
        owner,
      }),
    ).toBe(false);

    expect(broker.commit("session-a", owner)).toBe(true);
    expect(broker.nextDeadline()).toBe(300_100);
    expect(
      broker.prepareHandoff({
        sessionId: "session-a",
        handoffToken: "committed",
        handoffLifetimeMs: 15_000,
        owner,
      }),
    ).toBe(true);
    expect(broker.nextDeadline()).toBe(15_100);
  });

  test("an unconsumed handoff expiry zeros and clears the whole entry", () => {
    let now = 0;
    const broker = new ApiWalletSessionBroker<object>(() => now);
    const owner = {};
    const payload = createPayload();

    expect(
      broker.cache({
        sessionId: "session-a",
        vaultId: "vault-a",
        durationMs: 300_000,
        provisionalLifetimeMs: 15_000,
        payload,
        owner,
      }),
    ).toBe(true);
    expect(broker.commit("session-a", owner)).toBe(true);
    expect(
      broker.prepareHandoff({
        sessionId: "session-a",
        handoffToken: "abandoned",
        handoffLifetimeMs: 15_000,
        owner,
      }),
    ).toBe(true);

    now = 14_999;
    broker.clearExpired();
    expect(payload.apiWalletPrivateKey).not.toBe("0x");

    now = 15_000;
    broker.clearExpired();
    expect(payload.apiWalletPrivateKey).toBe("0x");
    expect(broker.nextDeadline()).toBeUndefined();
  });

  test("vault revocation tombstones late caches while clearing does not", () => {
    const broker = new ApiWalletSessionBroker<object>(() => 0);
    const revokedOwner = {};
    const existingPayload = createPayload("1");

    expect(
      broker.cache({
        sessionId: "session-a",
        vaultId: "vault-a",
        durationMs: 300_000,
        provisionalLifetimeMs: 15_000,
        payload: existingPayload,
        owner: revokedOwner,
      }),
    ).toBe(true);
    expect(broker.commit("session-a", revokedOwner)).toBe(true);
    broker.revokeVault("vault-a");
    expect(existingPayload.apiWalletPrivateKey).toBe("0x");
    expect(broker.nextDeadline()).toBeUndefined();

    const latePayload = createPayload("2");
    expect(
      broker.cache({
        sessionId: "session-late",
        vaultId: "vault-a",
        durationMs: 300_000,
        provisionalLifetimeMs: 15_000,
        payload: latePayload,
        owner: {},
      }),
    ).toBe(false);
    expect(latePayload.apiWalletPrivateKey).toBe("0x");
    expect(broker.nextDeadline()).toBeUndefined();

    const clearedPayload = createPayload("3");
    expect(
      broker.cache({
        sessionId: "session-b",
        vaultId: "vault-b",
        durationMs: 300_000,
        provisionalLifetimeMs: 15_000,
        payload: clearedPayload,
        owner: {},
      }),
    ).toBe(true);
    broker.clearVault("vault-b");
    expect(clearedPayload.apiWalletPrivateKey).toBe("0x");

    const replacementPayload = createPayload("4");
    expect(
      broker.cache({
        sessionId: "session-c",
        vaultId: "vault-b",
        durationMs: 300_000,
        provisionalLifetimeMs: 15_000,
        payload: replacementPayload,
        owner: {},
      }),
    ).toBe(true);
    expect(replacementPayload.apiWalletPrivateKey).not.toBe("0x");
  });

  test("keeps the original expiry after restore and expires at the exact boundary", () => {
    let now = 1_000;
    const broker = new ApiWalletSessionBroker<object>(() => now);
    const originalOwner = {};
    const reloadedOwner = {};
    const payload = createPayload();
    const originalExpiry = now + 300_000;

    broker.cache({
      sessionId: "session-a",
      vaultId: "vault-a",
      durationMs: 300_000,
      provisionalLifetimeMs: 15_000,
      payload,
      owner: originalOwner,
    });
    expect(broker.commit("session-a", originalOwner)).toBe(true);
    expect(broker.nextDeadline()).toBe(originalExpiry);

    now = originalExpiry - 10_000;
    expect(
      broker.prepareHandoff({
        sessionId: "session-a",
        handoffToken: "token-a",
        handoffLifetimeMs: 15_000,
        owner: originalOwner,
      }),
    ).toBe(true);
    expect(
      broker.restore({
        sessionId: "session-a",
        handoffToken: "token-a",
        vaultId: "vault-a",
        owner: reloadedOwner,
      }),
    ).toBe(payload);
    expect(broker.nextDeadline()).toBe(originalExpiry);

    now = originalExpiry;
    expect(
      broker.restore({
        sessionId: "session-a",
        handoffToken: "token-a",
        vaultId: "vault-a",
        owner: {},
      }),
    ).toBeNull();
    expect(broker.nextDeadline()).toBeUndefined();
    expect(payload.apiWalletPrivateKey).toBe("0x");
  });

  test("one-hour sessions survive reloads after five minutes but end at the original hour", () => {
    let now = 0;
    const broker = new ApiWalletSessionBroker<object>(() => now);
    let owner = {};
    const payload = createPayload();
    let saved = JSON.stringify({ version: 1, requirement: "five-minutes" });
    const requirement = __test.readPasskeyRequirement({
      getItem: () => saved,
      setItem: (_key, value) => { saved = value; },
    });
    broker.cache({
      sessionId: "one-hour-session",
      vaultId: "vault-a",
      durationMs: __test.durations[requirement],
      provisionalLifetimeMs: 15_000,
      payload,
      owner,
    });
    expect(broker.commit("one-hour-session", owner)).toBe(true);

    for (now of [300_001, 1_800_000, 3_599_999]) {
      const nextOwner = {};
      expect(broker.prepareHandoff({
        sessionId: "one-hour-session", handoffToken: `reload-${now}`,
        handoffLifetimeMs: 15_000, owner,
      })).toBe(true);
      expect(broker.restore({
        sessionId: "one-hour-session", handoffToken: `reload-${now}`,
        vaultId: "vault-a", owner: nextOwner,
      })).toBe(payload);
      expect(broker.nextDeadline()).toBe(3_600_000);
      owner = nextOwner;
    }

    now = 3_600_000;
    expect(broker.prepareHandoff({
      sessionId: "one-hour-session", handoffToken: "expired",
      handoffLifetimeMs: 15_000, owner,
    })).toBe(false);
    expect(payload.apiWalletPrivateKey).toBe("0x");
    expect(broker.nextDeadline()).toBeUndefined();
  });

  test("expires on wall time after system sleep even if the monotonic clock pauses", () => {
    let wallNow = 1_000;
    let monotonicNow = 500;
    const broker = new ApiWalletSessionBroker<object>({
      wallNow: () => wallNow,
      monotonicNow: () => monotonicNow,
    });
    const owner = {};
    const payload = createPayload();

    broker.cache({
      sessionId: "session-a",
      vaultId: "vault-a",
      durationMs: 300_000,
      provisionalLifetimeMs: 15_000,
      payload,
      owner,
    });
    expect(broker.commit("session-a", owner)).toBe(true);
    wallNow += 300_000;
    monotonicNow += 1_000;
    broker.clearExpired();

    expect(broker.nextDelay()).toBeUndefined();
    expect(payload.apiWalletPrivateKey).toBe("0x");
  });

  test("allows only the current owner to prepare a handoff", () => {
    let now = 0;
    const broker = new ApiWalletSessionBroker<object>(() => now);
    const owner = {};
    const otherOwner = {};

    broker.cache({
      sessionId: "session-a",
      vaultId: "vault-a",
      durationMs: 300_000,
      provisionalLifetimeMs: 15_000,
      payload: createPayload(),
      owner,
    });
    expect(broker.commit("session-a", owner)).toBe(true);

    expect(
      broker.prepareHandoff({
        sessionId: "session-a",
        handoffToken: "stolen-token",
        handoffLifetimeMs: 15_000,
        owner: otherOwner,
      }),
    ).toBe(false);
    expect(
      broker.restore({
        sessionId: "session-a",
        handoffToken: "stolen-token",
        vaultId: "vault-a",
        owner: otherOwner,
      }),
    ).toBeNull();

    now = 1;
    expect(
      broker.prepareHandoff({
        sessionId: "session-a",
        handoffToken: "owner-token",
        handoffLifetimeMs: 15_000,
        owner,
      }),
    ).toBe(true);
  });

  test("consumes a handoff once and transfers ownership", () => {
    const broker = new ApiWalletSessionBroker<object>(() => 100);
    const originalOwner = {};
    const reloadedOwner = {};
    const replayOwner = {};
    const payload = createPayload();

    broker.cache({
      sessionId: "session-a",
      vaultId: "vault-a",
      durationMs: 300_000,
      provisionalLifetimeMs: 15_000,
      payload,
      owner: originalOwner,
    });
    expect(broker.commit("session-a", originalOwner)).toBe(true);
    expect(
      broker.prepareHandoff({
        sessionId: "session-a",
        handoffToken: "one-use-token",
        handoffLifetimeMs: 15_000,
        owner: originalOwner,
      }),
    ).toBe(true);
    expect(
      broker.restore({
        sessionId: "session-a",
        handoffToken: "one-use-token",
        vaultId: "vault-a",
        owner: reloadedOwner,
      }),
    ).toBe(payload);
    expect(
      broker.restore({
        sessionId: "session-a",
        handoffToken: "one-use-token",
        vaultId: "vault-a",
        owner: replayOwner,
      }),
    ).toBeNull();
    expect(
      broker.prepareHandoff({
        sessionId: "session-a",
        handoffToken: "old-owner-token",
        handoffLifetimeMs: 15_000,
        owner: originalOwner,
      }),
    ).toBe(false);
    expect(
      broker.prepareHandoff({
        sessionId: "session-a",
        handoffToken: "new-owner-token",
        handoffLifetimeMs: 15_000,
        owner: reloadedOwner,
      }),
    ).toBe(true);
  });

  test("allows only the current owner to clear and zeroes the key", () => {
    const broker = new ApiWalletSessionBroker<object>(() => 0);
    const owner = {};
    const payload = createPayload();

    broker.cache({
      sessionId: "session-a",
      vaultId: "vault-a",
      durationMs: 300_000,
      provisionalLifetimeMs: 15_000,
      payload,
      owner,
    });

    expect(broker.clear("session-a", {})).toBe(false);
    expect(payload.apiWalletPrivateKey).not.toBe("0x");
    expect(broker.clear("session-a", owner)).toBe(true);
    expect(payload.apiWalletPrivateKey).toBe("0x");
    expect(broker.nextDeadline()).toBeUndefined();
  });

  test("clears and zeroes every session for one vault only", () => {
    const broker = new ApiWalletSessionBroker<object>(() => 0);
    const firstPayload = createPayload("1");
    const secondPayload = createPayload("2");
    const firstOwner = {};
    const secondOwner = {};

    broker.cache({
      sessionId: "session-a",
      vaultId: "vault-a",
      durationMs: 300_000,
      provisionalLifetimeMs: 15_000,
      payload: firstPayload,
      owner: firstOwner,
    });
    expect(broker.commit("session-a", firstOwner)).toBe(true);
    broker.cache({
      sessionId: "session-b",
      vaultId: "vault-b",
      durationMs: 3_600_000,
      provisionalLifetimeMs: 15_000,
      payload: secondPayload,
      owner: secondOwner,
    });
    expect(broker.commit("session-b", secondOwner)).toBe(true);

    broker.clearVault("vault-a");
    expect(firstPayload.apiWalletPrivateKey).toBe("0x");
    expect(secondPayload.apiWalletPrivateKey).not.toBe("0x");
    expect(broker.nextDeadline()).toBe(3_600_000);

    broker.clearVault("vault-b");
    expect(secondPayload.apiWalletPrivateKey).toBe("0x");
    expect(broker.nextDeadline()).toBeUndefined();
  });

  test("fails closed when a replacement worker starts with a fresh broker", () => {
    const originalOwner = {};
    const reloadedOwner = {};
    const originalBroker = new ApiWalletSessionBroker<object>(() => 100);
    const replacementBroker = new ApiWalletSessionBroker<object>(() => 100);

    originalBroker.cache({
      sessionId: "session-a",
      vaultId: "vault-a",
      durationMs: 300_000,
      provisionalLifetimeMs: 15_000,
      payload: createPayload(),
      owner: originalOwner,
    });
    expect(originalBroker.commit("session-a", originalOwner)).toBe(true);
    expect(
      originalBroker.prepareHandoff({
        sessionId: "session-a",
        handoffToken: "token-a",
        handoffLifetimeMs: 15_000,
        owner: originalOwner,
      }),
    ).toBe(true);

    expect(
      replacementBroker.restore({
        sessionId: "session-a",
        handoffToken: "token-a",
        vaultId: "vault-a",
        owner: reloadedOwner,
      }),
    ).toBeNull();
    expect(replacementBroker.nextDeadline()).toBeUndefined();
  });

  test("renders the one-hour default first in Settings", async () => {
    const source = await Bun.file(
      new URL("../components/SettingsModal.tsx", import.meta.url),
    ).text();
    const firstRequirementSelect = source.indexOf(
      "value={passkeyRequirement()}",
    );
    const oneHour = source.indexOf(
      '<option value="one-hour">',
      firstRequirementSelect,
    );
    const fiveMinutes = source.indexOf('<option value="five-minutes">', oneHour);
    const everyRefresh = source.indexOf(
      '<option value="every-refresh">',
      fiveMinutes,
    );

    expect(firstRequirementSelect).toBeGreaterThan(-1);
    expect(source).toContain("Ask me to unlock again");
    expect(oneHour).toBeGreaterThan(-1);
    expect(fiveMinutes).toBeGreaterThan(oneHour);
    expect(everyRefresh).toBeGreaterThan(fiveMinutes);
  });
});
