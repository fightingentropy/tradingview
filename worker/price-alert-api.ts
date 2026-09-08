import { EXPO_PUSH_TOKEN_PATTERN, priceMonitorSignaturePayload, type PriceMonitorHealth } from '../src/domain/priceAlerts';

const encoder = new TextEncoder();
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}

async function readBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > 128_000) { await reader.cancel(); return null; }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export async function verifyPriceMonitorRequest(request: Request, body: string, secret: string, now = Date.now()): Promise<boolean> {
  const stamp = request.headers.get('X-Monitor-Timestamp') ?? '';
  const hex = request.headers.get('X-Monitor-Signature') ?? '';
  if (!/^\d{10,}$/.test(stamp) || !/^[a-f0-9]{64}$/i.test(hex) || Math.abs(now / 1000 - Number(stamp)) > 120) return false;
  const signature = Uint8Array.from(hex.match(/../g)!, pair => parseInt(pair, 16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, signature,
    encoder.encode(priceMonitorSignaturePayload(request.method, new URL(request.url).pathname, stamp, body)));
}

function finiteStamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < Date.now() + 60_000 ? value : null;
}

export async function handlePriceAlertRequest(request: Request, env: Env, appAuthorized: boolean): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (!['POST', 'DELETE'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
  const body = await readBody(request);
  if (body === null) return json({ error: 'Request is too large' }, 413);
  const monitor = pathname.startsWith('/price-alerts/monitor/');
  if (monitor ? !await verifyPriceMonitorRequest(request, body, env.BRIDGE_SECRET) : !appAuthorized) {
    return json({ error: 'Unauthorized' }, 401);
  }
  let payload: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ error: 'Invalid payload' }, 400);
    payload = value as Record<string, unknown>;
  } catch { return json({ error: 'Invalid JSON' }, 400); }
  // One coordination atom for this personal app's Mac mini installation.
  const relay = env.PRICE_ALERTS.getByName('mac-mini-v1');
  if (pathname === '/price-alerts/sync') {
    const token = payload.expoPushToken;
    if (typeof token !== 'string' || !EXPO_PUSH_TOKEN_PATTERN.test(token)) return json({ error: 'Invalid push token' }, 400);
    const registrationToken = payload.registrationToken === undefined ? token : payload.registrationToken;
    if (typeof registrationToken !== 'string' || !EXPO_PUSH_TOKEN_PATTERN.test(registrationToken)) return json({ error: 'Invalid registration token' }, 400);
    const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(registrationToken));
    const device = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
    if (request.method === 'DELETE') { await relay.deleteDevice(device); return json({ ok: true }); }
    if (typeof payload.enabled !== 'boolean' || !Array.isArray(payload.rules)) return json({ error: 'Invalid subscription' }, 400);
    try { return json(await relay.syncDevice(device, token, payload.enabled, payload.rules)); }
    catch { return json({ error: 'Invalid subscription or device limit reached' }, 400); }
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (pathname === '/price-alerts/monitor/sync') {
    const raw = payload.health as Record<string, unknown> | undefined;
    if (!raw || typeof raw.connected !== 'boolean' || typeof raw.version !== 'string' || raw.version.length > 32 ||
        typeof raw.pendingEvents !== 'number' || !Number.isSafeInteger(raw.pendingEvents) || raw.pendingEvents < 0 || raw.pendingEvents > 100_000) {
      return json({ error: 'Invalid monitor health' }, 400);
    }
    const health: Omit<PriceMonitorHealth, 'seenAt'> = {
      connected: raw.connected, version: raw.version, pendingEvents: raw.pendingEvents,
      lastHyperliquidAt: finiteStamp(raw.lastHyperliquidAt), lastCboeAt: finiteStamp(raw.lastCboeAt),
      lastXyzAt: finiteStamp(raw.lastXyzAt),
    };
    const revisions: Record<string, number> = {};
    if (payload.appliedRevisions && typeof payload.appliedRevisions === 'object') {
      for (const [device, revision] of Object.entries(payload.appliedRevisions).slice(0, 25)) {
        if (/^[a-f0-9]{64}$/.test(device) && typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0) revisions[device] = revision;
      }
    }
    return json(await relay.syncMonitor(health, revisions));
  }
  if (pathname === '/price-alerts/monitor/event') {
    if (typeof payload.device !== 'string' || !/^[a-f0-9]{64}$/.test(payload.device) ||
        typeof payload.alertId !== 'string' || payload.alertId.length > 120 ||
        typeof payload.createdAt !== 'number' || !Number.isSafeInteger(payload.createdAt) ||
        typeof payload.price !== 'number' || !Number.isFinite(payload.price) ||
        typeof payload.triggeredAt !== 'number' || !Number.isFinite(payload.triggeredAt)) return json({ error: 'Invalid trigger' }, 400);
    return json(await relay.trigger(payload.device, payload.alertId, payload.createdAt, payload.price, payload.triggeredAt));
  }
  return json({ error: 'Not found' }, 404);
}
