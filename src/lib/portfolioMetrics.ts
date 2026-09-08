import type { HlPortfolioPoint, HlPortfolioWindow } from './hyperliquid/info';

/** Numeric API fields are strings; an absent field is never an observed zero. */
export function portfolioNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function portfolioPoints(raw: unknown): HlPortfolioPoint[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('Portfolio history is malformed');
  const points = new Map<number, HlPortfolioPoint>();
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 2) throw new Error('Portfolio history is malformed');
    const t = portfolioNumber(row[0]);
    const v = portfolioNumber(row[1]);
    if (t == null || !Number.isSafeInteger(t) || t <= 0 || v == null) {
      throw new Error('Portfolio history contains an invalid sample');
    }
    if (points.has(t) && points.get(t)?.v !== v) throw new Error('Portfolio history contains conflicting samples');
    points.set(t, { t, v });
  }
  return [...points.values()].sort((a, b) => a.t - b.t);
}

/** PNL is the exchange's cash-flow-adjusted series, not account-value movement. */
export function portfolioWindowMetrics(window: HlPortfolioWindow | undefined) {
  const equity = window?.accountValue ?? [];
  const pnl = window?.pnl ?? [];
  const pnlChange = pnl.length >= 2 ? pnl[pnl.length - 1].v - pnl[0].v : null;
  const equityChange = equity.length >= 2 ? equity[equity.length - 1].v - equity[0].v : null;
  let maxPnlDrawdown: number | null = null;
  if (pnl.length >= 2) {
    let peak = pnl[0].v;
    maxPnlDrawdown = 0;
    for (const point of pnl) {
      peak = Math.max(peak, point.v);
      maxPnlDrawdown = Math.max(maxPnlDrawdown, peak - point.v);
    }
  }
  return {
    pnl: pnlChange,
    equityChange,
    volume: window?.volume ?? null,
    // Dollar decline in PNL, intentionally not a return percentage. Withdrawals
    // can reduce equity without a loss, and deposits can increase it without profit.
    maxPnlDrawdown,
    lastEquity: equity.at(-1)?.v ?? null,
    sampledAt: equity.at(-1)?.t ?? pnl.at(-1)?.t ?? null,
  };
}

export function rebasedPnl(points: readonly HlPortfolioPoint[]): HlPortfolioPoint[] {
  const base = points[0]?.v;
  return base == null ? [] : points.map(({ t, v }) => ({ t, v: v - base }));
}

/** Last 14 completed UTC days, matching the documented daily fee assessment. */
export function feeVolume14d(raw: unknown, now = Date.now()): number | null {
  if (!Array.isArray(raw)) return null;
  const date = new Date(now);
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const start = end - 14 * 86_400_000;
  let total = 0;
  const days = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') return null;
    const entry = row as Record<string, unknown>;
    if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return null;
    const t = Date.parse(`${entry.date}T00:00:00Z`);
    if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== entry.date) return null;
    if (t < start || t >= end) continue;
    const taker = portfolioNumber(entry.userCross);
    const maker = portfolioNumber(entry.userAdd);
    if (taker == null || maker == null || taker < 0 || maker < 0 || days.has(entry.date)) return null;
    days.add(entry.date);
    total += taker + maker;
  }
  return Number.isFinite(total) ? total : null;
}

/** A token-denominated spot fee cannot be subtracted from dollar PNL. */
export function fillNetPnl(fill: { closedPnl: number; fee: number; feeToken?: string; pnlKnown?: boolean }): number | null {
  if (fill.pnlKnown === false || !Number.isFinite(fill.closedPnl) || !Number.isFinite(fill.fee)) return null;
  return fill.fee === 0 || fill.feeToken?.trim().toUpperCase() === 'USDC'
    ? fill.closedPnl - fill.fee
    : null;
}

export function shortAccountMode(mode: string): string {
  return mode === 'unified' ? 'Unified' : mode === 'portfolioMargin' ? 'Portfolio margin'
    : mode === 'standard' ? 'Standard' : 'DEX abstraction';
}

/** Validate the token-state collection before treating an absent USDC entry as zero. */
export function earnUsdcState(raw: unknown): { suppliedUsdc: number | null; borrowedUsdc: number | null } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Earn balance is unavailable');
  const rows = (raw as Record<string, unknown>).tokenToState;
  if (!Array.isArray(rows)) throw new Error('Earn balance is unavailable');
  const seen = new Set<number>();
  let usdc: Record<string, unknown> | undefined;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 2 || !Number.isSafeInteger(row[0]) || row[0] < 0 ||
      seen.has(row[0]) || !row[1] || typeof row[1] !== 'object' || Array.isArray(row[1])) {
      throw new Error('Earn balance contains an invalid token state');
    }
    seen.add(row[0]);
    if (row[0] === 0) usdc = row[1];
  }
  if (!usdc) return { suppliedUsdc: 0, borrowedUsdc: 0 };
  const amount = (leg: unknown): number | null => {
    if (!leg || typeof leg !== 'object' || Array.isArray(leg)) return null;
    const value = portfolioNumber((leg as Record<string, unknown>).value);
    return value != null && value >= 0 ? value : null;
  };
  return { suppliedUsdc: amount(usdc.supply), borrowedUsdc: amount(usdc.borrow) };
}
