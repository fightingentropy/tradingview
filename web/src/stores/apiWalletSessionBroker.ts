type HyperliquidNetwork = "mainnet" | "testnet";

type SessionVaultPayload = {
  version: 1;
  network: HyperliquidNetwork;
  masterAddress: `0x${string}`;
  agentAddress: `0x${string}`;
  apiWalletPrivateKey: `0x${string}`;
};

type SessionEntry<Owner extends object> = {
  vaultId: string;
  expiresAtWall: number;
  expiresAtMonotonic: number;
  payload: SessionVaultPayload;
  owner: Owner;
  provisionalExpiresAtWall?: number;
  provisionalExpiresAtMonotonic?: number;
  handoffToken?: string;
  handoffExpiresAtWall?: number;
  handoffExpiresAtMonotonic?: number;
};

type ApiWalletSessionClock = {
  wallNow: () => number;
  monotonicNow: () => number;
};

class ApiWalletSessionBroker<Owner extends object> {
  readonly #sessions = new Map<string, SessionEntry<Owner>>();
  readonly #revokedVaults = new Set<string>();
  readonly #clock: ApiWalletSessionClock;

  constructor(clock: ApiWalletSessionClock | (() => number)) {
    this.#clock =
      typeof clock === "function"
        ? { wallNow: clock, monotonicNow: clock }
        : clock;
  }

