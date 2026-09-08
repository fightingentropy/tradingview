import { describe, expect, test } from "bun:test";
import {
  normalizeHyperliquidSpotUiSymbol,
  parseMetaAndAssetCtxsResponse,
  parseSpotMetaAndAssetCtxsResponse,
  resolveHyperliquidSpotPairId,
} from "./hyperliquid";

const perpContext = {
  funding: "0.0001",
  openInterest: "100",
  prevDayPx: "67000",
  dayNtlVlm: "1000000",
  oraclePx: "68000",
  markPx: "68001",
};

describe("Hyperliquid client response validation", () => {
  test("accepts matching, bounded metadata and contexts", () => {
    const result = parseMetaAndAssetCtxsResponse([
      { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 50 }] },
      [perpContext],
    ]);
    expect(result?.universe[0]?.name).toBe("BTC");
  });

  test("rejects mismatches, duplicate assets and unbounded leverage", () => {
    expect(
      parseMetaAndAssetCtxsResponse([
        { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 50 }] },
        [],
      ]),
    ).toBeNull();
    expect(
      parseMetaAndAssetCtxsResponse([
        {
          universe: [
            { name: "BTC", szDecimals: 5, maxLeverage: 50 },
            { name: "btc", szDecimals: 5, maxLeverage: 50 },
          ],
        },
        [perpContext, perpContext],
      ]),
    ).toBeNull();
    expect(
      parseMetaAndAssetCtxsResponse([
        { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 1_000_000 }] },
        [perpContext],
      ]),
    ).toBeNull();
  });

  test("rejects malformed decimals and unknown spot token indexes", () => {
    expect(
      parseMetaAndAssetCtxsResponse([
        { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 50 }] },
        [{ ...perpContext, markPx: "Infinity" }],
      ]),
    ).toBeNull();
    expect(
      parseMetaAndAssetCtxsResponse([
        { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 50 }] },
        [{ ...perpContext, markPx: "0" }],
      ]),
    ).toBeNull();
    expect(
      parseSpotMetaAndAssetCtxsResponse([
        {
          tokens: [{ name: "BTC", szDecimals: 5, index: 0 }],
          universe: [{ name: "BTC/USDC", tokens: [0, 999], index: 0 }],
        },
        [
          {
            dayNtlVlm: "1",
            markPx: "1",
            midPx: "1",
            prevDayPx: "1",
          },
        ],
      ]),
    ).toBeNull();
    expect(
      parseSpotMetaAndAssetCtxsResponse([
        {
          tokens: [
            { name: "BTC", szDecimals: 5, index: 0 },
            { name: "USDC", szDecimals: 6, index: 1 },
          ],
          universe: [
            { name: "BTC/USDC", tokens: [0, 1], index: 0 },
            { name: "btc/usdc", tokens: [0, 1], index: 1 },
          ],
        },
        [
          { dayNtlVlm: "1", markPx: "1", midPx: "1", prevDayPx: "1" },
          { dayNtlVlm: "1", markPx: "1", midPx: "1", prevDayPx: "1" },
        ],
      ]),
    ).toBeNull();
  });

  test("aligns spot contexts by response order instead of market id", () => {
    const result = parseSpotMetaAndAssetCtxsResponse([
      {
        tokens: [
          { name: "BTC", szDecimals: 5, index: 0 },
          { name: "USDC", szDecimals: 6, index: 1 },
          { name: "USDT", szDecimals: 6, index: 2 },
        ],
        universe: [
          { name: "BTC/USDT", tokens: [0, 2], index: 7 },
          { name: "BTC/USDC", tokens: [0, 1], index: 12 },
        ],
      },
      [
        { dayNtlVlm: "1", markPx: "2", midPx: "2", prevDayPx: "2" },
        { dayNtlVlm: "3", markPx: "4", midPx: "4", prevDayPx: "4" },
      ],
    ]);

    expect(result?.meta.universe[0]?.name).toBe("BTC/USDC");
    expect(result?.ctx[0]?.markPx).toBe("4");
  });

  test("aligns current sparse spot metadata with dense pair-index contexts", () => {
    const result = parseSpotMetaAndAssetCtxsResponse([
      {
        tokens: [
          { name: "BTC", szDecimals: 5, index: 0 },
          { name: "ETH", szDecimals: 4, index: 1 },
          { name: "USDC", szDecimals: 6, index: 2 },
        ],
        universe: [
          { name: "BTC/USDC", tokens: [0, 2], index: 0 },
          { name: "ETH/USDC", tokens: [1, 2], index: 2 },
        ],
      },
      [
        { dayNtlVlm: "1", markPx: "1", midPx: "1", prevDayPx: "1" },
        { dayNtlVlm: "2", markPx: "2", midPx: "2", prevDayPx: "2" },
        { dayNtlVlm: "3", markPx: "3", midPx: "3", prevDayPx: "3" },
      ],
    ]);

    expect(result?.meta.universe.map((pair) => pair.index)).toEqual([0, 2]);
    expect(result?.ctx.map((context) => context.markPx)).toEqual(["1", "3"]);
  });

  test("resolves UI and canonical spot aliases to verified pair ids", () => {
    const spotData = parseSpotMetaAndAssetCtxsResponse([
      {
        tokens: [
          { name: "UBTC", szDecimals: 5, index: 10 },
          { name: "UETH", szDecimals: 4, index: 11 },
          { name: "USOL", szDecimals: 2, index: 12 },
          { name: "USDC", szDecimals: 6, index: 0 },
        ],
        universe: [
          { name: "UBTC/USDC", tokens: [10, 0], index: 107 },
          { name: "UETH/USDC", tokens: [11, 0], index: 108 },
          { name: "USOL/USDC", tokens: [12, 0], index: 109 },
        ],
      },
      [
        { dayNtlVlm: "1", markPx: "1", midPx: "1", prevDayPx: "1" },
        { dayNtlVlm: "1", markPx: "1", midPx: "1", prevDayPx: "1" },
        { dayNtlVlm: "1", markPx: "1", midPx: "1", prevDayPx: "1" },
      ],
    ]);

    expect(spotData).not.toBeNull();
    expect(normalizeHyperliquidSpotUiSymbol("UBTC/USDC")).toBe("BTC");
    expect(normalizeHyperliquidSpotUiSymbol("UETH-USDC")).toBe("ETH");
    expect(resolveHyperliquidSpotPairId("BTC", spotData!)).toBe("@107");
    expect(resolveHyperliquidSpotPairId("UETH", spotData!)).toBe("@108");
    expect(resolveHyperliquidSpotPairId("USOL/USDC", spotData!)).toBe(
      "@109",
    );
    expect(resolveHyperliquidSpotPairId("@107", spotData!)).toBe("@107");
    expect(resolveHyperliquidSpotPairId("@999", spotData!)).toBeNull();
  });

  test("fails closed when two spot pairs collapse to the same UI alias", () => {
    const ambiguous = parseSpotMetaAndAssetCtxsResponse([
      {
        tokens: [
          { name: "BTC", szDecimals: 5, index: 1 },
          { name: "UBTC", szDecimals: 5, index: 2 },
          { name: "USDC", szDecimals: 6, index: 0 },
        ],
        universe: [
          { name: "BTC/USDC", tokens: [1, 0], index: 20 },
          { name: "UBTC/USDC", tokens: [2, 0], index: 21 },
        ],
      },
      [
        { dayNtlVlm: "1", markPx: "1", midPx: "1", prevDayPx: "1" },
        { dayNtlVlm: "1", markPx: "1", midPx: "1", prevDayPx: "1" },
      ],
    ]);

    expect(ambiguous).not.toBeNull();
    expect(resolveHyperliquidSpotPairId("BTC", ambiguous!)).toBeNull();
  });
});
