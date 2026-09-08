import { describe, expect, test } from "bun:test";
import {
  isFreshTimestamp,
  parseHyperliquidPerpPayload,
  parseHyperliquidSpotPayload,
} from "./oracle";

describe("oracle boundary validation", () => {
  test("accepts a complete bounded perps response", () => {
    expect(
      parseHyperliquidPerpPayload(
        [
          { universe: [{ name: "BTC" }] },
          [{ markPx: "68000.123456789", midPx: "68000", funding: "0.0001" }],
        ],
        123,
      ),
    ).toEqual([
      {
        symbol: "BTC",
        markPx: 68000.12345679,
        markPxExact: "68000.12345679",
        midPx: 68000,
        midPxExact: "68000",
        funding: 0.0001,
        fundingExact: "0.0001",
        source: "hyperliquid",
        updatedAt: 123,
      },
    ]);
    expect(
      parseHyperliquidPerpPayload(
        [{ universe: [{ name: "ETH" }] }, [{ markPx: "3000", funding: "0" }]],
        124,
      ),
    ).toEqual([
      {
        symbol: "ETH",
        markPx: 3000,
        markPxExact: "3000",
        funding: 0,
        fundingExact: "0",
        source: "hyperliquid",
        updatedAt: 124,
      },
    ]);
  });

  test("fails closed on length mismatches, duplicates and invalid decimals", () => {
    expect(
      parseHyperliquidPerpPayload(
        [{ universe: [{ name: "BTC" }, { name: "ETH" }] }, [{ markPx: "1" }]],
        123,
      ),
    ).toEqual([]);
    expect(
      parseHyperliquidPerpPayload(
        [
          { universe: [{ name: "BTC" }, { name: "btc" }] },
          [{ markPx: "1" }, { markPx: "2" }],
        ],
        123,
      ),
    ).toEqual([]);
    expect(
      parseHyperliquidPerpPayload(
        [{ universe: [{ name: "BTC" }] }, [{ markPx: "Infinity" }]],
        123,
      ),
    ).toEqual([]);
  });

  test("requires valid spot token indexes and pair shapes", () => {
    expect(
      parseHyperliquidSpotPayload(
        [
          {
            tokens: [
              { name: "BTC", index: 0 },
              { name: "USDC", index: 1 },
            ],
            universe: [{ tokens: [0, 1], index: 0 }],
          },
          [{ markPx: "68000" }],
        ],
        456,
      ),
    ).toHaveLength(1);
    expect(
      parseHyperliquidSpotPayload(
        [
          {
            tokens: [{ name: "BTC", index: 0 }],
            universe: [{ tokens: [0, 999], index: 0 }],
          },
          [{ markPx: "68000" }],
        ],
        456,
      ),
    ).toEqual([]);
    expect(
      parseHyperliquidSpotPayload(
        [
          {
            tokens: [{ name: "BTC", index: -1 }],
            universe: [{ tokens: [-1, -1], index: 0 }],
          },
          [{ markPx: "68000" }],
        ],
        456,
      ),
    ).toEqual([]);
    expect(
      parseHyperliquidSpotPayload(
        [
          {
            tokens: [
              { name: "BTC", index: 0 },
              { name: "ETH", index: 1 },
            ],
            universe: [{ tokens: [0, 1], index: 0 }],
          },
          [{ markPx: "20" }],
        ],
        456,
      ),
    ).toEqual([]);
  });

  test("stale and future timestamps fail closed at the exact boundary", () => {
    expect(isFreshTimestamp(1_000, 1_100, 100)).toBe(true);
    expect(isFreshTimestamp(999, 1_100, 100)).toBe(false);
    expect(isFreshTimestamp(1_101, 1_100, 100)).toBe(false);
    expect(
      parseHyperliquidPerpPayload(
        [{ universe: [{ name: "BTC" }] }, [{ markPx: "1" }]],
        Number.NaN,
      ),
    ).toEqual([]);
  });
});
