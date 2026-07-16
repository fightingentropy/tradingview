import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAccountRiskSummary,
  deriveModeAwareAccountMetrics,
  deriveSpendableSpotUsdc,
  isProtectiveStop,
} from '../src/lib/accountRisk.ts';

const long = {
  coin: 'xyz:SNDK',
  dex: 'xyz',
  side: 'long',
  size: 2,
  entryPx: 100,
  markPx: 110,
  positionValue: 220,
  unrealizedPnl: 20,
  roe: 0.2,
  leverage: 2,
  leverageType: 'cross',
  liquidationPx: 88,
  marginUsed: 110,
  maxLeverage: 10,
  funding: 0,
};

const short = { ...long, coin: 'BTC', dex: 'default', side: 'short', markPx: 100, liquidationPx: 125 };

function order(overrides = {}) {
  return {
    oid: 1,
    coin: long.coin,
    dex: 'xyz',
    side: 'sell',
    limitPx: 90,
    size: 2,
    origSize: 2,
    orderType: 'Stop Market',
    reduceOnly: true,
    isTrigger: true,
    triggerPx: 90,
    timestamp: 1,
    ...overrides,
  };
}

test('recognises protective stops and rejects take-profit or non-reduce triggers', () => {
  assert.equal(isProtectiveStop(order(), long), true);
  assert.equal(
    isProtectiveStop(order({ orderType: 'Take Profit Market', triggerPx: 130, limitPx: 130 }), long),
    false,
  );
  assert.equal(isProtectiveStop(order({ reduceOnly: false }), long), false);
  assert.equal(
    isProtectiveStop(
      order({ coin: short.coin, dex: 'default', side: 'buy', triggerPx: 115, limitPx: 115 }),
      short,
    ),
    true,
  );
});

test('summarises exposure, leverage, liquidation distance, and missing stops', () => {
  const summary = buildAccountRiskSummary(
    {
      abstractionMode: 'standard',
      accountValue: 200,
      totalMarginUsed: 100,
      totalNotional: 600,
      withdrawable: 75,
      maintenanceMargin: 10,
      freeCollateral: 75,
      riskSizingBase: 200,
      maintenanceUsage: 0.05,
      unrealizedPnl: 20,
      positions: [long, short],
      spotBalances: [],
      spotValue: 0,
      availableUsdc: 80,
      vaultValue: 0,
      totalEquity: 200,
    },
    [order()],
  );

  assert.equal(summary.freeCollateral, 75);
  assert.equal(summary.totalExposure, 600);
  assert.equal(summary.effectiveLeverage, 3);
  assert.equal(summary.maintenanceUsagePct, 5);
  assert.deepEqual(summary.closestLiquidation, { coin: long.coin, distancePct: 20 });
  assert.deepEqual([...summary.protectedCoins], [long.coin]);
  assert.equal(summary.stopCoverageByCoin.get(long.coin), 1);
  assert.equal(summary.stopCoverageByCoin.get(short.coin), 0);
  assert.deepEqual(summary.unprotectedCoins, [short.coin]);
});

test('does not call a partially stopped position fully protected', () => {
  const summary = buildAccountRiskSummary(
    {
      abstractionMode: 'standard',
      accountValue: 200,
      totalMarginUsed: 100,
      totalNotional: 220,
      withdrawable: 75,
      maintenanceMargin: 10,
      freeCollateral: 75,
      riskSizingBase: 200,
      maintenanceUsage: 0.05,
      unrealizedPnl: 20,
      positions: [long],
      spotBalances: [],
      spotValue: 0,
      availableUsdc: 80,
      vaultValue: 0,
      totalEquity: 200,
    },
    [order({ size: 0.5, origSize: 0.5 })],
  );

  assert.equal(summary.stopCoverageByCoin.get(long.coin), 0.25);
  assert.deepEqual([...summary.protectedCoins], []);
  assert.deepEqual(summary.unprotectedCoins, [long.coin]);
});

test('Standard uses per-DEX withdrawable and the worst cross maintenance ratio', () => {
  const metrics = deriveModeAwareAccountMetrics({
    mode: 'standard',
    dexStates: [
      {
        collateralToken: 0,
        accountValue: 1_000,
        crossAccountValue: 1_000,
        withdrawable: 700,
        crossMaintenanceMarginUsed: 50,
        isolatedMarginUsed: 0,
      },
      {
        collateralToken: 0,
        accountValue: 200,
        crossAccountValue: 200,
        withdrawable: 75,
        crossMaintenanceMarginUsed: 40,
        isolatedMarginUsed: 0,
      },
    ],
    // Mirrors the read-only demo: spot USDC can be effectively zero in Standard mode.
    spotBalances: [{ token: 0, total: 0.000019, hold: 0, usdPrice: 1 }],
  });

  assert.equal(metrics.freeCollateral, 775);
  assert.equal(metrics.riskSizingBase, 1_200);
  assert.equal(metrics.maintenanceUsage, 0.2);
});

