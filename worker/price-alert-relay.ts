// eslint-disable-next-line import/no-unresolved -- Built into the Cloudflare Workers runtime.
import { DurableObject } from 'cloudflare:workers';
import {
  EXPO_PUSH_TOKEN_PATTERN, MAX_REMOTE_PRICE_ALERTS, normalizeRemotePriceRule,
  priceAlertMove, remotePriceRuleKey,
  type PriceAlertSyncResult, type PriceMonitorHealth, type PriceMonitorSubscription,
  type RemotePriceEvent, type RemotePriceRule,
} from '../src/domain/priceAlerts';

interface Subscription {
  token: string;
  enabled: boolean;
  revision: number;
  monitorRevision: number;
  rules: RemotePriceRule[];
}
interface StoredEvent extends RemotePriceEvent {
  device: string;
  receiptId?: string;
  updatedAt: number;
  attempts: number;
  retryAt?: number;
  dispatchId?: string;
  receiptCheckedAt?: number;
}
type JsonRow = { payload: string };
const SEND = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';

/** A mailbox per monitor installation. No price polling, timers or alarms run here. */
export class MacMiniAlertRelay extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (device TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (key TEXT PRIMARY KEY, device TEXT NOT NULL, updated_at INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS monitor (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
    `);
  }

  private subscription(device: string): Subscription | null {
    const row = this.ctx.storage.sql.exec<JsonRow>('SELECT payload FROM subscriptions WHERE device = ?', device).toArray()[0];
    return row ? JSON.parse(row.payload) as Subscription : null;
  }

  private saveSubscription(device: string, subscription: Subscription): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO subscriptions (device,payload) VALUES (?,?)', device, JSON.stringify(subscription));
  }

  private saveEvent(event: StoredEvent): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO events (key,device,updated_at,payload) VALUES (?,?,?,?)',
      event.key, event.device, event.updatedAt, JSON.stringify(event));
  }

  private loadEvent(key: string): StoredEvent | null {
    const row = this.ctx.storage.sql.exec<JsonRow>('SELECT payload FROM events WHERE key=?', key).toArray()[0];
    return row ? JSON.parse(row.payload) as StoredEvent : null;
  }

  private pruneSupersededEvents(): void {
    // A disabled subscription still owns its generations. Keep those tombstones
    // so restoring permission cannot rearm an alert that already fired.
    this.ctx.storage.sql.exec(`DELETE FROM events
      WHERE json_extract(events.payload,'$.delivery') IN ('sent','failed','unconfirmed')
      AND NOT EXISTS (
        SELECT 1 FROM subscriptions, json_each(subscriptions.payload,'$.rules') AS rule
        WHERE subscriptions.device=events.device
          AND json_extract(rule.value,'$.id')=json_extract(events.payload,'$.alertId')
          AND json_extract(rule.value,'$.createdAt')=json_extract(events.payload,'$.createdAt')
      )`);
  }

  private finishDispatch(event: StoredEvent): void {
    this.ctx.storage.sql.exec(`UPDATE events SET updated_at=?,payload=? WHERE key=?
      AND json_extract(payload,'$.dispatchId')=? AND json_extract(payload,'$.delivery')='sending'`,
    event.updatedAt, JSON.stringify(event), event.key, event.dispatchId ?? '');
    this.pruneSupersededEvents();
  }

  private publicEvent(event: StoredEvent): RemotePriceEvent {
    return {
      key: event.key, alertId: event.alertId, createdAt: event.createdAt,
      instrumentId: event.instrumentId, symbol: event.symbol, price: event.price,
      triggeredAt: event.triggeredAt, changePct: event.changePct,
      delivery: event.delivery, ...(event.detail ? { detail: event.detail } : {}),
    };
  }

  async syncDevice(device: string, token: string, enabled: boolean, rawRules: unknown[]): Promise<PriceAlertSyncResult> {
    const previous = this.subscription(device);
    // Disabling pauses the authoritative generations, including triggers the
    // phone has not learned about yet. A later enable must not rearm them.
    const retainedRules = !enabled && previous ? previous.rules : rawRules;
    if (!EXPO_PUSH_TOKEN_PATTERN.test(token) || retainedRules.length > MAX_REMOTE_PRICE_ALERTS) throw new Error('Invalid alert subscription');
    const rules = retainedRules.map(normalizeRemotePriceRule);
    if (rules.some(rule => !rule) || new Set(rules.map(rule => rule!.id)).size !== rules.length) throw new Error('Invalid price alert');
    const normalized = (rules as RemotePriceRule[]).sort((a, b) => a.id.localeCompare(b.id));
    if (!previous && this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM subscriptions').one().count >= 25) {
      throw new Error('The device limit has been reached');
    }
    const changed = !previous || previous.enabled !== enabled || JSON.stringify(previous.rules) !== JSON.stringify(normalized);
    const subscription: Subscription = {
      token, enabled, rules: normalized,
      revision: (previous?.revision ?? 0) + (changed ? 1 : 0),
      monitorRevision: previous?.monitorRevision ?? 0,
    };
    if (changed || previous?.token !== token) {
      this.saveSubscription(device, subscription);
      if (changed) this.pruneSupersededEvents();
    }
    return this.deviceStatus(device, subscription);
  }

  async deleteDevice(device: string): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM subscriptions WHERE device = ?', device);
    this.ctx.storage.sql.exec('DELETE FROM events WHERE device = ?', device);
  }

  private deviceStatus(device: string, subscription: Subscription): PriceAlertSyncResult {
    const monitorRow = this.ctx.storage.sql.exec<JsonRow>('SELECT payload FROM monitor WHERE id=1').toArray()[0];
    const events = this.ctx.storage.sql.exec<JsonRow>('SELECT payload FROM events WHERE device=? ORDER BY updated_at DESC LIMIT 100', device)
      .toArray().map(row => this.publicEvent(JSON.parse(row.payload) as StoredEvent));
    return {
      now: Date.now(), enabled: subscription.enabled, revision: subscription.revision,
      monitorRevision: subscription.monitorRevision,
      monitor: monitorRow ? JSON.parse(monitorRow.payload) as PriceMonitorHealth : null, events,
    };
  }

  async syncMonitor(health: Omit<PriceMonitorHealth, 'seenAt'>, appliedRevisions: Record<string, number>): Promise<{ subscriptions: PriceMonitorSubscription[]; now: number }> {
    const now = Date.now();
    const storedHealth: PriceMonitorHealth = { ...health, seenAt: now };
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO monitor(id,payload) VALUES(1,?)', JSON.stringify(storedHealth));
    const rows = this.ctx.storage.sql.exec<{ device: string; payload: string }>('SELECT device,payload FROM subscriptions').toArray();
    const subscriptions: PriceMonitorSubscription[] = [];
    for (const row of rows) {
      const subscription = JSON.parse(row.payload) as Subscription;
      if (appliedRevisions[row.device] === subscription.revision && subscription.monitorRevision !== subscription.revision) {
        subscription.monitorRevision = subscription.revision;
        this.saveSubscription(row.device, subscription);
      }
      if (!subscription.enabled) continue;
      const rules = subscription.rules.filter(rule => !rule.completed && !this.ctx.storage.sql.exec(
        'SELECT key FROM events WHERE key=?', `${row.device}:${remotePriceRuleKey(rule)}`,
      ).toArray().length);
      subscriptions.push({ device: row.device, revision: subscription.revision, rules });
    }
    // Notification receipts/retries advance only when the Mac mini checks in.
    // Keep old event records for the active generation so restarts never rearm it.
    this.ctx.waitUntil(this.advanceDelivery());
    return { subscriptions, now };
  }

  async trigger(device: string, alertId: string, generation: number, price: number, triggeredAt: number): Promise<{ accepted: boolean; event?: RemotePriceEvent }> {
    const key = `${device}:${alertId}:${generation}`;
    const existing = this.ctx.storage.sql.exec<JsonRow>('SELECT payload FROM events WHERE key=?', key).toArray()[0];
    if (existing) return { accepted: true, event: this.publicEvent(JSON.parse(existing.payload) as StoredEvent) };
    const subscription = this.subscription(device);
    const rule = subscription?.enabled ? subscription.rules.find(candidate => candidate.id === alertId && candidate.createdAt === generation && !candidate.completed) : undefined;
    // Cancellation and rearming are checked against authoritative, strongly consistent rules.
    if (!rule || !Number.isFinite(triggeredAt) || triggeredAt < rule.createdAt || triggeredAt > Date.now() + 60_000) return { accepted: false };
    const changePct = priceAlertMove(rule, price);
    if (changePct === null) return { accepted: false };
    const event: StoredEvent = {
      key, device, alertId, createdAt: generation, instrumentId: rule.instrumentId,
      symbol: rule.symbol, price, triggeredAt, changePct, delivery: 'pending', updatedAt: Date.now(), attempts: 0,
    };
    this.saveEvent(event);
    await this.dispatch(event);
    return { accepted: true, event: this.publicEvent(event) };
  }

  private async dispatch(event: StoredEvent): Promise<void> {
    const current = this.loadEvent(event.key);
    if (!current || current.delivery !== 'pending') return;
    Object.assign(event, current);
    const subscription = this.subscription(event.device);
    const active = subscription?.enabled && subscription.rules.some(rule => rule.id === event.alertId && rule.createdAt === event.createdAt);
    if (!active || !subscription) {
      event.delivery = 'failed'; event.detail = 'Alert was disabled before notification dispatch';
      this.saveEvent(event); this.pruneSupersededEvents(); return;
    }
    // Claim durably before external I/O. A duplicate trigger cannot send twice.
    event.delivery = 'sending'; event.updatedAt = Date.now(); event.attempts++;
    event.dispatchId = crypto.randomUUID();
    this.saveEvent(event);
    await this.ctx.storage.sync();
    try {
      const response = await fetch(SEND, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: subscription.token, title: `${event.symbol} price alert`,
          body: `${event.changePct >= 0 ? '+' : ''}${event.changePct.toFixed(2)}% · ${event.price.toLocaleString('en-US', { maximumFractionDigits: 8 })}`,
          sound: 'default', data: { type: 'price-alert', eventKey: event.key, alertId: event.alertId,
            createdAt: event.createdAt, instrumentId: event.instrumentId, price: event.price, triggeredAt: event.triggeredAt },
        }), signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        // Retry an explicit rejection with backoff. A lost response below stays unconfirmed.
        event.delivery = (response.status === 429 || response.status >= 500) && event.attempts < 5 ? 'pending' : 'failed';
        event.retryAt = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** event.attempts);
        event.detail = `Push service returned ${response.status}`;
      } else {
        const payload = await response.json() as { data?: { status?: string; id?: string; details?: { error?: string } } };
        if (payload.data?.status === 'ok' && payload.data.id) {
          event.delivery = 'accepted'; event.receiptId = payload.data.id; delete event.detail;
        } else {
          event.delivery = 'failed'; event.detail = payload.data?.details?.error ?? 'Push service rejected the notification';
        }
      }
    } catch {
      event.delivery = 'unconfirmed'; event.detail = 'Push response was lost; the recorded price trigger is preserved';
    }
    event.updatedAt = Date.now(); this.finishDispatch(event);
  }

  private async advanceDelivery(): Promise<void> {
    const now = Date.now();
    const interrupted = this.ctx.storage.sql.exec<JsonRow>(`SELECT payload FROM events
      WHERE (json_extract(payload,'$.delivery')='sending' AND updated_at<?)
        OR (json_extract(payload,'$.delivery')='accepted' AND updated_at<?)
      ORDER BY updated_at ASC LIMIT 100`, now - 30_000, now - 24 * 60 * 60_000)
      .toArray().map(row => JSON.parse(row.payload) as StoredEvent);
    for (const event of interrupted) {
      event.detail = event.delivery === 'sending' ? 'Notification dispatch was interrupted' : 'No push receipt was available';
      event.delivery = 'unconfirmed'; event.updatedAt = now; this.saveEvent(event);
    }
    this.pruneSupersededEvents();
    // Waiting receipts and retries whose backoff has not elapsed cannot fill the
    // runnable queue. Dispatch rereads and claims each event before network I/O.
    const runnable = this.ctx.storage.sql.exec<JsonRow>(`SELECT payload FROM events
      WHERE json_extract(payload,'$.delivery')='pending'
        AND COALESCE(json_extract(payload,'$.retryAt'),0)<=?
      ORDER BY updated_at ASC LIMIT 5`, now)
      .toArray().map(row => JSON.parse(row.payload) as StoredEvent);
    for (const event of runnable) await this.dispatch(event);
    // Rotate receipt checks independently of sends. Missing receipts must not
    // prevent newer tickets from being checked during their retention window.
    const checkedAt = Date.now();
    const pending = this.ctx.storage.sql.exec<JsonRow>(`SELECT payload FROM events
      WHERE json_extract(payload,'$.delivery')='accepted'
        AND json_extract(payload,'$.receiptId') IS NOT NULL AND updated_at<? AND updated_at>=?
        AND COALESCE(json_extract(payload,'$.receiptCheckedAt'),0)<=?
      ORDER BY COALESCE(json_extract(payload,'$.receiptCheckedAt'),0) ASC,updated_at ASC LIMIT 100`,
    checkedAt - 15_000, checkedAt - 24 * 60 * 60_000, checkedAt - 30_000)
      .toArray().map(row => JSON.parse(row.payload) as StoredEvent);
    if (!pending.length) return;
    for (const event of pending) {
      event.receiptCheckedAt = checkedAt;
      this.saveEvent(event);
    }
    try {
      const response = await fetch(RECEIPTS, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: pending.map(event => event.receiptId) }), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return;
      const payload = await response.json() as { data?: Record<string, { status?: string; details?: { error?: string } }> };
      for (const event of pending) {
        const receipt = payload.data?.[event.receiptId!];
        if (receipt?.status) {
          event.delivery = receipt.status === 'ok' ? 'sent' : 'failed';
          event.detail = receipt.details?.error;
        } else if (Date.now() - event.updatedAt > 24 * 60 * 60_000) {
          event.delivery = 'unconfirmed'; event.detail = 'No push receipt was available';
        } else continue;
        event.updatedAt = Date.now();
        this.ctx.storage.sql.exec(`UPDATE events SET updated_at=?,payload=? WHERE key=?
          AND json_extract(payload,'$.receiptId')=? AND json_extract(payload,'$.delivery')='accepted'`,
        event.updatedAt, JSON.stringify(event), event.key, event.receiptId ?? '');
      }
      this.pruneSupersededEvents();
    } catch { /* Keep accepted events pending for the next Mac mini check-in. */ }
  }
}
