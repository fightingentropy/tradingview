/** Wire contract shared by the phone, relay and the Mac mini price monitor. */
export interface RemotePriceRule {
  id: string;
  instrumentId: string;
  symbol: string;
  source: 'hyperliquid' | 'cboe';
  coinKey: string;
  direction: 'up' | 'down' | 'both';
  pct: number;
  anchorPrice: number;
  /** A rearm creates a new generation, even when the alert id is unchanged. */
  createdAt: number;
  /** A known trigger is retained for receipts but must never arm on a fresh device. */
  completed?: boolean;
}

export type PriceDeliveryState = 'pending' | 'sending' | 'accepted' | 'sent' | 'failed' | 'unconfirmed';
export interface RemotePriceEvent {
  key: string;
  alertId: string;
  createdAt: number;
  instrumentId: string;
  symbol: string;
  price: number;
  triggeredAt: number;
  changePct: number;
  delivery: PriceDeliveryState;
  detail?: string;
}

export interface PriceMonitorHealth {
  seenAt: number;
  lastHyperliquidAt: number | null;
  lastXyzAt: number | null;
  lastCboeAt: number | null;
  connected: boolean;
  pendingEvents: number;
  version: string;
}

export interface PriceMonitorSubscription {
  device: string;
  revision: number;
  rules: RemotePriceRule[];
}

export interface PriceAlertSyncResult {
  now: number;
  enabled: boolean;
  revision: number;
  monitorRevision: number;
  monitor: PriceMonitorHealth | null;
  events: RemotePriceEvent[];
}

export const EXPO_PUSH_TOKEN_PATTERN = /^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/;
export const MAX_REMOTE_PRICE_ALERTS = 100;
export const PRICE_MONITOR_VERSION = '1';

export function priceMonitorSignaturePayload(method: string, pathname: string, timestamp: string, body: string): string {
  return `${method.toUpperCase()}\n${pathname}\n${timestamp}\n${body}`;
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
}

export function normalizeRemotePriceRule(value: unknown): RemotePriceRule | null {
  if (!value || typeof value !== 'object') return null;
  const rule = value as Record<string, unknown>;
  if (!text(rule.id, 120) || !text(rule.instrumentId, 160) || !text(rule.symbol, 40) ||
      !text(rule.coinKey, 100) || typeof rule.direction !== 'string' || !['up', 'down', 'both'].includes(rule.direction) ||
      typeof rule.pct !== 'number' || !Number.isFinite(rule.pct) || rule.pct <= 0 || rule.pct > 10_000 ||
      typeof rule.anchorPrice !== 'number' || !Number.isFinite(rule.anchorPrice) || rule.anchorPrice <= 0 ||
      typeof rule.createdAt !== 'number' || !Number.isSafeInteger(rule.createdAt) || rule.createdAt <= 0 ||
      (rule.completed !== undefined && typeof rule.completed !== 'boolean')) return null;
  // Do not turn client input into an arbitrary URL or subscription method.
  const validSource = rule.source === 'hyperliquid'
    ? rule.instrumentId.startsWith('hl:') && /^[A-Za-z0-9@#._:\/-]+$/.test(rule.coinKey)
    : rule.source === 'cboe' && rule.instrumentId === 'cboe:VIX' && rule.coinKey === '_VIX';
  if (!validSource) return null;
  return {
    id: rule.id, instrumentId: rule.instrumentId, symbol: rule.symbol,
    source: rule.source as RemotePriceRule['source'], coinKey: rule.coinKey,
    direction: rule.direction as RemotePriceRule['direction'], pct: rule.pct,
    anchorPrice: rule.anchorPrice, createdAt: rule.createdAt,
    ...(rule.completed === true ? { completed: true } : {}),
  };
}

export function remotePriceRuleKey(rule: Pick<RemotePriceRule, 'id' | 'createdAt'>): string {
  return `${rule.id}:${rule.createdAt}`;
}

export function priceAlertMove(rule: Pick<RemotePriceRule, 'anchorPrice' | 'pct' | 'direction'> & { instrumentId?: string }, price: number): number | null {
  if (!Number.isFinite(price) || price < 0 || (price === 0 && !rule.instrumentId?.startsWith('hl:outcome:')) || !Number.isFinite(rule.anchorPrice) || rule.anchorPrice <= 0) return null;
  const pct = ((price - rule.anchorPrice) / rule.anchorPrice) * 100;
  const hit = rule.direction === 'up' ? pct >= rule.pct
    : rule.direction === 'down' ? pct <= -rule.pct : Math.abs(pct) >= rule.pct;
  return hit ? pct : null;
}

export function priceAlertDeliveryLabel(state: PriceDeliveryState): string {
  switch (state) {
    case 'pending': return 'Notification queued';
    case 'sending': return 'Sending notification';
    case 'accepted': return 'Accepted by push service';
    case 'sent': return 'Notification sent';
    case 'failed': return 'Notification failed';
    case 'unconfirmed': return 'Notification status unconfirmed';
  }
}

export function priceMonitorLabel(result: PriceAlertSyncResult | null, sources: readonly string[], now = Date.now()): string {
  if (!result?.enabled) return 'Waiting for alert sync';
  const health = result.monitor;
  if (!health || now - health.seenAt > 60_000) return 'Mac mini is offline';
  if (result.monitorRevision !== result.revision) return 'Waiting for Mac mini to sync';
  if (sources.includes('hyperliquid') && (!health.connected || !health.lastHyperliquidAt || now - health.lastHyperliquidAt > 45_000)) {
    return 'Mac mini is reconnecting to prices';
  }
  if (sources.includes('xyz') && (!health.connected || !health.lastXyzAt || now - health.lastXyzAt > 45_000)) return 'Mac mini is reconnecting to trade.xyz';
  if (sources.includes('cboe') && (!health.lastCboeAt || now - health.lastCboeAt > 150_000)) return 'Cboe quotes are unavailable';
  return sources.includes('cboe') ? 'Monitoring on Mac mini · Cboe delayed' : 'Monitoring on Mac mini';
}