test('Unified groups maintenance and isolated margin by collateral token', () => {
  const metrics = deriveModeAwareAccountMetrics({
    mode: 'unified',
    dexStates: [
      {
        collateralToken: 0,
        accountValue: 0,
        crossAccountValue: 0,
        withdrawable: 0,
        crossMaintenanceMarginUsed: 20,
        isolatedMarginUsed: 10,
      },
      {
        collateralToken: 0,
        accountValue: 0,
        crossAccountValue: 0,
        withdrawable: 0,
        crossMaintenanceMarginUsed: 10,
        isolatedMarginUsed: 5,
      },
      {
        collateralToken: 360,
        accountValue: 0,
        crossAccountValue: 0,
        withdrawable: 0,
        crossMaintenanceMarginUsed: 8,
        isolatedMarginUsed: 10,
      },
    ],
    spotBalances: [
      { token: 0, total: 200, hold: 20, usdPrice: 1 },
      { token: 360, total: 50, hold: 5, usdPrice: 2 },
    ],
  });

  // max((20 + 10) / (200 - 10 - 5), 8 / (50 - 10)) = 20%.
  assert.equal(metrics.maintenanceUsage, 0.2);
  assert.equal(metrics.freeCollateral, 270);
  assert.equal(metrics.riskSizingBase, 265);
});

test('does not invent a maintenance ratio for portfolio or DEX abstraction', () => {
  const inputs = {
    dexStates: [],
    spotBalances: [{ token: 0, total: 100, hold: 0, usdPrice: 1 }],
  };
  const portfolio = deriveModeAwareAccountMetrics({ mode: 'portfolioMargin', ...inputs });
  assert.equal(portfolio.maintenanceUsage, null);
  assert.equal(portfolio.riskSizingBase, 0);
  assert.equal(
    deriveModeAwareAccountMetrics({ mode: 'dexAbstraction', ...inputs }).maintenanceUsage,
    null,
  );
});

test('uses available spot USDC directly in Standard mode', () => {
  assert.equal(
    deriveSpendableSpotUsdc({
      mode: 'standard',
      availableSpotUsdc: 125.5,
      dexStates: [
        {
          collateralToken: 0,
          accountValue: 500,
          crossAccountValue: 400,
          withdrawable: 300,
          crossMaintenanceMarginUsed: 80,
          isolatedMarginUsed: 20,
        },
      ],
    }),
    125.5,
  );
});

test('reserves USDC-backed cross maintenance and isolated margin in Unified mode', () => {
  assert.equal(
    deriveSpendableSpotUsdc({
      mode: 'unified',
      availableSpotUsdc: 200,
      dexStates: [
        {
          collateralToken: 0,
          accountValue: 0,
          crossAccountValue: 0,
          withdrawable: 0,
          crossMaintenanceMarginUsed: 20,
          isolatedMarginUsed: 10,
        },
        {
          collateralToken: 0,
          accountValue: 0,
          crossAccountValue: 0,
          withdrawable: 0,
          crossMaintenanceMarginUsed: 5,
          isolatedMarginUsed: 2,
        },
        {
          // A non-USDC collateral DEX must not reserve from the USDC balance.
          collateralToken: 360,
          accountValue: 0,
          crossAccountValue: 0,
          withdrawable: 0,
          crossMaintenanceMarginUsed: 50,
          isolatedMarginUsed: 25,
        },
      ],
    }),
    163,
  );
});

test('clamps Unified spendable USDC at zero when reserves exceed the balance', () => {
  assert.equal(
    deriveSpendableSpotUsdc({
      mode: 'unified',
      availableSpotUsdc: 20,
      dexStates: [
        {
          collateralToken: 0,
          accountValue: 0,
          crossAccountValue: 0,
          withdrawable: 0,
          crossMaintenanceMarginUsed: 15,
          isolatedMarginUsed: 10,
        },
      ],
    }),
    0,
  );
});

test('fails closed without spot data and for unsupported abstraction modes', () => {
  const base = { availableSpotUsdc: 100, dexStates: [] };
  assert.equal(deriveSpendableSpotUsdc({ mode: 'standard', ...base, spotLoaded: false }), 0);
  assert.equal(deriveSpendableSpotUsdc({ mode: 'unified', ...base, spotLoaded: false }), 0);
  assert.equal(deriveSpendableSpotUsdc({ mode: 'portfolioMargin', ...base }), 0);
  assert.equal(deriveSpendableSpotUsdc({ mode: 'dexAbstraction', ...base }), 0);
});
