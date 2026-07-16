import type { HlAccount, HlOpenOrder, HlPosition } from '@/lib/hyperliquid/info';

export type HlAccountMode = 'standard' | 'unified' | 'portfolioMargin' | 'dexAbstraction';

/** The per-DEX margin facts needed to derive mode-aware account risk. */
export interface HlDexMarginState {
  /** Spot token index used as this DEX's collateral. */
  collateralToken: number;
  accountValue: number;
  crossAccountValue: number;
  withdrawable: number;
  crossMaintenanceMarginUsed: number;
  isolatedMarginUsed: number;
}

/** A spot balance plus its USD conversion, used only for collateral tokens. */
export interface HlCollateralBalance {
  token: number;
  total: number;
  hold: number;
  usdPrice: number;
}

export interface ModeAwareAccountMetrics {
  /** Capital that can currently be deployed, in USD. */
  freeCollateral: number;
  /** Equity/collateral base used for percentage risk sizing and gross leverage. */
  riskSizingBase: number;
  /** Maintenance usage as a fraction (1 = liquidation threshold), when exact. */
  maintenanceUsage: number | null;
}

/** Hyperliquid's mainnet USDC spot-token index. */
const USDC_TOKEN = 0;

/**
 * Conservative USDC that can fund a new spot/outcome buy.
 *
 * Standard mode keeps spot separate from perps, so the available spot USDC is
 * spendable as reported. Unified mode shares that USDC with every USDC-backed
 * perp DEX, so reserve both cross maintenance and isolated margin before
 * presenting buying power. Portfolio Margin and legacy DEX abstraction need
 * live collateral rules this app does not model and therefore fail closed.
 */
export function deriveSpendableSpotUsdc({
  mode,
  availableSpotUsdc,
  dexStates,
  spotLoaded = true,
}: {
  mode: HlAccountMode;
  availableSpotUsdc: number;
  dexStates: readonly HlDexMarginState[];
  spotLoaded?: boolean;
}): number {
  if (!spotLoaded || !Number.isFinite(availableSpotUsdc) || availableSpotUsdc <= 0) return 0;
  if (mode === 'standard') return availableSpotUsdc;
  if (mode !== 'unified') return 0;

  let reservedUsdc = 0;
  for (const state of dexStates) {
    if (state.collateralToken !== USDC_TOKEN) continue;
    if (
      !Number.isFinite(state.crossMaintenanceMarginUsed) ||
      !Number.isFinite(state.isolatedMarginUsed)
    ) {
      return 0;
    }
    reservedUsdc +=
      Math.max(0, state.crossMaintenanceMarginUsed) + Math.max(0, state.isolatedMarginUsed);
    if (!Number.isFinite(reservedUsdc)) return 0;
  }
  return Math.max(0, availableSpotUsdc - reservedUsdc);
}

/**
 * Derive account-level risk without mixing incompatible abstraction modes.
 *
 * Standard keeps separate balances per DEX, so withdrawable and account equity come
 * from each DEX and liquidation risk is the worst per-DEX cross ratio. Unified draws
 * every DEX from spot collateral; its ratio follows Hyperliquid's documented formula,
 * grouping maintenance and isolated margin by collateral token. Portfolio margin and
 * legacy DEX abstraction need inputs this app does not have, so their maintenance ratio
 * is intentionally unknown rather than a plausible-looking but unsafe approximation.
 */
export function deriveModeAwareAccountMetrics({
  mode,
  dexStates,
  spotBalances,
  spotLoaded = true,
}: {
  mode: HlAccountMode;
  dexStates: readonly HlDexMarginState[];
  spotBalances: readonly HlCollateralBalance[];
  spotLoaded?: boolean;
}): ModeAwareAccountMetrics {
  if (mode === 'standard') {
    let maintenanceUsage: number | null = 0;
    for (const state of dexStates) {
      if (state.crossAccountValue > 0) {
        maintenanceUsage = Math.max(
          maintenanceUsage ?? 0,
          state.crossMaintenanceMarginUsed / state.crossAccountValue,
        );
      } else if (state.crossMaintenanceMarginUsed > 0) {
        // A positive requirement without a usable denominator is not safe to estimate.
        maintenanceUsage = null;
        break;
      }
    }

    return {
      freeCollateral: dexStates.reduce((sum, state) => sum + Math.max(0, state.withdrawable), 0),
      riskSizingBase: dexStates.reduce((sum, state) => sum + Math.max(0, state.accountValue), 0),
      maintenanceUsage,
    };
  }

  const collateralTokens = new Set(dexStates.map((state) => state.collateralToken));
  const balanceByToken = new Map(spotBalances.map((balance) => [balance.token, balance]));
  const spotAvailableUsd = [...collateralTokens].reduce((sum, token) => {
    const balance = balanceByToken.get(token);
    return balance
      ? sum + Math.max(0, balance.total - balance.hold) * Math.max(0, balance.usdPrice)
      : sum;
  }, 0);

  if (mode === 'unified') {
    const crossMarginByToken = new Map<number, number>();
    const isolatedMarginByToken = new Map<number, number>();
    for (const state of dexStates) {
      crossMarginByToken.set(
        state.collateralToken,
        (crossMarginByToken.get(state.collateralToken) ?? 0) + state.crossMaintenanceMarginUsed,
      );
      isolatedMarginByToken.set(
        state.collateralToken,
        (isolatedMarginByToken.get(state.collateralToken) ?? 0) + state.isolatedMarginUsed,
      );
    }

    let maintenanceUsage: number | null = spotLoaded ? 0 : null;
    let riskSizingBase = 0;
    if (spotLoaded) {
      for (const token of collateralTokens) {
        const balance = balanceByToken.get(token);
        const total = balance?.total ?? 0;
        const collateral = total - (isolatedMarginByToken.get(token) ?? 0);
        if (collateral > 0) {
          maintenanceUsage = Math.max(
            maintenanceUsage ?? 0,
            (crossMarginByToken.get(token) ?? 0) / collateral,
          );
          riskSizingBase += collateral * Math.max(0, balance?.usdPrice ?? 0);
        }
      }
    }

    return {
      freeCollateral: spotLoaded ? spotAvailableUsd : 0,
      riskSizingBase,
      maintenanceUsage,
    };
  }

  // Spot is the authoritative balance surface for portfolio margin. DEX abstraction
  // remains perps-led for USDC, so retain its DEX equity/withdrawable as the safest base.
  if (mode === 'portfolioMargin') {
    return {
      freeCollateral: spotLoaded ? spotAvailableUsd : 0,
      // Portfolio Margin only accepts a documented subset of assets as eligible
      // collateral and applies LTV/liquidation thresholds. Until those live inputs
      // are fetched, percentage sizing must stay unavailable instead of counting
      // arbitrary spot holdings as risk capital.
      riskSizingBase: 0,
      maintenanceUsage: null,
    };
  }

  return {
    freeCollateral: dexStates.reduce((sum, state) => sum + Math.max(0, state.withdrawable), 0),
    riskSizingBase: dexStates.reduce((sum, state) => sum + Math.max(0, state.accountValue), 0),
    maintenanceUsage: null,
  };
}

