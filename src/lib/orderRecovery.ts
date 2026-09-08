/** Durable journal for ambiguous order POSTs. Contains public metadata, never keys/signatures. */
export type RecoveryNetwork = 'mainnet' | 'testnet';
export interface RecoveryLeg {
  clientId: string;
  label: string;
  status: string | null;
}
export interface PendingOrderAttempt {
  id: string;
  network: RecoveryNetwork;
  accountAddress: string;
  coin: string | null;
  startedAt: number;
  legs: RecoveryLeg[];
}
export interface RecoverySnapshot {
  attempts: PendingOrderAttempt[];
  storageError: string | null;
}
export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const ORDER_RECOVERY_STORAGE_KEY = 'order-recovery-v1';
const STORAGE_KEY = ORDER_RECOVERY_STORAGE_KEY;
const CLIENT_ID = /^0x[0-9a-f]{32}$/i;
const KNOWN_STATUSES = new Set([
  'open', 'filled', 'canceled', 'triggered', 'rejected', 'marginCanceled',
  'vaultWithdrawalCanceled', 'openInterestCapCanceled', 'selfTradeCanceled',
  'reduceOnlyCanceled', 'siblingFilledCanceled', 'delistedCanceled',
  'liquidatedCanceled', 'scheduledCancel', 'tickRejected', 'minTradeNtlRejected',
  'perpMarginRejected', 'reduceOnlyRejected', 'badAloPxRejected', 'iocCancelRejected',
  'badTriggerPxRejected', 'marketOrderNoLiquidityRejected',
  'positionIncreaseAtOpenInterestCapRejected', 'positionFlipAtOpenInterestCapRejected',
  'tooAggressiveAtOpenInterestCapRejected', 'openInterestIncreaseRejected',
  'insufficientSpotBalanceRejected', 'oracleRejected', 'perpMaxPositionRejected',
]);
const ACK_STATUSES = new Set(['filled', 'resting', 'waitingForFill', 'waitingForTrigger', 'error']);
export const recoveryComplete = (attempt: PendingOrderAttempt) =>
  attempt.legs.length > 0 && attempt.legs.every((leg) => leg.status !== null);

/** CLOIDs are unique labels, not signing material. Timestamp plus 80 random bits. */
export function newClientOrderId(now = Date.now(), random = Math.random): string {
  let suffix = '';
  for (let i = 0; i < 20; i++) suffix += Math.floor(random() * 16).toString(16);
  return `0x${now.toString(16).padStart(12, '0').slice(-12)}${suffix}`;
}

/** An absent, malformed, mismatched, or newly introduced status cannot prove resolution. */
export function confirmedOrderStatus(raw: unknown, clientId: string, coin: string | null): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const envelope = raw as { status?: unknown; order?: { status?: unknown; order?: { cloid?: unknown; coin?: unknown } } };
  const order = envelope.order;
  if (
    envelope.status !== 'order' || typeof order?.status !== 'string' ||
    !KNOWN_STATUSES.has(order.status) ||
    typeof order.order?.cloid !== 'string' ||
    order.order.cloid.toLowerCase() !== clientId.toLowerCase() ||
    (coin !== null && order.order.coin !== coin)
  ) return null;
  return order.status;
}

function validAttempt(value: unknown): value is PendingOrderAttempt {
  if (!value || typeof value !== 'object') return false;
  const a = value as PendingOrderAttempt;
  return CLIENT_ID.test(a.id) && (a.network === 'mainnet' || a.network === 'testnet') &&
    typeof a.accountAddress === 'string' && /^0x[0-9a-f]{40}$/i.test(a.accountAddress) &&
    (a.coin === null || typeof a.coin === 'string') && Number.isFinite(a.startedAt) &&
    Array.isArray(a.legs) && a.legs.length > 0 && a.legs.every((leg) =>
      CLIENT_ID.test(leg.clientId) && typeof leg.label === 'string' &&
      (leg.status === null || (typeof leg.status === 'string' && (KNOWN_STATUSES.has(leg.status) || ACK_STATUSES.has(leg.status))))) &&
    a.legs[0].clientId === a.id && new Set(a.legs.map((leg) => leg.clientId)).size === a.legs.length;
}

