import type { InfoClient } from '@nktkas/hyperliquid';
import type { SymbolConverter } from '@nktkas/hyperliquid/utils';
import { accountDisplaySymbol } from './hyperliquidAccountData';
import { statsRangeStart, type StatsFill, type StatsFunding, type StatsInterest, type StatsHistory } from './accountStats';
export async function paginateStatsHistory<T extends { time: number }>(options: {
  fetchPage: (start: number) => Promise<T[]>; key: (item: T) => string;
  start: number; end: number; pageLimit: number; maxRows: number; maxPages?: number; signal: AbortSignal;
}): Promise<{ items: T[]; complete: boolean }> {
  const seen = new Map<string, T>();
  let cursor = options.start;
  for (let pageIndex = 0; pageIndex < (options.maxPages ?? 100); pageIndex++) {
    options.signal.throwIfAborted();
    const page = await options.fetchPage(cursor);
    options.signal.throwIfAborted();
    if (!page.length) return { items: [...seen.values()], complete: true };
    let last = cursor;
    for (const item of page) {
      if (!Number.isFinite(item.time) || item.time < cursor || item.time > options.end) throw new Error('Invalid account history timestamp');
      seen.set(options.key(item), item); last = Math.max(last, item.time);
    }
    if (seen.size > options.maxRows) return { items: [...seen.values()].sort((a, b) => b.time - a.time).slice(0, options.maxRows), complete: false };
    if (last === cursor) return { items: [...seen.values()], complete: page.length < options.pageLimit };
    cursor = last; // Inclusive boundary; dedupe rather than skip same-timestamp events.
  }
  return { items: [...seen.values()], complete: false };
}
const numeric = (value: string | number) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Invalid account history amount');
  return number;
};
const merge = <T extends { id: string; time: number }>(old: T[], fresh: T[]) => [...new Map([...old, ...fresh].map(item => [item.id, item])).values()].sort((a, b) => a.time - b.time);
export async function fetchAccountStatsHistory(client: Pick<InfoClient, 'userFillsByTime' | 'userFunding' | 'userBorrowLendInterest'>, options: {
  user: `0x${string}`; converter: SymbolConverter | null; signal: AbortSignal; previous?: StatsHistory; now?: number;
}): Promise<StatsHistory> {
  const now = options.now ?? Date.now(), coverageStart = statsRangeStart(90, now);
  const previous = options.previous?.user === options.user ? options.previous : undefined;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]);
  const fillStart = previous?.fillsComplete ? Math.max(0, previous.updatedAt - 120_000) : 0;
  const fundingStart = previous?.fundingComplete ? Math.max(coverageStart, previous.updatedAt - 120_000) : coverageStart;
  const interestStart = previous?.interestComplete ? Math.max(coverageStart, previous.updatedAt - 120_000) : coverageStart;
  const [fillsRead, fundingRead, interestRead] = await Promise.allSettled([
    paginateStatsHistory({
      fetchPage: startTime => client.userFillsByTime({ user: options.user, startTime, endTime: now, aggregateByTime: false }, signal),
      key: fill => `${fill.coin}:${fill.tid}`, start: fillStart, end: now, pageLimit: 2000, maxRows: 10000, maxPages: 16, signal,
    }),
    paginateStatsHistory({
      fetchPage: startTime => client.userFunding({ user: options.user, startTime, endTime: now }, signal),
      key: update => `${update.hash}:${update.time}:${update.delta.coin}`,
      start: fundingStart, end: now, pageLimit: 500, maxRows: 100000, signal,
    }),
    paginateStatsHistory({
      fetchPage: startTime => client.userBorrowLendInterest({ user: options.user, startTime, endTime: now }, signal),
      key: payment => `${payment.time}:${payment.token}`,
      start: interestStart, end: now, pageLimit: 500, maxRows: 100000, signal,
    }),
  ]);
  signal.throwIfAborted();
  if (fillsRead.status === 'rejected') throw fillsRead.reason;
  if (fundingRead.status === 'rejected') throw fundingRead.reason;
  const fillsResult = fillsRead.value, fundingResult = fundingRead.value;
  // Funding and trading remain useful when the independent interest read fails.
  const interestResult = interestRead.status === 'fulfilled' ? interestRead.value : { items: [], complete: false };
  const newFills: StatsFill[] = fillsResult.items.map(fill => {
    const symbol = accountDisplaySymbol(fill.coin, options.converter);
    return {
      id: `${fill.coin}:${fill.tid}`, time: fill.time, symbol,
      market: fill.coin.startsWith('@') || symbol.includes('/') ? 'spot' : 'futures',
      side: fill.side === 'B' ? 'buy' : 'sell', direction: fill.dir,
      price: numeric(fill.px), size: Math.abs(numeric(fill.sz)), startPosition: numeric(fill.startPosition),
      closedPnl: numeric(fill.closedPnl), fee: numeric(fill.fee), feeToken: fill.feeToken,
    };
  });
  const mergedFills = merge(previous?.fills ?? [], newFills), fills = mergedFills.slice(-10000);
  const fillsLimited = !!previous?.fillsLimited || newFills.length >= 10000 || !fillsResult.complete || mergedFills.length > 10000;
  const newFunding: StatsFunding[] = fundingResult.items.map(update => ({
    id: `${update.hash}:${update.time}:${update.delta.coin}`, time: update.time,
    symbol: accountDisplaySymbol(update.delta.coin, options.converter), amount: numeric(update.delta.usdc),
  }));
  const newInterest: StatsInterest[] = interestResult.items.map(payment => {
    const borrow = numeric(payment.borrow), supply = numeric(payment.supply);
    if (borrow < 0 || supply < 0 || !payment.token.trim()) throw new Error('Invalid account interest amount');
    return { id: `${payment.time}:${payment.token}`, time: payment.time, asset: payment.token, borrow, supply };
  });
  return {
    user: options.user, updatedAt: now, fills, fillsLimited, fillsComplete: fillsResult.complete,
    fillCoverageStart: fillsLimited ? Math.max(previous?.fillCoverageStart ?? 0, fills[0]?.time ?? now) : 0,
    funding: merge(previous?.funding ?? [], newFunding).filter(payment => payment.time >= coverageStart),
    fundingCoverageStart: coverageStart, fundingComplete: fundingResult.complete,
    interest: merge(previous?.interest ?? [], newInterest).filter(payment => payment.time >= coverageStart),
    interestCoverageStart: coverageStart, interestComplete: interestResult.complete,
  };
}
