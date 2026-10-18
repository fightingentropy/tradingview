export type StatsPeriod = 1 | 7 | 30 | 90;
export const STATS_PERIODS = [1, 7, 30, 90] as const;
export const statsPeriodLabel = (days: StatsPeriod) => days === 1 ? 'Today' : `Last ${days} days`;
export type StatsFill = {
  id: string; time: number; symbol: string; market: 'futures' | 'spot';
  side: 'buy' | 'sell'; direction: string; price: number; size: number;
  startPosition: number; closedPnl: number; fee: number; feeToken: string;
};
export type StatsFunding = { id: string; time: number; symbol: string; amount: number };
export type StatsInterest = { id: string; time: number; asset: string; borrow: number; supply: number };
export type StatsHistory = {
  user: string; updatedAt: number; fills: StatsFill[]; funding: StatsFunding[]; interest: StatsInterest[];
  fillCoverageStart: number; fillsLimited: boolean; fillsComplete: boolean;
  fundingCoverageStart: number; fundingComplete: boolean;
  interestCoverageStart: number; interestComplete: boolean;
};
export type StatsTotals = {
  funding: number; fundingReceived: number; fundingPaid: number;
  borrowInterest: number; lendInterest: number;
  futures: number; futuresGross: number; spot: number; fees: number;
  volume: number; fills: number; closes: number; wins: number;
  unknownSpotSales: number; unpricedFutures: number; unpricedSpot: number; unpricedFees: number;
};
export type StatsDay = StatsTotals & { date: string };
export type StatsMarket = StatsTotals & { symbol: string };
const dateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' });
export function statsDayKey(time: number): string {
  const parts = Object.fromEntries(dateFormatter.formatToParts(time).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export const shiftStatsDay = (key: string, days: number) => new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export function statsDayStart(key: string): number {
  const utc = Date.parse(`${key}T00:00:00Z`);
  // Midnight is unambiguous on both London DST transition days.
  return utc - Number(hourFormatter.format(utc)) * 3_600_000;
}
export const statsRangeStart = (days: StatsPeriod, now: number) => statsDayStart(shiftStatsDay(statsDayKey(now), 1 - days));
const emptyTotals = (): StatsTotals => ({
  funding: 0, fundingReceived: 0, fundingPaid: 0, futures: 0, futuresGross: 0,
  borrowInterest: 0, lendInterest: 0,
  spot: 0, fees: 0, volume: 0, fills: 0, closes: 0, wins: 0,
  unknownSpotSales: 0, unpricedFutures: 0, unpricedSpot: 0, unpricedFees: 0,
});
const totalKeys = Object.keys(emptyTotals()) as (keyof StatsTotals)[];
const add = (to: StatsTotals, value: StatsTotals) => { for (const key of totalKeys) to[key] += value[key]; };
type Lot = { quantity: number; cost?: number };
function consume(lots: Lot[], quantity: number): number | undefined {
  let remaining = quantity, cost = 0, known = true;
  while (remaining > 1e-10 && lots.length) {
    const lot = lots[0], used = Math.min(lot.quantity, remaining);
    if (lot.cost === undefined) known = false;
    else cost += lot.cost * used / lot.quantity;
    const fraction = (lot.quantity - used) / lot.quantity;
    lot.quantity -= used;
    if (lot.cost !== undefined) lot.cost *= fraction;
    remaining -= used;
    if (lot.quantity <= 1e-10) lots.shift();
  }
  return known && remaining <= 1e-10 ? cost : undefined;
}

/** Realized USDC results. Transfers and current marks never become profits. */
export function calculateAccountStats(history: StatsHistory, period: StatsPeriod, now = Date.now()) {
  const today = statsDayKey(now), start = statsRangeStart(period, now);
  const days: StatsDay[] = Array.from({ length: period }, (_, index) => ({ ...emptyTotals(), date: shiftStatsDay(today, index + 1 - period) }));
  const byDay = new Map(days.map(day => [day.date, day]));
  const markets = new Map<string, StatsMarket>(), totals = emptyTotals();
  const record = (time: number, symbol: string, value: StatsTotals) => {
    if (time < start || time > now) return;
    const day = byDay.get(statsDayKey(time));
    if (!day) return;
    let market = markets.get(symbol);
    if (!market) { market = { ...emptyTotals(), symbol }; markets.set(symbol, market); }
    add(day, value); add(market, value); add(totals, value);
  };
  const inventories = new Map<string, Lot[]>(), seen = new Set<string>();
  for (const fill of [...history.fills].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id, 'en', { numeric: true }))) {
    if (seen.has(fill.id) || fill.time > now) continue;
    seen.add(fill.id);
    if (![fill.time, fill.price, fill.size, fill.startPosition, fill.closedPnl, fill.fee].every(Number.isFinite) || fill.size <= 0 || fill.price <= 0) throw new Error('Invalid trade amount');
    const row = emptyTotals();
    row.fills = 1;
    if (fill.market === 'futures') {
      if (fill.feeToken !== 'USDC') { row.unpricedFutures = 1; record(fill.time, fill.symbol, row); continue; }
      row.volume = fill.price * fill.size; row.fees = fill.fee;
      row.futuresGross = fill.closedPnl; row.futures = fill.closedPnl - fill.fee;
      if (fill.closedPnl !== 0 || /Close|>/.test(fill.direction)) { row.closes = 1; row.wins = Number(fill.closedPnl > 0); }
    } else {
      const [base, quote] = fill.symbol.split('/');
      if (quote !== 'USDC') { row.unpricedSpot = 1; record(fill.time, fill.symbol, row); continue; }
      row.volume = fill.price * fill.size;
      const baseFee = fill.feeToken === base ? fill.fee : 0, quoteFee = fill.feeToken === 'USDC' ? fill.fee : 0;
      const feeKnown = fill.fee === 0 || fill.feeToken === base || fill.feeToken === 'USDC';
      if (feeKnown) row.fees = quoteFee + baseFee * fill.price;
      else row.unpricedFees = 1;
      let lots = inventories.get(fill.symbol);
      if (!lots) { lots = []; inventories.set(fill.symbol, lots); }
      const adjustment = Math.max(0, fill.startPosition) - lots.reduce((sum, lot) => sum + lot.quantity, 0);
      if (adjustment > 1e-8) lots.push({ quantity: adjustment });
      else if (adjustment < -1e-8) consume(lots, -adjustment);
      if (fill.side === 'buy') {
        const acquired = fill.size - baseFee;
        if (acquired > 1e-10) lots.push({ quantity: acquired, cost: feeKnown ? fill.price * fill.size + quoteFee : undefined });
      } else {
        const basis = consume(lots, Math.max(0, fill.size + baseFee));
        if (basis === undefined || !feeKnown) row.unknownSpotSales = 1;
        else row.spot = fill.price * fill.size - quoteFee - basis;
      }
    }
    record(fill.time, fill.symbol, row);
  }
  seen.clear();
  for (const payment of history.funding) {
    if (seen.has(payment.id) || payment.time > now) continue;
    if (!Number.isFinite(payment.amount) || !Number.isFinite(payment.time)) throw new Error('Invalid funding amount');
    seen.add(payment.id);
    const row = emptyTotals();
    row.funding = payment.amount; row.fundingReceived = Math.max(0, payment.amount); row.fundingPaid = Math.max(0, -payment.amount);
    record(payment.time, payment.symbol, row);
  }
  seen.clear();
  const interestByAsset = new Map<string, { asset: string; borrow: number; supply: number }>();
  for (const payment of history.interest) {
    if (seen.has(payment.id) || payment.time < start || payment.time > now) continue;
    if (![payment.time, payment.borrow, payment.supply].every(Number.isFinite) || payment.borrow < 0 || payment.supply < 0 || !payment.asset.trim()) throw new Error('Invalid interest amount');
    seen.add(payment.id);
    let asset = interestByAsset.get(payment.asset);
    if (!asset) { asset = { asset: payment.asset, borrow: 0, supply: 0 }; interestByAsset.set(payment.asset, asset); }
    asset.borrow += payment.borrow; asset.supply += payment.supply;
    // Other assets stay in their native units; never assume a stablecoin is $1.
    if (payment.asset === 'USDC') {
      const row = emptyTotals();
      row.borrowInterest = payment.borrow; row.lendInterest = payment.supply;
      record(payment.time, 'USDC interest', row);
    }
  }
  const tradingComplete = history.fillsComplete && history.fillCoverageStart <= start;
  const fundingComplete = history.fundingComplete && history.fundingCoverageStart <= start;
  const interestComplete = history.interestComplete && history.interestCoverageStart <= start;
  const futuresComplete = tradingComplete && totals.unpricedFutures === 0;
  const spotComplete = tradingComplete && totals.unknownSpotSales === 0 && totals.unpricedSpot === 0 && totals.unpricedFees === 0;
  const beforeInterestComplete = futuresComplete && spotComplete && fundingComplete;
  const beforeInterest = beforeInterestComplete ? totals.futures + totals.spot + totals.funding : undefined;
  const netComplete = beforeInterestComplete && interestComplete;
  return {
    days, markets: [...markets.values()].sort((a, b) => Math.abs(b.futures + b.spot + b.funding + b.lendInterest - b.borrowInterest) - Math.abs(a.futures + a.spot + a.funding + a.lendInterest - a.borrowInterest)),
    interestByAsset: [...interestByAsset.values()].sort((a, b) => a.asset === b.asset ? 0 : a.asset === 'USDC' ? -1 : b.asset === 'USDC' ? 1 : a.asset.localeCompare(b.asset)),
    totals, start, end: now, tradingComplete, fundingComplete, interestComplete, futuresComplete, spotComplete, beforeInterestComplete, netComplete, beforeInterest,
    net: netComplete ? beforeInterest! + totals.lendInterest - totals.borrowInterest : undefined,
  };
}
export const formatStatsUsd = (value: number | undefined, signed = true) => value === undefined || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: signed ? 'exceptZero' : 'auto',
}).format(Math.abs(value) < 0.005 ? 0 : value);
export const formatStatsDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const formatStatsAssetAmount = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
export function statsRowValues(row: StatsTotals, stats: ReturnType<typeof calculateAccountStats>) {
  const funding = stats.fundingComplete ? row.funding : undefined;
  const futures = stats.tradingComplete && !row.unpricedFutures ? row.futures : undefined;
  const spot = stats.tradingComplete && !row.unknownSpotSales && !row.unpricedSpot && !row.unpricedFees ? row.spot : undefined;
  const fees = stats.tradingComplete && !row.unpricedFutures && !row.unpricedSpot && !row.unpricedFees ? row.fees : undefined;
  const beforeInterest = funding !== undefined && futures !== undefined && spot !== undefined ? funding + futures + spot : undefined;
  const borrowInterest = stats.interestComplete ? row.borrowInterest : undefined;
  const lendInterest = stats.interestComplete ? row.lendInterest : undefined;
  return { funding, futures, spot, fees, beforeInterest, borrowInterest, lendInterest,
    net: beforeInterest !== undefined && borrowInterest !== undefined && lendInterest !== undefined ? beforeInterest + lendInterest - borrowInterest : undefined };
}
export function statsCsv(stats: ReturnType<typeof calculateAccountStats>): string {
  const rows = [['Date (Europe/London)', 'Funding received (USDC)', 'Funding paid (USDC)', 'Net funding (USDC)', 'Futures net (USDC)', 'Spot FIFO realized (USDC)', 'Realized before interest (USDC)', 'Borrowing interest paid (USDC)', 'Lending interest earned (USDC)', 'Realized after interest (USDC)']];
  for (const day of stats.days) {
    const values = statsRowValues(day, stats);
    rows.push([day.date, ...[stats.fundingComplete ? day.fundingReceived : undefined, stats.fundingComplete ? day.fundingPaid : undefined,
      values.funding, values.futures, values.spot, values.beforeInterest, values.borrowInterest, values.lendInterest, values.net].map(value => value === undefined ? '' : value.toFixed(8))]);
  }
  return rows.map(row => row.join(',')).join('\r\n');
}
