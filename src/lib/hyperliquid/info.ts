/**
 * Hyperliquid account reads (public `info` endpoint — no auth, just an address).
 * Powers the Account tab: margin summary + open perp positions with live marks.
 */
import { toNum } from '@/lib/format';
import {
  deriveModeAwareAccountMetrics,
  type HlAccountMode,
  type HlCollateralBalance,
  type HlDexMarginState,
} from '@/lib/accountRisk';

export type HlNetwork = 'mainnet' | 'testnet';

export const HL_API: Record<HlNetwork, string> = {
  mainnet: 'https://api.hyperliquid.xyz',
  testnet: 'https://api.hyperliquid-testnet.xyz',
};

/** trade.xyz markets ride this HIP-3 builder-deployed perp dex (coins are `xyz:NAME`). */
export const XYZ_DEX = 'xyz';
/**
 * Perp order asset-ids (the `a` field in an order action): the default dex uses the
 * bare universe index, while a builder/HIP-3 dex at `perpDexs` index `d` (d ≥ 1) uses
 *   110000 + (d − 1) * 10000 + universeIndex
 * This matches the Hyperliquid SDK, which skips the null `perpDexs[0]` then offsets the
 * i-th builder dex by `110000 + i * 10000`. So xyz (`perpDexs[1]`) → 110000 and Felix
 * (`perpDexs[2]`) → 120000. (The old base of 100000 sent 100013 for AMZN, which decodes
 * to perp_dex_index 0 — the null/default dex — and the API rejected it as "Invalid
 * spot".) We resolve the index LIVE rather than hardcode it, because a wrong offset
 * routes an order to a DIFFERENT dex's asset — dangerous with real funds. Reads use the
 * `dex` param and don't need this.
 */
const PERP_DEX_OFFSET_BASE = 110000;
const PERP_DEX_OFFSET_STEP = 10000;

/**
 * fetch with an AbortController-backed timeout. A hung request (no response,
 * not just a slow one) would otherwise leave a trade/account call pending
 * forever; this rejects with a clear error after `ms`. Shared with exchange.ts.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`Hyperliquid request timed out after ${ms}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export interface HlPosition {
  coin: string;
  /** Which perp dex holds it: the default crypto dex or the trade.xyz (HIP-3) dex. */
  dex: 'default' | 'xyz';
  side: 'long' | 'short';
  /** Absolute size in coins. */
  size: number;
  entryPx: number;
  /** Mark implied by current notional / size (works across dexes). */
  markPx: number;
  /** Current notional value, USD. */
  positionValue: number;
  unrealizedPnl: number;
  /** Return on equity as a fraction (0.07 = +7%). */
  roe: number;
  leverage: number;
  leverageType: 'cross' | 'isolated';
  liquidationPx: number | null;
  marginUsed: number;
  maxLeverage: number;
  /** Net funding received since the position opened (positive = collected, negative = paid). */
  funding: number;
}

/** A token balance in the spot wallet (separate from perp collateral). */
export interface HlSpotBalance {
  coin: string;
  /** Total balance in token units. */
  total: number;
  /** Amount reserved (e.g. resting spot orders). */
  hold: number;
  /** total − hold. */
  available: number;
  /** Current value in USD (USDC = 1; other tokens priced off spot mids). */
  usdValue: number;
}

export interface HlAccount {
  /** Margin/collateral abstraction reported by Hyperliquid. */
  abstractionMode: HlAccountMode;
  /** Total perp account equity, USD. */
  accountValue: number;
  totalMarginUsed: number;
  /** Total open notional across positions, USD. */
  totalNotional: number;
  withdrawable: number;
  maintenanceMargin: number;
  /** Mode-correct capital currently available to deploy, USD. */
  freeCollateral: number;
  /** Mode-correct equity/collateral base for percentage risk sizing, USD. */
  riskSizingBase: number;
  /** Exact maintenance usage fraction (1 = liquidation threshold), or null if unavailable. */
  maintenanceUsage: number | null;
  /** Summed unrealized PnL across positions. */
  unrealizedPnl: number;
  positions: HlPosition[];
  /** Spot wallet token balances (non-zero), richest first. */
  spotBalances: HlSpotBalance[];
  /** Total USD value of the spot wallet (all tokens, incl. USDC reserved as margin). */
  spotValue: number;
  /** Freely-available USDC in the spot wallet (total − hold). */
  availableUsdc: number;
  /** Total USD equity deposited in vaults. */
  vaultValue: number;
  /**
   * Hyperliquid's "Total Equity" — the figure at the top of the web Portfolio page.
   * Standard adds the separate spot and per-DEX perp balances. Unified/portfolio modes
   * use spot as the authoritative balance surface and do not add per-DEX accountValue.
   * Staking is tracked separately and not included.
   */
  totalEquity: number;
}

