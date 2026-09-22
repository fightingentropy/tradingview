type Request = { type: string; user?: string; dex?: string | null };
type Entry = { value: unknown; expiresAt: number };

/** Account display data only. Order preflight always uses an uncached HTTP read. */
export class DisplayReadCache {
  private values = new Map<string, Entry>();
  private pending = new Map<string, Promise<unknown>>();

  private key(network: string, request: Request) {
    return JSON.stringify([network, request.type, request.user?.toLowerCase() ?? '', request.dex ?? '']);
  }

  put(network: string, request: Request, value: unknown, ttl: number) {
    const key = this.key(network, request);
    this.values.delete(key);
    this.values.set(key, { value, expiresAt: Date.now() + ttl });
    // Bound public account/market snapshots when switching between addresses.
    while (this.values.size > 128) this.values.delete(this.values.keys().next().value!);
  }

  invalidateAccount(network: string, user: string) {
    for (const key of this.values.keys()) {
      const [entryNetwork, , entryUser] = JSON.parse(key);
      if (entryNetwork === network && entryUser === user.toLowerCase()) this.values.delete(key);
    }
  }

  read<T>(network: string, request: Request, load: () => Promise<T>): Promise<T> {
    const key = this.key(network, request);
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T);
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;
    const ttl = request.type === 'spotMetaAndAssetCtxs' || request.type === 'userVaultEquities' ? 60_000
      : request.type === 'userAbstraction' ? 15_000 : 1_000;
    const promise = load().then(value => {
      // Do not overwrite a newer streamed snapshot with an older HTTP response.
      const current = this.values.get(key);
      if (current === cached) this.put(network, request, value, ttl);
      else if (current && current.expiresAt > Date.now()) return current.value as T;
      return value;
    }).finally(() => { if (this.pending.get(key) === promise) this.pending.delete(key); });
    this.pending.set(key, promise);
    return promise;
  }
}

export const displayReadCache = new DisplayReadCache();

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Reject crossed-account frames and incomplete summaries; HTTP remains the fallback. */
export function acceptAccountSnapshot(network: string, user: string, channel: string, data: unknown) {
  if (!record(data) || typeof data.user !== 'string' || data.user.toLowerCase() !== user.toLowerCase()) return;
  if (channel === 'spotState') {
    if (record(data.spotState) && Array.isArray(data.spotState.balances)) {
      displayReadCache.put(network, { type: 'spotClearinghouseState', user }, data.spotState, 5_000);
    }
  } else if (channel === 'allDexsClearinghouseState' && Array.isArray(data.clearinghouseStates)) {
    for (const item of data.clearinghouseStates) {
      if (!Array.isArray(item) || typeof item[0] !== 'string' || !record(item[1])) continue;
      const [dex, state] = item;
      if (!record(state.marginSummary) || !record(state.crossMarginSummary) || !Array.isArray(state.assetPositions)) continue;
      displayReadCache.put(network, { type: 'clearinghouseState', user, dex }, state, 5_000);
    }
  }
}