export interface LiquidationRisk {
  coin: string;
  /** Absolute mark-to-liquidation distance as a percentage of the current mark. */
  distancePct: number;
}

export interface AccountRiskSummary {
  freeCollateral: number;
  totalExposure: number;
  /** Gross exposure divided by the mode-correct risk base. Null when it is not positive. */
  effectiveLeverage: number | null;
  /** Exact mode-aware maintenance usage (100% is liquidation), when available. */
  maintenanceUsagePct: number | null;
  closestLiquidation: LiquidationRisk | null;
  /** Coins whose protective stop quantity covers the full live position. */
  protectedCoins: ReadonlySet<string>;
  /** Protective stop coverage as a fraction of live size, capped at 1. */
  stopCoverageByCoin: ReadonlyMap<string, number>;
  unprotectedCoins: readonly string[];
}

function orderClosesPosition(order: HlOpenOrder, position: HlPosition): boolean {
  return (
    order.coin === position.coin &&
    ((position.side === 'long' && order.side === 'sell') ||
      (position.side === 'short' && order.side === 'buy'))
  );
}

/**
 * Hyperliquid labels stop-loss triggers inconsistently across order entry paths, so
 * prefer the explicit label and fall back to the trigger's adverse side of the mark.
 */
export function isProtectiveStop(order: HlOpenOrder, position: HlPosition): boolean {
  if (!order.reduceOnly || !order.isTrigger || !orderClosesPosition(order, position)) return false;

  const label = order.orderType.toLowerCase();
  if (label.includes('take profit') || /\btp\b/.test(label)) return false;
  if (label.includes('stop loss') || /\bsl\b/.test(label) || label.startsWith('stop ')) return true;

  const triggerPx = order.triggerPx;
  if (triggerPx == null || triggerPx <= 0 || position.markPx <= 0) return false;
  return position.side === 'long' ? triggerPx < position.markPx : triggerPx > position.markPx;
}

/** Derive the small set of account-level facts needed by the live risk strip. */
export function buildAccountRiskSummary(
  account: HlAccount,
  openOrders: readonly HlOpenOrder[],
): AccountRiskSummary {
  const protectedCoins = new Set<string>();
  const stopCoverageByCoin = new Map<string, number>();
  let closestLiquidation: LiquidationRisk | null = null;

  for (const position of account.positions) {
    const stoppedSize = openOrders
      .filter((order) => isProtectiveStop(order, position))
      .reduce((sum, order) => sum + Math.max(0, order.size), 0);
    const coverage = position.size > 0 ? Math.min(1, stoppedSize / position.size) : 0;
    stopCoverageByCoin.set(position.coin, coverage);
    // A tiny precision tolerance avoids flagging a full-size stop after wire rounding.
    if (coverage >= 0.999999) {
      protectedCoins.add(position.coin);
    }

    if (position.liquidationPx != null && position.liquidationPx > 0 && position.markPx > 0) {
      const distancePct = (Math.abs(position.markPx - position.liquidationPx) / position.markPx) * 100;
      if (!closestLiquidation || distancePct < closestLiquidation.distancePct) {
        closestLiquidation = { coin: position.coin, distancePct };
      }
    }
  }

  const leverageBase = account.riskSizingBase;
  return {
    freeCollateral: account.freeCollateral,
    totalExposure: account.totalNotional,
    effectiveLeverage: leverageBase > 0 ? account.totalNotional / leverageBase : null,
    maintenanceUsagePct:
      account.maintenanceUsage == null ? null : account.maintenanceUsage * 100,
    closestLiquidation,
    protectedCoins,
    stopCoverageByCoin,
    unprotectedCoins: account.positions
      .filter((position) => !protectedCoins.has(position.coin))
      .map((position) => position.coin),
  };
}