export interface HlAssetMeta {
  name: string;
  /** Index in the perp `universe` — the `a` field in an order action. */
  assetIndex: number;
  /** Decimal places allowed for order size. */
  szDecimals: number;
  maxLeverage: number;
  /** `strictIsolated` markets permit adding margin but never removing it. */
  marginMode?: 'strictIsolated' | 'noCross';
}

async function infoRequest<T>(network: HlNetwork, body: object): Promise<T> {
  const res = await fetchWithTimeout(`${HL_API[network]}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid info ${res.status}`);
  return (await res.json()) as T;
}

interface RawClearinghouse {
  marginSummary: { accountValue: string; totalNtlPos: string; totalMarginUsed: string };
  crossMarginSummary: { accountValue: string; totalNtlPos: string; totalMarginUsed: string };
  crossMaintenanceMarginUsed: string;
  withdrawable: string;
  assetPositions: {
    position: {
      coin: string;
      szi: string;
      leverage: { type: 'cross' | 'isolated'; value: number };
      entryPx: string;
      positionValue: string;
      unrealizedPnl: string;
      returnOnEquity: string;
      liquidationPx: string | null;
      marginUsed: string;
      maxLeverage: number;
      // Cumulative funding the trader has *paid* (positive = paid, negative = received).
      cumFunding?: { allTime: string; sinceOpen: string; sinceChange: string };
    };
  }[];
}

const n = (v: string | null | undefined) => toNum(v ?? null) ?? 0;

type RawUserAbstraction =
  | 'unifiedAccount'
  | 'portfolioMargin'
  | 'disabled'
  | 'default'
  | 'dexAbstraction';

function normalizeAccountMode(abstraction: RawUserAbstraction): HlAccountMode {
  if (abstraction === 'unifiedAccount') return 'unified';
  if (abstraction === 'portfolioMargin') return 'portfolioMargin';
  if (abstraction === 'dexAbstraction') return 'dexAbstraction';
  // The API uses both `disabled` and `default` for the separate-balance Standard mode.
  return 'standard';
}

/**
 * Collateral-token metadata is effectively static. Cache the in-flight/resolved request
 * by network so the 5-second account query does not download two full perp metas every
 * poll. A rejected request is evicted so a later refresh can recover.
 */
const supportedCollateralTokenCache = new Map<HlNetwork, Promise<readonly [number, number]>>();

function fetchSupportedCollateralTokens(
  network: HlNetwork,
): Promise<readonly [number, number]> {
  const cached = supportedCollateralTokenCache.get(network);
  if (cached) return cached;

  type RawCollateralMeta = { collateralToken?: number };
  const pending = Promise.all([
    infoRequest<RawCollateralMeta>(network, { type: 'meta' }),
    infoRequest<RawCollateralMeta>(network, { type: 'meta', dex: XYZ_DEX }),
  ])
    .then(([core, xyz]) => [core.collateralToken ?? 0, xyz.collateralToken ?? 0] as const)
    .catch((error) => {
      supportedCollateralTokenCache.delete(network);
      throw error;
    });
  supportedCollateralTokenCache.set(network, pending);
  return pending;
}

/**
 * Resolve a builder dex's order-id offset from its live `perpDexs` index:
 * index 0 = default (offset 0); index d ≥ 1 = 110000 + (d − 1) * 10000. Falls back to
 * the first-builder offset (110000) if the list can't be read. Resolving it live (vs a
 * hardcoded constant) guards against the dex list being reordered, which would otherwise
 * silently route orders to the wrong dex's asset.
 */