export function createOrderRecovery(storage: RecoveryStorage) {
  let snapshot: RecoverySnapshot = { attempts: [], storageError: null };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let serialized: string | null | undefined;
  const refresh = () => {
    try {
      const text = storage.getItem(STORAGE_KEY);
      if (text === serialized && !snapshot.storageError) return;
      if (text === null && snapshot.attempts.length > 0) throw new Error('Pending journal disappeared');
      const saved: unknown = text === null ? [] : JSON.parse(text);
      if (!Array.isArray(saved) || !saved.every(validAttempt)) throw new Error('Invalid order recovery journal');
      snapshot = { attempts: saved, storageError: null };
      serialized = text;
    } catch {
      snapshot = { ...snapshot, storageError: 'Order recovery could not be loaded. New orders are paused to prevent duplicates.' };
    }
    notify();
  };
  refresh();
  const commit = (attempts: PendingOrderAttempt[]) => {
    if (snapshot.storageError) throw new Error(snapshot.storageError);
    try {
      const text = JSON.stringify(attempts);
      storage.setItem(STORAGE_KEY, text);
      serialized = text;
    } catch {
      snapshot = { ...snapshot, storageError: 'Order recovery could not be saved. New orders are paused to prevent duplicates.' };
      notify();
      throw new Error(snapshot.storageError!);
    }
    snapshot = { attempts, storageError: null };
    notify();
  };
  const assertCanSubmit = (network: RecoveryNetwork, address: string) => {
    refresh();
    if (snapshot.storageError) throw new Error(snapshot.storageError);
    if (snapshot.attempts.some((a) => a.network === network && a.accountAddress.toLowerCase() === address.toLowerCase())) {
      throw new Error('A previous order is still being checked. Review its status in Account before placing another order.');
    }
  };
  return {
    getSnapshot: () => snapshot,
    refresh,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    assertCanSubmit,
    begin(attempt: PendingOrderAttempt) {
      assertCanSubmit(attempt.network, attempt.accountAddress);
      if (!validAttempt(attempt)) throw new Error('Invalid pending order metadata; no order was sent.');
      commit([...snapshot.attempts, attempt]);
    },
    /** Only callers with a definitive POST response, or proof POST never began, may use this. */
    discardConfirmed(id: string) {
      refresh();
      commit(snapshot.attempts.filter((a) => a.id !== id));
    },
    acknowledge(id: string) {
      refresh();
      const attempt = snapshot.attempts.find((a) => a.id === id);
      if (!attempt || !recoveryComplete(attempt)) throw new Error('Order status is still unknown.');
      commit(snapshot.attempts.filter((a) => a.id !== id));
    },
    recordAcknowledgements(id: string, statuses: string[]) {
      refresh();
      const attempt = snapshot.attempts.find((a) => a.id === id);
      if (!attempt) return;
      const legs = attempt.legs.map((leg, i) => ({ ...leg, status: ACK_STATUSES.has(statuses[i]) ? statuses[i] : null }));
      // A complete direct response is displayed by the originating ticket. A lost/
      // partial response remains in Account until every leg is found and reviewed.
      if (legs.every((leg) => leg.status !== null)) {
        commit(snapshot.attempts.filter((a) => a.id !== id));
      } else {
        commit(snapshot.attempts.map((a) => a.id === id ? { ...a, legs } : a));
      }
    },
    async reconcile(network: RecoveryNetwork, address: string, lookup: (a: PendingOrderAttempt, clientId: string) => Promise<unknown>) {
      refresh();
      const attempts = snapshot.attempts.filter((a) => a.network === network && a.accountAddress.toLowerCase() === address.toLowerCase());
      // Never infer rejection from repeated absence or elapsed time. Lookup can lag
      // an accepted request, and a request can be accepted after our timeout.
      for (const attempt of attempts) {
        const results = await Promise.all(attempt.legs.map(async (leg) => {
          if (leg.status !== null) return leg.status;
          return confirmedOrderStatus(await lookup(attempt, leg.clientId), leg.clientId, attempt.coin);
        }));
        refresh();
        const current = snapshot.attempts.find((a) => a.id === attempt.id);
        if (!current) continue;
        const legs = current.legs.map((leg, i) => ({ ...leg, status: leg.status ?? results[i] }));
        if (legs.some((leg, i) => leg.status !== current.legs[i].status)) {
          commit(snapshot.attempts.map((a) => a.id === attempt.id ? { ...a, legs } : a));
        }
      }
    },
  };
}
