import type { HlAccountMode } from '@/lib/accountRisk';
import { portfolioNumber } from '@/lib/portfolioMetrics';

export interface OverviewSpotState {
  portfolioMarginRatio?: unknown;
  tokenToPortfolioBorrowRatio?: unknown;
  balances: { coin: string; token: number; total: unknown; ltv?: unknown }[];
}

export interface OverviewPerpState {
  marginSummary: { accountValue: unknown; totalNtlPos: unknown };
  crossMarginSummary: { accountValue: unknown };
  crossMaintenanceMarginUsed: unknown;
  assetPositions: { position: {
    unrealizedPnl: unknown;
    leverage: { type: string };
    marginUsed: unknown;
  } }[];
}

export interface OverviewPrices {
  byToken: Record<number, number>;
  byCoin: Record<string, number>;
}

/** Display-only metrics. Never use these aggregates as order buying power. */
export interface HlAccountOverview {
  mode: HlAccountMode;
  marginRatio: number | null;
  portfolioValue: number | null;
  unrealizedPnl: number | null;
  borrowCapUsed: number | null;
  perpsMaintenanceMargin: number | null;
  accountLeverage: number | null;
}

const sum = (values: (number | null)[]): number | null => {
  if (values.some((value) => value == null)) return null;
  const total = values.reduce<number>((total, value) => total + (value ?? 0), 0);
  return Number.isFinite(total) ? total : null;
};
const nonnegative = (value: unknown) => {
  const number = portfolioNumber(value);
  return number != null && number >= 0 ? number : null;
};
const converted = (value: number | null, price: number | null) =>
  value === 0 ? 0 : value != null && price != null ? value * price : null;

/** An empty reported collection is zero; missing or malformed ratios are unknown. */
function borrowRatio(raw: unknown): number | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<number>();
  let highest = 0;
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) || entry[0] < 0 || seen.has(entry[0])) return null;
    const ratio = nonnegative(entry[1]);
    if (ratio == null) return null;
    seen.add(entry[0]);
    highest = Math.max(highest, ratio);
  }
  return highest;
}

/**
 * Mirrors Hyperliquid's account-mode summary. PM's liquidation ratio comes directly
 * from the exchange; it cannot be reconstructed from maintenance / account equity.
 * Perp totals require every discovered DEX, including those not tradable in this app.
 */
export function deriveAccountOverview({ mode, spot, prices, perps }: {
  mode: HlAccountMode;
  spot: OverviewSpotState | null;
  prices: OverviewPrices | null;
  perps: { collateralToken: number; state: OverviewPerpState }[] | null;
}): HlAccountOverview {
  const tokenPrice = (token: number) => token === 0 ? 1 : nonnegative(prices?.byToken[token]);
  const balancesValid = Array.isArray(spot?.balances) && spot.balances.every((balance) =>
    balance && typeof balance.coin === 'string' && Number.isSafeInteger(balance.token) &&
    balance.token >= 0 && portfolioNumber(balance.total) != null) &&
    new Set(spot.balances.map((balance) => balance.token)).size === spot.balances.length;
  const balances = balancesValid ? spot!.balances : null;
  const spotValues = balances?.map((balance) => converted(portfolioNumber(balance.total),
    balance.coin.startsWith('+') ? nonnegative(prices?.byCoin[`#${balance.coin.slice(1)}`]) : tokenPrice(balance.token)));
  const spotValue = spotValues ? sum(spotValues) : null;

  const perpValues = perps?.map(({ collateralToken, state }) => {
    const price = tokenPrice(collateralToken);
    const positions = Array.isArray(state?.assetPositions) ? state.assetPositions : null;
    const notional = portfolioNumber(state?.marginSummary?.totalNtlPos);
    return {
      token: collateralToken,
      accountValue: converted(portfolioNumber(state?.marginSummary?.accountValue), price),
      crossAccountValue: portfolioNumber(state?.crossMarginSummary?.accountValue),
      notional: converted(notional == null ? null : Math.abs(notional), price),
      maintenance: nonnegative(state?.crossMaintenanceMarginUsed),
      maintenanceUsd: converted(nonnegative(state?.crossMaintenanceMarginUsed), price),
      isolatedMargin: positions ? sum(positions.map((entry) =>
        entry?.position?.leverage?.type === 'cross' ? 0 : entry?.position?.leverage?.type === 'isolated' ? nonnegative(entry.position.marginUsed) : null)) : null,
      pnl: positions ? converted(sum(positions.map((entry) => portfolioNumber(entry?.position?.unrealizedPnl))), price) : null,
    };
  });
  const perpsNotional = perpValues ? sum(perpValues.map((value) => value.notional)) : null;
  const perpsValue = perpValues ? sum(perpValues.map((value) => value.accountValue)) : null;
  const portfolioValue = mode === 'unified' || mode === 'portfolioMargin' ? spotValue : perpsValue;

  let marginRatio: number | null = mode === 'portfolioMargin' ? nonnegative(spot?.portfolioMarginRatio) : null;
  if (mode === 'standard' && perpValues) {
    marginRatio = 0;
    for (const state of perpValues) {
      if (state.maintenance == null || state.crossAccountValue == null || (state.maintenance > 0 && state.crossAccountValue <= 0)) {
        marginRatio = null;
        break;
      }
      marginRatio = Math.max(marginRatio, state.maintenance === 0 ? 0 : state.maintenance / state.crossAccountValue);
    }
  }
  if (mode === 'unified' && perpValues && balances) {
    marginRatio = 0;
    const tokens = new Set(perpValues.map((state) => state.token));
    for (const token of tokens) {
      const matching = perpValues.filter((state) => state.token === token);
      const maintenance = sum(matching.map((state) => state.maintenance));
      const isolated = sum(matching.map((state) => state.isolatedMargin));
      const total = portfolioNumber(balances.find((balance) => balance.token === token)?.total) ?? 0;
      if (maintenance == null || isolated == null || (maintenance > 0 && total - isolated <= 0)) {
        marginRatio = null;
        break;
      }
      marginRatio = Math.max(marginRatio, maintenance === 0 ? 0 : maintenance / (total - isolated));
    }
  }

  // PM leverage includes eligible spot collateral plus gross perpetual exposure.
  // Keep liabilities signed in the denominator and exclude cash / ineligible assets.
  const collateralExposure = mode !== 'portfolioMargin' ? 0 : balances ? sum(balances.map((balance, index) => {
    const ltv = balance.ltv == null ? 0 : nonnegative(balance.ltv);
    if (ltv == null || ltv > 1) return null;
    return ltv > 0 && portfolioNumber(balance.total)! > 0 ? spotValues![index] : 0;
  })) : null;
  const exposure = sum([perpsNotional, collateralExposure]);
  const accountLeverage = portfolioValue != null && exposure != null
    ? portfolioValue > 0 ? exposure / portfolioValue : portfolioValue === 0 && exposure === 0 ? 0 : null
    : null;

  return {
    mode, portfolioValue,
    marginRatio: marginRatio != null && Number.isFinite(marginRatio) ? marginRatio : null,
    accountLeverage: accountLeverage != null && Number.isFinite(accountLeverage) ? accountLeverage : null,
    unrealizedPnl: perpValues ? sum(perpValues.map((value) => value.pnl)) : null,
    borrowCapUsed: mode === 'portfolioMargin' ? borrowRatio(spot?.tokenToPortfolioBorrowRatio) : null,
    perpsMaintenanceMargin: perpValues ? sum(perpValues.map((value) => value.maintenanceUsd)) : null,
  };
}