async function fetchPerpDexOffset(network: HlNetwork, dexName: string): Promise<number> {
  try {
    const dexs = await infoRequest<({ name: string } | null)[]>(network, { type: 'perpDexs' });
    const idx = dexs.findIndex((d) => d?.name === dexName);
    if (idx >= 1) return PERP_DEX_OFFSET_BASE + (idx - 1) * PERP_DEX_OFFSET_STEP;
  } catch {
    /* fall through to the known-good default */
  }
  return PERP_DEX_OFFSET_BASE;
}

/**
 * Perp universe metadata keyed by coin. The order of `universe` defines each
 * asset's index (the `a` field when placing an order), so we capture it here.
 * Rarely changes — callers cache it aggressively.
 */
export async function fetchHlMeta(network: HlNetwork = 'mainnet'): Promise<Record<string, HlAssetMeta>> {
  type RawUniverse = {
    universe: {
      name: string;
      szDecimals: number;
      maxLeverage: number;
      marginMode?: 'strictIsolated' | 'noCross';
    }[];
  };
  const [core, xyz, xyzOffset] = await Promise.all([
    infoRequest<RawUniverse>(network, { type: 'meta' }),
    infoRequest<RawUniverse>(network, { type: 'meta', dex: XYZ_DEX }),
    fetchPerpDexOffset(network, XYZ_DEX),
  ]);

  const out: Record<string, HlAssetMeta> = {};
  core.universe.forEach((u, i) => {
    out[u.name] = {
      name: u.name,
      assetIndex: i,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
      marginMode: u.marginMode,
    };
  });
  // xyz universe names are already `xyz:NAME`; order id = the dex's offset + universe index.
  xyz.universe.forEach((u, i) => {
    out[u.name] = {
      name: u.name,
      assetIndex: xyzOffset + i,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
      marginMode: u.marginMode,
    };
  });
  return out;
}

export interface HlActiveAsset {
  /** Current leverage set for this asset (1..maxLeverage). */
  leverage: number;
  /** Margin mode: true = cross, false = isolated. */
  isCross: boolean;
  /** USDC collateral available to open a buy / sell (already nets open orders + margin). */
  availBuy: number;
  availSell: number;
  /** Max order size in coins for a buy / sell at the current leverage. */
  maxSzBuy: number;
  maxSzSell: number;
  markPx: number;
}

/**
 * Per-asset trading context for an address: current leverage + margin mode, USDC buying
 * power, and max order size — exactly what the order ticket needs to show Margin Required,
 * Available, and the size %. Works for `xyz:NAME` coins directly (no `dex` param needed).
 */
export async function fetchActiveAssetData(
  address: string,
  coin: string,
  network: HlNetwork = 'mainnet',
): Promise<HlActiveAsset> {
  const d = await infoRequest<{
    leverage: { type: 'cross' | 'isolated'; value: number };
    maxTradeSzs: [string, string];
    availableToTrade: [string, string];
    markPx: string;
  }>(network, { type: 'activeAssetData', user: address, coin });
  return {
    leverage: d.leverage.value,
    isCross: d.leverage.type === 'cross',
    availBuy: n(d.availableToTrade?.[0]),
    availSell: n(d.availableToTrade?.[1]),
    maxSzBuy: n(d.maxTradeSzs?.[0]),
    maxSzSell: n(d.maxTradeSzs?.[1]),
    markPx: n(d.markPx),
  };
}

export interface HlUserRole {
  role: 'missing' | 'user' | 'agent' | 'vault' | 'subAccount';
  /** For an agent, `user` is the master account it trades for. */
  data?: { user?: string; master?: string };
}

/**
 * The role of an address. An API-wallet ("agent") returns its master account in
 * `data.user` — positions/balances live under that master, not the agent address.
 */
export async function fetchUserRole(address: string, network: HlNetwork = 'mainnet'): Promise<HlUserRole> {
  return infoRequest<HlUserRole>(network, { type: 'userRole', user: address });
}

interface RawSpotState {
  balances: { coin: string; token: number; total: string; hold: string }[];
}
interface SpotMeta {
  universe: { name: string; tokens: [number, number]; index: number }[];
}
interface SpotCtx {
  coin: string;
  midPx: string | null;
}