  cache(input: {
    sessionId: string;
    vaultId: string;
    durationMs: number;
    provisionalLifetimeMs: number;
    payload: SessionVaultPayload;
    owner: Owner;
  }): boolean {
    if (this.#revokedVaults.has(input.vaultId)) {
      input.payload.apiWalletPrivateKey = "0x";
      return false;
    }
    const wallNow = this.#clock.wallNow();
    const monotonicNow = this.#clock.monotonicNow();
    for (const [sessionId, entry] of this.#sessions) {
      if (entry.vaultId === input.vaultId) this.#clearEntry(sessionId);
    }
    this.#sessions.set(input.sessionId, {
      vaultId: input.vaultId,
      expiresAtWall: wallNow + input.durationMs,
      expiresAtMonotonic: monotonicNow + input.durationMs,
      payload: input.payload,
      owner: input.owner,
      provisionalExpiresAtWall: wallNow + input.provisionalLifetimeMs,
      provisionalExpiresAtMonotonic: monotonicNow + input.provisionalLifetimeMs,
    });
    return true;
  }

  commit(sessionId: string, owner: Owner): boolean {
    this.clearExpired();
    const entry = this.#sessions.get(sessionId);
    if (!entry || entry.owner !== owner) return false;
    entry.provisionalExpiresAtWall = undefined;
    entry.provisionalExpiresAtMonotonic = undefined;
    return true;
  }

  prepareHandoff(input: {
    sessionId: string;
    handoffToken: string;
    handoffLifetimeMs: number;
    owner: Owner;
  }): boolean {
    this.clearExpired();
    const entry = this.#sessions.get(input.sessionId);
    if (
      !entry ||
      entry.owner !== input.owner ||
      entry.provisionalExpiresAtWall !== undefined
    ) {
      return false;
    }
    const wallNow = this.#clock.wallNow();
    const monotonicNow = this.#clock.monotonicNow();
    entry.handoffToken = input.handoffToken;
    entry.handoffExpiresAtWall = Math.min(
      entry.expiresAtWall,
      wallNow + input.handoffLifetimeMs,
    );
    entry.handoffExpiresAtMonotonic = Math.min(
      entry.expiresAtMonotonic,
      monotonicNow + input.handoffLifetimeMs,
    );
    return true;
  }

  restore(input: {
    sessionId: string;
    handoffToken: string;
    vaultId: string;
    owner: Owner;
  }): SessionVaultPayload | null {
    this.clearExpired();
    const entry = this.#sessions.get(input.sessionId);
    const wallNow = this.#clock.wallNow();
    const monotonicNow = this.#clock.monotonicNow();
    if (
      !entry ||
      entry.vaultId !== input.vaultId ||
      entry.handoffToken !== input.handoffToken ||
      entry.handoffExpiresAtWall === undefined ||
      entry.handoffExpiresAtMonotonic === undefined ||
      this.#deadlineExpired(
        entry.handoffExpiresAtWall,
        entry.handoffExpiresAtMonotonic,
        wallNow,
        monotonicNow,
      ) ||
      this.#deadlineExpired(
        entry.expiresAtWall,
        entry.expiresAtMonotonic,
        wallNow,
        monotonicNow,
      )
    ) {
      return null;
    }
    entry.handoffToken = undefined;
    entry.handoffExpiresAtWall = undefined;
    entry.handoffExpiresAtMonotonic = undefined;
    entry.owner = input.owner;
    return entry.payload;
  }

  clear(sessionId: string, owner: Owner): boolean {
    const entry = this.#sessions.get(sessionId);
    if (!entry || entry.owner !== owner) return false;
    this.#clearEntry(sessionId);
    return true;
  }

  clearVault(vaultId: string) {
    for (const [sessionId, entry] of this.#sessions) {
      if (entry.vaultId === vaultId) this.#clearEntry(sessionId);
    }
  }

  revokeVault(vaultId: string) {
    this.#revokedVaults.add(vaultId);
    this.clearVault(vaultId);
  }

  clearExpired() {
    const wallNow = this.#clock.wallNow();
    const monotonicNow = this.#clock.monotonicNow();
    for (const [sessionId, entry] of this.#sessions) {
      if (
        this.#deadlineExpired(
          entry.expiresAtWall,
          entry.expiresAtMonotonic,
          wallNow,
          monotonicNow,
        )
      ) {
        this.#clearEntry(sessionId);
        continue;
      }
      if (
        entry.provisionalExpiresAtWall !== undefined &&
        entry.provisionalExpiresAtMonotonic !== undefined &&
        this.#deadlineExpired(
          entry.provisionalExpiresAtWall,
          entry.provisionalExpiresAtMonotonic,
          wallNow,
          monotonicNow,
        )
      ) {
        this.#clearEntry(sessionId);
        continue;
      }
      if (
        entry.handoffExpiresAtWall !== undefined &&
        entry.handoffExpiresAtMonotonic !== undefined &&
        this.#deadlineExpired(
          entry.handoffExpiresAtWall,
          entry.handoffExpiresAtMonotonic,
          wallNow,
          monotonicNow,
        )
      ) {
        this.#clearEntry(sessionId);
      }
    }
  }

  nextDeadline(): number | undefined {
    const deadlines = Array.from(this.#sessions.values()).flatMap((entry) => [
      entry.expiresAtWall,
      ...(entry.handoffExpiresAtWall === undefined
        ? []
        : [entry.handoffExpiresAtWall]),
      ...(entry.provisionalExpiresAtWall === undefined
        ? []
        : [entry.provisionalExpiresAtWall]),
    ]);
    return deadlines.length === 0 ? undefined : Math.min(...deadlines);
  }

  nextDelay(): number | undefined {
    if (this.#sessions.size === 0) return undefined;
    const wallNow = this.#clock.wallNow();
    const monotonicNow = this.#clock.monotonicNow();
    let delay = Number.POSITIVE_INFINITY;
    for (const entry of this.#sessions.values()) {
      delay = Math.min(
        delay,
        entry.expiresAtWall - wallNow,
        entry.expiresAtMonotonic - monotonicNow,
      );
      if (
        entry.provisionalExpiresAtWall !== undefined &&
        entry.provisionalExpiresAtMonotonic !== undefined
      ) {
        delay = Math.min(
          delay,
          entry.provisionalExpiresAtWall - wallNow,
          entry.provisionalExpiresAtMonotonic - monotonicNow,
        );
      }
      if (
        entry.handoffExpiresAtWall !== undefined &&
        entry.handoffExpiresAtMonotonic !== undefined
      ) {
        delay = Math.min(
          delay,
          entry.handoffExpiresAtWall - wallNow,
          entry.handoffExpiresAtMonotonic - monotonicNow,
        );
      }
    }
    return Math.max(0, delay);
  }

  #deadlineExpired(
    wallDeadline: number,
    monotonicDeadline: number,
    wallNow: number,
    monotonicNow: number,
  ) {
    return wallDeadline <= wallNow || monotonicDeadline <= monotonicNow;
  }

  #clearEntry(sessionId: string) {
    const entry = this.#sessions.get(sessionId);
    if (!entry) return;
    entry.payload.apiWalletPrivateKey = "0x";
    entry.provisionalExpiresAtWall = undefined;
    entry.provisionalExpiresAtMonotonic = undefined;
    entry.handoffToken = undefined;
    entry.handoffExpiresAtWall = undefined;
    entry.handoffExpiresAtMonotonic = undefined;
    this.#sessions.delete(sessionId);
  }
}

export {
  ApiWalletSessionBroker,
  type ApiWalletSessionClock,
  type SessionVaultPayload,
};
