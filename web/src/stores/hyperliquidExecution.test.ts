import { describe, expect, test } from "bun:test";
import { __test } from "./hyperliquidExecution";

describe("Hyperliquid execution input boundaries", () => {
  test("accepts and normalizes an exact EVM address", () => {
    expect(
      __test.normalizeAddress("  0xAABBCCDDEEFF0011223344556677889900AABBCC  "),
    ).toBe("0xaabbccddeeff0011223344556677889900aabbcc");
    expect(__test.normalizeAddress("aabbccddeeff0011223344556677889900aabbcc")).toBeNull();
    expect(__test.normalizeAddress("0x1234")).toBeNull();
    expect(__test.normalizeAddress("0x" + "g".repeat(40))).toBeNull();
  });

  test("requires a 0x-prefixed 32-byte API-wallet private key", () => {
    const key = `0x${"ab".repeat(32)}`;
    expect(__test.normalizePrivateKey(`  ${key}  `)).toBe(key);
    expect(__test.normalizePrivateKey("ab".repeat(32))).toBeNull();
    expect(__test.normalizePrivateKey(`0x${"ab".repeat(31)}`)).toBeNull();
    expect(__test.normalizePrivateKey(`0x${"zz".repeat(32)}`)).toBeNull();
  });

  test("accepts only bounded exchange-reported collateral LTVs", () => {
    expect(__test.parseCollateralLtv("0.65")).toBe(0.65);
    expect(__test.parseCollateralLtv("0")).toBe(0);
    expect(__test.parseCollateralLtv("1")).toBe(1);
    expect(__test.parseCollateralLtv(undefined)).toBeUndefined();
    expect(__test.parseCollateralLtv("1.01")).toBeUndefined();
    expect(__test.parseCollateralLtv("invalid")).toBeUndefined();
  });

  test("normalizes bare spot symbols without changing explicit pairs", () => {
    expect(__test.marketSymbol(" btc ", "spot")).toBe("BTC/USDC");
    expect(__test.marketSymbol("HYPE/USDC", "spot")).toBe("HYPE/USDC");
    expect(__test.marketSymbol("xyz:TSLA", "perp")).toBe("xyz:TSLA");
    expect(__test.marketSymbol("XYZ:tsla", "perp")).toBe("xyz:TSLA");
  });

  test("builds a direction-aware one percent market-order cap", () => {
    expect(__test.directionalMarketLimitPrice(100, "buy")).toBe(101);
    expect(__test.directionalMarketLimitPrice(100, "sell")).toBe(99);
  });

  test("separates total spot balances from executable availability", () => {
    expect(__test.availableSpotBalance("10", "2.5")).toBe(7.5);
    expect(__test.availableSpotBalance("10", "2.5", "4.25")).toBe(4.25);
    expect(__test.availableSpotBalance("1", "2")).toBe(0);
    expect(__test.availableSpotBalance("10", "2.5", undefined, true)).toBe(0);
    expect(__test.requiresMaintenanceAvailability("unifiedAccount")).toBe(true);
    expect(__test.requiresMaintenanceAvailability("portfolioMargin")).toBe(true);
    expect(__test.requiresMaintenanceAvailability("disabled")).toBe(false);
    expect(__test.requiresMaintenanceAvailability("default")).toBe(false);
  });

  test("preserves exchange-reported borrowing and falls back to negative net balance", () => {
    expect(__test.borrowedSpotBalance("74.25", "-70")).toBe(74.25);
    expect(__test.borrowedSpotBalance(undefined, "-70")).toBe(70);
    expect(__test.borrowedSpotBalance(undefined, "25")).toBe(0);
    expect(__test.borrowedSpotBalance("-1", "-70")).toBe(0);
  });

  test("derives the Hyperliquid portfolio-margin summary from one risk snapshot", () => {
    const summary = __test.derivePortfolioMarginSummary(
      {
        portfolioMarginRatio: "0.4569824749",
        tokenToPortfolioBorrowRatio: [[0, "0.002016176"]],
        balances: [
          { coin: "USDC", total: "-75424.29992666", ltv: "0" },
          { coin: "HYPE", total: "3000.03081983", ltv: "0.65" },
        ],
      },
      [
        {
          marginSummary: { totalNtlPos: "251568.0" },
          crossMaintenanceMarginUsed: "12578.4",
          assetPositions: [
            { position: { unrealizedPnl: "-76636.914104" } },
          ],
        },
      ],
      { "HYPE/USDC": 83.8475 },
    );

    expect(summary.marginRatio).toBeCloseTo(0.4569824749);
    expect(summary.portfolioValue).toBeCloseTo(176120.784239, 5);
    expect(summary.unrealizedPnl).toBeCloseTo(-76636.914104);
    expect(summary.borrowCapUsed).toBeCloseTo(0.002016176);
    expect(summary.perpsMaintenanceMargin).toBeCloseTo(12578.4);
    expect(summary.accountLeverage).toBeCloseTo(2.856636633, 6);
  });

  test("does not publish a partial portfolio value when a holding is unpriced", () => {
    const summary = __test.derivePortfolioMarginSummary(
      {
        balances: [
          { coin: "USDC", total: "100", ltv: "0" },
          { coin: "UNKNOWN", total: "2", ltv: "0.5" },
        ],
      },
      [
        {
          marginSummary: { totalNtlPos: "25" },
          crossMaintenanceMarginUsed: "1.25",
          assetPositions: [],
        },
      ],
      {},
    );

    expect(summary.portfolioValue).toBeUndefined();
    expect(summary.accountLeverage).toBeUndefined();
    expect(summary.borrowCapUsed).toBeUndefined();
  });

  test("never updates leverage for a reduce-only order", () => {
    expect(
      __test.shouldUpdateLeverage({
        symbol: "ETH",
        side: "sell",
        type: "market",
        size: 1,
        leverage: 5,
        marginType: "cross",
        reduceOnly: true,
      }),
    ).toBe(false);
    expect(
      __test.shouldUpdateLeverage({
        symbol: "ETH",
        side: "buy",
        type: "market",
        size: 1,
        leverage: 5,
        marginType: "cross",
      }),
    ).toBe(true);
  });

  test("selects only owned position TP/SL orders for replacement", () => {
    const baseOrder = {
      symbol: "ETH",
      side: "sell" as const,
      type: "limit" as const,
      price: 1,
      size: 1,
      originalSize: 1,
      createdAt: 1,
      reduceOnly: true,
      isTrigger: true,
      orderType: "Stop Market",
    };
    const selected = __test.positionTpslOrdersForSymbol(
      [
        { ...baseOrder, oid: 1, isPositionTpsl: true },
        { ...baseOrder, oid: 2, isPositionTpsl: false },
        { ...baseOrder, oid: 3, symbol: "BTC", isPositionTpsl: true },
      ],
      "ETH",
    );
    expect(selected.map((order) => order.oid)).toEqual([1]);
  });

  test("validates TP/SL inputs before any replacement work", () => {
    expect(__test.validTriggerPrice(undefined)).toBe(true);
    expect(__test.validTriggerPrice(null)).toBe(true);
    expect(__test.validTriggerPrice(100)).toBe(true);
    expect(__test.validTriggerPrice(0)).toBe(false);
    expect(__test.validTriggerPrice(Number.NaN)).toBe(false);
    expect(
      __test.positionTriggerDirectionError(
        { size: 1, markPrice: 100 },
        99,
        90,
      ),
    ).toContain("take profit");
    expect(
      __test.positionTriggerDirectionError(
        { size: -1, markPrice: 100 },
        90,
        99,
      ),
    ).toContain("stop loss");
    expect(
      __test.positionTriggerDirectionError(
        { size: 1, markPrice: 100 },
        110,
        90,
      ),
    ).toBeNull();
  });

  test("derives the relevant DEX only from an explicit prefix", () => {
    expect(__test.perpDexForSymbol("ETH")).toBe("");
    expect(__test.perpDexForSymbol("xyz:ALUMINIUM")).toBe("xyz");
    expect(
      __test.trackedPerpDexsForRefresh(new Set(["", "xyz", "xyz"])),
    ).toEqual(["", "xyz"]);
  });
});