/** token index → USD price (USDC = 1; others from the token/USDC spot mid). */
function spotPriceByToken([meta, ctxs]: [SpotMeta, SpotCtx[]]): Record<number, number> {
  const midByCoin: Record<string, number> = {};
  for (const c of ctxs) midByCoin[c.coin] = n(c.midPx);
  const price: Record<number, number> = { 0: 1 }; // USDC is token 0
  for (const u of meta.universe) {
    const [base, quote] = u.tokens;
    if (quote !== 0) continue; // only USDC-quoted pairs give a USD price
    const px = midByCoin[u.name] ?? midByCoin[`@${u.index}`];
    if (px) price[base] = px;
  }
  return price;
}

/**
 * Spot wallet balances valued in USD. Tolerant of failure (returns empty).
 * Also reports the total spot USDC and the freely-available USDC (total − hold). The
 * account total uses the total spot USDC to size the perp/spot collateral overlap under
 * unified margin (perp equity is drawn from — and already counted in — the spot USDC).
 */
async function fetchSpotBalances(
  address: string,
  network: HlNetwork,
): Promise<{
  balances: HlSpotBalance[];
  collateralBalances: HlCollateralBalance[];
  value: number;
  usdcTotal: number;
  usdcAvailable: number;
  loaded: boolean;
}> {
  try {
    const [state, metaCtxs] = await Promise.all([
      infoRequest<RawSpotState>(network, { type: 'spotClearinghouseState', user: address }),
      infoRequest<[SpotMeta, SpotCtx[]]>(network, { type: 'spotMetaAndAssetCtxs' }),
    ]);
    const price = spotPriceByToken(metaCtxs);
    const balances = state.balances
      .map((b) => {
        const total = n(b.total);
        const hold = n(b.hold);
        const px = b.coin === 'USDC' ? 1 : (price[b.token] ?? 0);
        return { coin: b.coin, total, hold, available: total - hold, usdValue: total * px };
      })
      .filter((b) => b.total > 1e-8)
      .sort((a, b) => b.usdValue - a.usdValue);
    const usdc = state.balances.find((b) => b.coin === 'USDC');
    const usdcTotal = n(usdc?.total);
    const usdcAvailable = usdcTotal - n(usdc?.hold);
    return {
      balances,
      collateralBalances: state.balances.map((b) => ({
        token: b.token,
        total: n(b.total),
        hold: n(b.hold),
        usdPrice: b.coin === 'USDC' ? 1 : (price[b.token] ?? 0),
      })),
      value: balances.reduce((s, b) => s + b.usdValue, 0),
      usdcTotal,
      usdcAvailable,
      loaded: true,
    };
  } catch {
    return {
      balances: [],
      collateralBalances: [],
      value: 0,
      usdcTotal: 0,
      usdcAvailable: 0,
      loaded: false,
    };
  }
}

interface RawVaultEquity {
  vaultAddress: string;
  equity: string;
}

/** Total USD equity the address has deposited across vaults. Tolerant of failure. */
async function fetchVaultEquity(address: string, network: HlNetwork): Promise<number> {
  try {
    const rows = await infoRequest<RawVaultEquity[]>(network, {
      type: 'userVaultEquities',
      user: address,
    });
    return (rows ?? []).reduce((s, r) => s + n(r.equity), 0);
  } catch {
    return 0;
  }
}

/**
 * Fetch an address's full account: perps across the default dex AND the trade.xyz
 * (HIP-3) dex, the spot wallet, and vault equity. Positions are merged and tagged by
 * dex; their notional/margin are summed (xyz positions are real exposure).
 *
 * Account abstraction determines which balance surface is authoritative. Standard has
 * separate spot and per-DEX balances; unified and portfolio modes keep balances/holds
 * in spot. Read-only (the address is public, works for any account, no key).
 */
