/**
 * Hyperliquid account reads (public `info` endpoint — no auth, just an address).
 * Powers the Account tab: margin summary + open perp positions with live marks.
 */
import { toNum } from '@/lib/format';

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
 *   100000 + (d − 1) * 10000 + universeIndex   (Hyperliquid SDK formula).
 * xyz is `perpDexs[1]` → offset 100000. We resolve the index LIVE rather than hardcode
 * it, because a wrong offset routes an order to a DIFFERENT dex's asset (e.g. 110000
 * lands on Felix Exchange, `perpDexs[2]`) — dangerous with real funds. Reads use the
 * `dex` param and don't need this.
 */
const PERP_DEX_OFFSET_BASE = 100000;
const PERP_DEX_OFFSET_STEP = 10000;

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
  /** Total perp account equity, USD. */
  accountValue: number;
  totalMarginUsed: number;
  /** Total open notional across positions, USD. */
  totalNotional: number;
  withdrawable: number;
  maintenanceMargin: number;
  /** Summed unrealized PnL across positions. */
  unrealizedPnl: number;
  positions: HlPosition[];
  /** Spot wallet token balances (non-zero), richest first. */
  spotBalances: HlSpotBalance[];
  /** Total USD value of the spot wallet (all tokens, incl. USDC reserved as margin). */
  spotValue: number;
  /** Freely-available USDC in spot (total − hold) — the real "available to trade". */
  availableUsdc: number;
  /** Total USD equity deposited in vaults. */
  vaultValue: number;
  /**
   * Hyperliquid's "Total Equity" — the figure at the top of the web Portfolio page.
   * = spot value + vaults + perp equity − the overlap where perp collateral is a
   * reserved slice of the spot USDC (unified margin). Counting spot and perp naively
   * double-counts that shared collateral; subtracting the overlap matches the web.
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
}

async function infoRequest<T>(network: HlNetwork, body: object): Promise<T> {
  const res = await fetch(`${HL_API[network]}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid info ${res.status}`);
  return (await res.json()) as T;
}

interface RawClearinghouse {
  marginSummary: { accountValue: string; totalNtlPos: string; totalMarginUsed: string };
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
    };
  }[];
}

const n = (v: string | null | undefined) => toNum(v ?? null) ?? 0;

/**
 * Resolve a builder dex's order-id offset from its live `perpDexs` index:
 * index 0 = default (offset 0); index d ≥ 1 = 100000 + (d − 1) * 10000. Falls back to
 * the first-builder offset (100000) if the list can't be read. Resolving it live (vs a
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
  type RawUniverse = { universe: { name: string; szDecimals: number; maxLeverage: number }[] };
  const [core, xyz, xyzOffset] = await Promise.all([
    infoRequest<RawUniverse>(network, { type: 'meta' }),
    infoRequest<RawUniverse>(network, { type: 'meta', dex: XYZ_DEX }),
    fetchPerpDexOffset(network, XYZ_DEX),
  ]);

  const out: Record<string, HlAssetMeta> = {};
  core.universe.forEach((u, i) => {
    out[u.name] = { name: u.name, assetIndex: i, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage };
  });
  // xyz universe names are already `xyz:NAME`; order id = the dex's offset + universe index.
  xyz.universe.forEach((u, i) => {
    out[u.name] = {
      name: u.name,
      assetIndex: xyzOffset + i,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
    };
  });
  return out;
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

/** Live mark prices keyed by coin (the `allMids` feed). */
export async function fetchHlMids(network: HlNetwork = 'mainnet'): Promise<Record<string, number>> {
  const mids = await infoRequest<Record<string, string>>(network, { type: 'allMids' });
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(mids)) out[k] = n(v);
  return out;
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
 * Also reports the USDC `hold` (USDC reserved as perp cross-margin under unified
 * margin) and the freely-available USDC, which the account total uses to avoid
 * double-counting collateral that shows up in both spot and the perp accountValue.
 */
async function fetchSpotBalances(
  address: string,
  network: HlNetwork,
): Promise<{ balances: HlSpotBalance[]; value: number; usdcHold: number; usdcAvailable: number }> {
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
    const usdcHold = n(usdc?.hold);
    const usdcAvailable = n(usdc?.total) - usdcHold;
    return {
      balances,
      value: balances.reduce((s, b) => s + b.usdValue, 0),
      usdcHold,
      usdcAvailable,
    };
  } catch {
    return { balances: [], value: 0, usdcHold: 0, usdcAvailable: 0 };
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
 * The total equity is the subtle part. Under unified margin a perp position's
 * collateral is a *reserved slice of the spot USDC* — the spot wallet reports that
 * slice as `hold`, and the perp `accountValue` mirrors it. So spot value and perp
 * equity overlap by (up to) the held USDC; adding them naively double-counts it
 * (e.g. an all-spot account with margined perps would read far above its real worth).
 * We subtract the overlap so `totalEquity` matches Hyperliquid's own "Total Equity".
 * Read-only (the address is public, so this works for any account without a key).
 */
export async function fetchHlAccount(address: string, network: HlNetwork = 'mainnet'): Promise<HlAccount> {
  const dexes: HlPosition['dex'][] = ['default', 'xyz'];
  const [defState, xyzState, spot, vaultValue] = await Promise.all([
    infoRequest<RawClearinghouse>(network, { type: 'clearinghouseState', user: address }),
    infoRequest<RawClearinghouse>(network, { type: 'clearinghouseState', user: address, dex: XYZ_DEX }),
    fetchSpotBalances(address, network),
    fetchVaultEquity(address, network),
  ]);
  const states = [defState, xyzState];

  // Perp equity + risk span every dex (default crypto perps + the trade.xyz HIP-3 dex).
  let perpValue = 0;
  let totalMarginUsed = 0;
  let totalNotional = 0;
  let withdrawable = 0;
  let maintenanceMargin = 0;
  const positions: HlPosition[] = [];

  states.forEach((state, i) => {
    perpValue += n(state.marginSummary.accountValue);
    totalMarginUsed += n(state.marginSummary.totalMarginUsed);
    totalNotional += n(state.marginSummary.totalNtlPos);
    withdrawable += n(state.withdrawable);
    maintenanceMargin += n(state.crossMaintenanceMarginUsed);

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
      });
    }
  });

  // Overlap = the perp collateral that's actually reserved-from-spot USDC (counted in
  // both spot value and perp equity). Cap at perpValue so a classic account with
  // separately-funded perps (hold ≈ 0) keeps its full perp equity additive.
  const overlap = Math.min(perpValue, spot.usdcHold);
  const totalEquity = spot.value + vaultValue + perpValue - overlap;

  return {
    accountValue: perpValue,
    totalMarginUsed,
    totalNotional,
    withdrawable,
    maintenanceMargin,
    unrealizedPnl: positions.reduce((s, p) => s + p.unrealizedPnl, 0),
    positions,
    spotBalances: spot.balances,
    spotValue: spot.value,
    availableUsdc: spot.usdcAvailable,
    vaultValue,
    totalEquity,
  };
}
