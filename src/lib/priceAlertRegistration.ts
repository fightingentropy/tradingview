import { MAX_REMOTE_PRICE_ALERTS, normalizeRemotePriceRule, priceAlertMove, type RemotePriceRule } from '../domain/priceAlerts';
import type { Instrument, PriceAlert } from '../domain/types';

export function buildRemotePriceRules(alerts: PriceAlert[], instruments: Record<string, Instrument>, showOutcomes: boolean): RemotePriceRule[] {
  const rules = alerts.filter(alert => (alert.triggeredAt === null || alert.remoteTriggered) &&
    (showOutcomes || !alert.instrumentId.startsWith('hl:outcome:'))).map(alert => {
    const instrument = instruments[alert.instrumentId];
    if (!instrument) throw new Error(`Waiting for ${alert.symbol} market data before syncing alerts.`);
    const rule = normalizeRemotePriceRule({ ...alert, source: instrument.source, coinKey: instrument.coinKey,
      completed: alert.remoteTriggered === true });
    if (!rule) throw new Error(`The ${alert.symbol} alert needs to be recreated.`);
    return rule;
  });
  if (rules.length > MAX_REMOTE_PRICE_ALERTS) throw new Error(`At most ${MAX_REMOTE_PRICE_ALERTS} remote price alerts are supported.`);
  return rules.sort((a, b) => a.id.localeCompare(b.id));
}

/** Untrusted notification payloads cannot trip a deleted or rearmed generation. */
export function priceAlertNotificationMatch(data: Record<string, unknown>, alerts: PriceAlert[], now = Date.now()) {
  if (data.type !== 'price-alert' || typeof data.alertId !== 'string' || typeof data.createdAt !== 'number' ||
      typeof data.price !== 'number' || typeof data.triggeredAt !== 'number' || !Number.isFinite(data.triggeredAt) ||
      data.triggeredAt < data.createdAt || data.triggeredAt > now + 60_000) return null;
  const alert = alerts.find(candidate => candidate.id === data.alertId && candidate.createdAt === data.createdAt &&
    candidate.instrumentId === data.instrumentId);
  if (!alert) return null;
  const changePct = priceAlertMove(alert, data.price);
  return changePct === null ? null : { alert, price: data.price, triggeredAt: data.triggeredAt, changePct };
}