export async function fetchHlAccount(address: string, network: HlNetwork = 'mainnet'): Promise<HlAccount> {
  const dexes: HlPosition['dex'][] = ['default', 'xyz'];
  const [rawAbstraction, collateralTokens, defState, xyzState, spot, vaultValue] = await Promise.all([
    infoRequest<RawUserAbstraction>(network, { type: 'userAbstraction', user: address }),
    fetchSupportedCollateralTokens(network),
    infoRequest<RawClearinghouse>(network, { type: 'clearinghouseState', user: address }),
    infoRequest<RawClearinghouse>(network, { type: 'clearinghouseState', user: address, dex: XYZ_DEX }),
    fetchSpotBalances(address, network),
    fetchVaultEquity(address, network),
  ]);
  const states = [defState, xyzState];
  const abstractionMode = normalizeAccountMode(rawAbstraction);

  // Perp equity + risk span every dex (default crypto perps + the trade.xyz HIP-3 dex).
  let perpValue = 0;
  let totalMarginUsed = 0;
  let totalNotional = 0;
  let withdrawable = 0;
  let maintenanceMargin = 0;
  const positions: HlPosition[] = [];
  const marginStates: HlDexMarginState[] = [];

  states.forEach((state, i) => {
    perpValue += n(state.marginSummary.accountValue);
    totalMarginUsed += n(state.marginSummary.totalMarginUsed);
    totalNotional += n(state.marginSummary.totalNtlPos);
    withdrawable += n(state.withdrawable);
    maintenanceMargin += n(state.crossMaintenanceMarginUsed);
    marginStates.push({
      collateralToken: collateralTokens[i],
      accountValue: n(state.marginSummary.accountValue),
      crossAccountValue: n(state.crossMarginSummary?.accountValue),
      withdrawable: n(state.withdrawable),
      crossMaintenanceMarginUsed: n(state.crossMaintenanceMarginUsed),
      isolatedMarginUsed: state.assetPositions
        .filter(({ position }) => position.leverage.type === 'isolated')
        .reduce((sum, { position }) => sum + n(position.marginUsed), 0),
    });

    for (const { position: p } of state.assetPositions) {
      const szi = n(p.szi);
      const size = Math.abs(szi);
      const positionValue = n(p.positionValue);
      positions.push({
        coin: p.coin,
        dex: dexes[i],
        side: szi >= 0 ? 'long' : 'short',
        size,
        entryPx: n(p.entryPx),
        markPx: size > 0 ? positionValue / size : n(p.entryPx),
        positionValue,
        unrealizedPnl: n(p.unrealizedPnl),
        roe: n(p.returnOnEquity),
        leverage: p.leverage.value,
        leverageType: p.leverage.type,
        liquidationPx: p.liquidationPx != null ? n(p.liquidationPx) : null,
        marginUsed: n(p.marginUsed),
        maxLeverage: p.maxLeverage,
        // HL reports funding *paid*; negate so positive = collected by the trader.
        funding: -n(p.cumFunding?.sinceOpen),
      });
    }
  });

  const modeMetrics = deriveModeAwareAccountMetrics({
    mode: abstractionMode,
    dexStates: marginStates,
    spotBalances: spot.collateralBalances,
    spotLoaded: spot.loaded,
  });

  // Standard balances are separate and additive. Unified/portfolio perp state values are
  // not meaningful according to the API docs; spot is authoritative. Legacy DEX
  // abstraction remains mixed, so preserve the previous capped-overlap approximation for
  // total display while withholding its maintenance ratio above.
  const totalEquity =
    abstractionMode === 'standard'
      ? spot.value + vaultValue + perpValue
      : abstractionMode === 'unified' || abstractionMode === 'portfolioMargin'
        ? spot.value + vaultValue
        : spot.value + vaultValue + perpValue - Math.min(perpValue, spot.usdcTotal);

  return {
    abstractionMode,
    accountValue: perpValue,
    totalMarginUsed,
    totalNotional,
    withdrawable,
    maintenanceMargin,
    freeCollateral: modeMetrics.freeCollateral,
    riskSizingBase: modeMetrics.riskSizingBase,
    maintenanceUsage: modeMetrics.maintenanceUsage,
    unrealizedPnl: positions.reduce((s, p) => s + p.unrealizedPnl, 0),
    positions,
    spotBalances: spot.balances,
    spotValue: spot.value,
    availableUsdc: spot.usdcAvailable,
    vaultValue,
    totalEquity,
  };
}

