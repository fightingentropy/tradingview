import { createOrderRecovery, ORDER_RECOVERY_STORAGE_KEY } from '@/lib/orderRecovery';

// Trading needs durable persistence. The general preferences adapter may fall
// back to memory, but allowing that here would forget an order after reload.
export const orderRecovery = createOrderRecovery({
  getItem(key) {
    if (typeof window === 'undefined') return null; // static rendering only
    return window.localStorage.getItem(key);
  },
  setItem(key, value) {
    if (typeof window === 'undefined') throw new Error('Persistent storage unavailable');
    window.localStorage.setItem(key, value);
    if (window.localStorage.getItem(key) !== value) throw new Error('Order journal write was not retained');
  },
});

// Keep separate tabs from overwriting each other's journal. The lock covers the
// sign/POST boundary and reconciliation/review writes; unsupported browsers fail
// closed rather than pretending a process-local flag is an account-wide lock.
export async function withOrderRecoveryLock<T>(operation: () => Promise<T> | T): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    throw new Error('This browser cannot safely coordinate order recovery. Use the mobile app or a browser with Web Locks support.');
  }
  return navigator.locks.request('tradingview-order-recovery', { mode: 'exclusive' }, async () => {
    orderRecovery.refresh();
    return operation();
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === ORDER_RECOVERY_STORAGE_KEY || event.key === null) orderRecovery.refresh();
  });
}
