import { mmkvStorage } from '@/lib/mmkv';
import { createOrderRecovery } from '@/lib/orderRecovery';

/** Synchronous hydration/write: the journal is durable before any order POST. */
export const orderRecovery = createOrderRecovery(mmkvStorage);

/** Native has one JS runtime; journal writes and final guards are synchronous. */
export async function withOrderRecoveryLock<T>(operation: () => Promise<T> | T): Promise<T> {
  return operation();
}