// ---- Portfolio history ----------------------------------------------------

export interface HlPortfolioPoint {
  /** Sample time, ms epoch. */
  t: number;
  /** USD value at that time. */
  v: number;
}

export interface HlPortfolioWindow {
  /** Total account value (perps + spot + vaults) sampled over the window. */
  accountValue: HlPortfolioPoint[];
  /** Cumulative PnL over the window. */
  pnl: HlPortfolioPoint[];
  /** Traded volume over the window, USD. */
  volume: number;
}

export type HlPortfolioPeriodKey = 'day' | 'week' | 'month' | 'allTime';
export type HlPortfolio = Record<HlPortfolioPeriodKey, HlPortfolioWindow>;

interface RawPortfolioWindow {
  accountValueHistory?: [number, string][];
  pnlHistory?: [number, string][];
  vlm?: string;
}

/**
 * Portfolio value + PnL history — the exact series behind the web Portfolio page's
 * "Account Value" / "PNL" charts. The endpoint returns `[periodName, window]` tuples for
 * day/week/month/allTime plus perp-only variants; we keep the combined (perps + spot +
 * vaults) windows, whose latest point matches {@link fetchHlAccount}'s `totalEquity`.
 * Read-only (the address is public, so this works for any account without a key).
 */
export async function fetchHlPortfolio(
  address: string,
  network: HlNetwork = 'mainnet',
): Promise<HlPortfolio> {
  const rows = await infoRequest<[string, RawPortfolioWindow][]>(network, {
    type: 'portfolio',
    user: address,
  });
  const byKey = new Map(rows);
  const pts = (h?: [number, string][]) => (h ?? []).map(([t, v]) => ({ t, v: n(v) }));
  const win = (key: string): HlPortfolioWindow => {
    const w = byKey.get(key) ?? {};
    return { accountValue: pts(w.accountValueHistory), pnl: pts(w.pnlHistory), volume: n(w.vlm) };
  };
  return { day: win('day'), week: win('week'), month: win('month'), allTime: win('allTime') };
}

// ---- Open orders ----------------------------------------------------------

export interface HlOpenOrder {
  oid: number;
  coin: string;
  /** Which dex holds it (cosmetic badge; cancel resolves the asset-id from meta[coin]). */
  dex: 'default' | 'xyz';
  side: 'buy' | 'sell';
  limitPx: number;
  /** Remaining size in coins. */
  size: number;
  /** Original order size in coins. */
  origSize: number;
  /** e.g. "Limit", "Stop Market", "Take Profit Limit". */
  orderType: string;
  reduceOnly: boolean;
  isTrigger: boolean;
  triggerPx: number | null;
  /** Placed-at, ms since epoch. */
  timestamp: number;
}

interface RawFrontendOrder {
  oid: number;
  coin: string;
  side: 'B' | 'A';
  limitPx: string;
  sz: string;
  origSz: string;
  orderType?: string;
  reduceOnly?: boolean;
  isTrigger?: boolean;
  triggerPx?: string | null;
  timestamp: number;
}

function mapFrontendOrder(o: RawFrontendOrder): HlOpenOrder {
  const trig = o.triggerPx != null ? toNum(o.triggerPx) : null;
  return {
    oid: o.oid,
    coin: o.coin,
    dex: o.coin.includes(':') ? 'xyz' : 'default',
    side: o.side === 'B' ? 'buy' : 'sell',
    limitPx: n(o.limitPx),
    size: n(o.sz),
    origSize: n(o.origSz),
    orderType: o.orderType || 'Limit',
    reduceOnly: !!o.reduceOnly,
    isTrigger: !!o.isTrigger,
    triggerPx: trig && trig > 0 ? trig : null,
    timestamp: o.timestamp,
  };
}

/**
 * Resting (pending) orders across the default and trade.xyz dexes. We query both and
 * dedupe by oid — robust whether `frontendOpenOrders` is global or per-dex. Newest first.
 * Read-only (public address).
 */