describe("Hyperliquid exchange response boundaries", () => {
  test("returns every nested per-order error", () => {
    expect(
      __test.orderStatusError({
        response: {
          data: {
            statuses: [
              { resting: { oid: 1 } },
              { error: "Insufficient margin" },
              { error: "Price outside allowed range" },
            ],
          },
        },
      }),
    ).toBe("Insufficient margin; Price outside allowed range");
  });

  test("accepts a non-error status and rejects malformed status payloads", () => {
    expect(
      __test.orderStatusError({
        response: { data: { statuses: [{ filled: { oid: 1 } }] } },
      }),
    ).toBeNull();
    expect(__test.orderStatusError({ response: { data: {} } })).toBe(
      "Hyperliquid did not return an order status.",
    );
    expect(__test.orderStatusError(null)).toBe(
      "Hyperliquid returned an invalid order response.",
    );
  });
});

describe("Hyperliquid account activity normalization", () => {
  test("converts cumulative funding payments into account cash flow", () => {
    expect(__test.normalizeCumulativeFunding("-2404.80")).toBe(2404.8);
    expect(__test.normalizeCumulativeFunding("-0.39")).toBe(0.39);
    expect(__test.normalizeCumulativeFunding("0.14")).toBe(-0.14);
    expect(__test.normalizeCumulativeFunding("0")).toBe(0);
  });

  test("normalizes fills into the trade-history display model", () => {
    const fill = __test.normalizeTradeFill(
      {
        coin: "HYPE",
        px: "83.25",
        sz: "3",
        side: "B",
        time: 1_800_000_000_000,
        dir: "Open Long",
        fee: "0.12",
        feeToken: "USDC",
        closedPnl: "-4.5",
        oid: 42,
      } as unknown as Parameters<typeof __test.normalizeTradeFill>[0],
      null,
    );

    expect(fill).toEqual({
      time: 1_800_000_000_000,
      symbol: "HYPE",
      direction: "Open Long",
      side: "buy",
      price: 83.25,
      size: 3,
      tradeValue: 249.75,
      fee: 0.12,
      feeToken: "USDC",
      closedPnl: -4.5,
      orderId: 42,
    });
  });

  test("preserves funding side, payment, and rate", () => {
    const funding = __test.normalizeFundingPayment(
      {
        time: 1_800_000_000_000,
        delta: {
          coin: "ETH",
          szi: "-2.5",
          usdc: "1.75",
          fundingRate: "0.0001",
        },
      } as unknown as Parameters<typeof __test.normalizeFundingPayment>[0],
      null,
    );

    expect(funding).toEqual({
      time: 1_800_000_000_000,
      symbol: "ETH",
      size: 2.5,
      side: "short",
      payment: 1.75,
      rate: 0.0001,
    });
  });

  test("derives filled size and trigger metadata for order history", () => {
    const order = __test.normalizeHistoricalOrder(
      {
        status: "filled",
        statusTimestamp: 1_800_000_000_100,
        order: {
          coin: "BTC",
          side: "A",
          orderType: "Stop Market",
          origSz: "1.5",
          sz: "0.25",
          limitPx: "70000",
          timestamp: 1_800_000_000_000,
          oid: 77,
          reduceOnly: true,
          isTrigger: true,
          triggerCondition: "Mark below",
          triggerPx: "69000",
          isPositionTpsl: true,
        },
      } as unknown as Parameters<typeof __test.normalizeHistoricalOrder>[0],
      null,
    );

    expect(order.filledSize).toBe(1.25);
    expect(order.orderValue).toBe(105000);
    expect(order.triggerCondition).toBe("Mark below @ 69000");
    expect(order.tpsl).toBe("Stop Market");
  });

  test("keeps only active TWAP orders", () => {
    const base = {
      time: 1_800_000_000,
      twapId: 9,
      state: {
        coin: "HYPE",
        side: "B",
        sz: "10",
        executedSz: "4",
        executedNtl: "332",
        minutes: 60,
        trigger: null,
        stopPx: null,
        reduceOnly: false,
        timestamp: 1_800_000_000_000,
      },
    };
    const active = __test.normalizeTwapOrder(
      {
        ...base,
        status: { status: "activated" },
      } as unknown as Parameters<typeof __test.normalizeTwapOrder>[0],
      null,
    );
    const finished = __test.normalizeTwapOrder(
      {
        ...base,
        status: { status: "finished" },
      } as unknown as Parameters<typeof __test.normalizeTwapOrder>[0],
      null,
    );

    expect(active?.averagePrice).toBe(83);
    expect(active?.executedSize).toBe(4);
    expect(finished).toBeNull();
  });

  test("normalizes portfolio history and the latest fourteen volume days", () => {
    const snapshots = __test.normalizePortfolioSnapshots([
      [
        "day",
        {
          accountValueHistory: [[1_800_000_000_000, "1250.50"]],
          pnlHistory: [[1_800_000_000_000, "-12.25"]],
          vlm: "9500",
        },
      ],
    ] as unknown as Parameters<typeof __test.normalizePortfolioSnapshots>[0]);
    const fees = __test.normalizeFeeSummary({
      dailyUserVlm: Array.from({ length: 15 }, (_, index) => ({
        date: `2026-08-${String(index + 1).padStart(2, "0")}`,
        userCross: "1",
        userAdd: "1",
        exchange: "100",
      })),
      userCrossRate: "0.000432",
      userAddRate: "0.000144",
      userSpotCrossRate: "0.0007",
      userSpotAddRate: "0.0004",
    } as unknown as Parameters<typeof __test.normalizeFeeSummary>[0]);

    expect(snapshots.day?.accountValueHistory[0].value).toBe(1250.5);
    expect(snapshots.day?.pnlHistory[0].value).toBe(-12.25);
    expect(snapshots.day?.volume).toBe(9500);
    expect(fees.volume14d).toBe(28);
    expect(fees.perpTakerRate).toBe(0.000432);
    expect(fees.perpMakerRate).toBe(0.000144);
  });

  test("normalizes interest and confirmed account ledger transfers", () => {
    const user = "0x1111111111111111111111111111111111111111";
    const interest = __test.normalizeInterestPayment({
      time: 1_800_000_000_000,
      token: "USDC",
      borrow: "0.25",
      supply: "1.75",
    } as Parameters<typeof __test.normalizeInterestPayment>[0]);
    const deposit = __test.normalizeAccountTransfer(
      {
        time: 1_800_000_000_000,
        delta: { type: "deposit", usdc: "100" },
      } as Parameters<typeof __test.normalizeAccountTransfer>[0],
      user,
    );
    const withdrawal = __test.normalizeAccountTransfer(
      {
        time: 1_800_000_000_100,
        delta: { type: "withdraw", usdc: "20", fee: "1", nonce: 1 },
      } as Parameters<typeof __test.normalizeAccountTransfer>[0],
      user,
    );

    expect(interest).toEqual({
      time: 1_800_000_000_000,
      asset: "USDC",
      paid: 0.25,
      earned: 1.75,
    });
    expect(deposit).toMatchObject({
      status: "Complete",
      action: "Deposit",
      amount: 100,
    });
    expect(withdrawal).toMatchObject({
      status: "Complete",
      action: "Withdraw",
      amount: -20,
      fee: 1,
    });
  });
});