export async function fetchOpenOrders(address: string, network: HlNetwork = 'mainnet'): Promise<HlOpenOrder[]> {
  const [base, xyz] = await Promise.all([
    infoRequest<RawFrontendOrder[]>(network, { type: 'frontendOpenOrders', user: address }),
    infoRequest<RawFrontendOrder[]>(network, { type: 'frontendOpenOrders', user: address, dex: XYZ_DEX }).catch(
      () => [] as RawFrontendOrder[],
    ),
  ]);
  const byOid = new Map<number, HlOpenOrder>();
  for (const o of [...(base ?? []), ...(xyz ?? [])]) byOid.set(o.oid, mapFrontendOrder(o));
  return [...byOid.values()].sort((a, b) => b.timestamp - a.timestamp);
}

// ---- Order book ------------------------------------------------------------

export interface HlBookLevel {
  price: number;
  /** Aggregate size resting at this price, in coin units. */
  size: number;
  /** Number of individual orders represented by the level. */
  orders: number;
}

export interface HlOrderBook {
  coin: string;
  timestamp: number;
  bids: HlBookLevel[];
  asks: HlBookLevel[];
}

interface RawBookLevel {
  px: string;
  sz: string;
  n: number;
}

interface RawOrderBook {
  coin: string;
  time: number;
  /** Hyperliquid returns bids first, asks second. */
  levels: [RawBookLevel[], RawBookLevel[]];
}

/**
 * Current L2 order-book snapshot (up to 20 levels per side). The trading ticket uses
 * this to surface spread, executable depth, and an estimated average fill before a
 * user signs a market order. HIP-3 coins are accepted directly as `dex:COIN`.
 */
export async function fetchOrderBook(
  coin: string,
  network: HlNetwork = 'mainnet',
): Promise<HlOrderBook> {
  const raw = await infoRequest<RawOrderBook>(network, { type: 'l2Book', coin });
  const map = (levels: RawBookLevel[]): HlBookLevel[] =>
    levels
      .map((level) => ({ price: n(level.px), size: n(level.sz), orders: level.n }))
      .filter((level) => level.price > 0 && level.size > 0);
  return {
    coin: raw.coin,
    timestamp: raw.time,
    bids: map(raw.levels?.[0] ?? []),
    asks: map(raw.levels?.[1] ?? []),
  };
}

// ---- Trade history (fills) ------------------------------------------------

export interface HlFill {
  /** oid + time uniquely identify a fill (one order can fill in several pieces). */
  key: string;
  coin: string;
  side: 'buy' | 'sell';
  /** Human-readable direction from HL: "Open Long", "Close Short", "Buy", … */
  dir: string;
  px: number;
  size: number;
  /**
   * GROSS realized PnL booked by this fill, BEFORE fees (closes only; 0 for
   * opens). Hyperliquid reports the fee separately, so net realized = closedPnl − fee.
   */
  closedPnl: number;
  /** Total fee in USDC for this fill; a NEGATIVE value is a maker rebate. */
  fee: number;
  /** True if the fill crossed the book (taker); false = maker (may earn a rebate). */
  crossed: boolean;
  /** L1 transaction hash, for an explorer link (may be empty on some fills). */
  hash: string;
  timestamp: number;
}

interface RawFill {
  coin: string;
  px: string;
  sz: string;
  side: 'B' | 'A';
  time: number;
  dir?: string;
  closedPnl?: string;
  fee?: string;
  oid?: number;
  hash?: string;
  crossed?: boolean;
}

/** Recent fills (trade history), newest first, capped to `limit`. Read-only (public address). */
export async function fetchUserFills(
  address: string,
  network: HlNetwork = 'mainnet',
  limit = 60,
): Promise<HlFill[]> {
  const raw = await infoRequest<RawFill[]>(network, { type: 'userFills', user: address });
  return (raw ?? [])
    .map((f, i): HlFill => ({
      key: `${f.oid ?? f.hash ?? 'f'}-${f.time}-${i}`,
      coin: f.coin,
      side: f.side === 'B' ? 'buy' : 'sell',
      dir: f.dir || (f.side === 'B' ? 'Buy' : 'Sell'),
      px: n(f.px),
      size: n(f.sz),
      closedPnl: n(f.closedPnl),
      fee: n(f.fee),
      crossed: f.crossed ?? false,
      hash: f.hash ?? '',
      timestamp: f.time,
    }))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}