describe("Hyperliquid execution capability boundary", () => {
  test("keeps the signing surface on an explicit trade-only allowlist", async () => {
    const source = await Bun.file(
      new URL("./hyperliquidExecution.ts", import.meta.url),
    ).text();

    expect(source).not.toContain("ExchangeClient");
    expect(source).not.toContain("agentSendAsset");
    expect(source).not.toContain("withdraw3");
    expect(source).not.toMatch(/(?:localStorage|sessionStorage).*privateKey/i);
    expect(source).not.toContain("SymbolConverter.create({ transport, dexs: true })");
    expect(source).not.toContain("activePerpDexs.map(async (dex)");
    expect(source).toContain('import("../lib/hyperliquidExecutionSdk")');

    const vaultSource = await Bun.file(
      new URL("./apiWalletVault.ts", import.meta.url),
    ).text();
    expect(vaultSource).not.toContain('from "viem/accounts"');
  });

  test("keeps the live portfolio-margin panel native and complete", async () => {
    const source = await Bun.file(
      new URL("../components/OrderForm.tsx", import.meta.url),
    ).text();

    expect(source).not.toContain("Manage funds on Hyperliquid");
    expect(source).toContain("Portfolio Value");
    expect(source).toContain("Borrow Cap Used");
    expect(source).toContain("Perps Maintenance Margin");
    expect(source).toContain("Portfolio Account Leverage");

    const balancesSource = await Bun.file(
      new URL("../components/BalancesPanel.tsx", import.meta.url),
    ).text();
    expect(balancesSource).toContain("getSpotBorrowedBalance");
    expect(balancesSource).toContain("spotUsdcIsBorrowed");
    expect(balancesSource).toContain("formatAmountWithUnit(spotUsdcBorrowed()");
  });
});
