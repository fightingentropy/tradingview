import { describe, expect, test } from "bun:test";
import {
  mapHyperliquidMidsToMarkets,
  parseHyperliquidMids,
} from "./hyperliquidMids";

describe("Hyperliquid all-mids mapping", () => {
  test("rejects invalid prices without rejecting the whole update", () => {
    expect(
      parseHyperliquidMids({ BTC: "78250.5", ETH: "bad", HYPE: -1 }),
    ).toEqual({ BTC: 78250.5 });
  });

  test("maps core perps and spot pair ids from the default dex", () => {
    const updates = mapHyperliquidMidsToMarkets({
      dex: "",
      markets: [
        { symbol: "BTC", type: "perps" },
        { symbol: "HYPE", type: "spot" },
        { symbol: "xyz:GOLD", type: "equities" },
      ],
      mids: { BTC: 78250.5, "@107": 47.25, "xyz:GOLD": 2500 },
      spotMidKeyBySymbol: new Map([["HYPE", "@107"]]),
    });

    expect([...updates.entries()]).toEqual([
      ["BTC", 78250.5],
      ["HYPE", 47.25],
    ]);
  });

  test("maps a named perp dex without leaking values into core markets", () => {
    const updates = mapHyperliquidMidsToMarkets({
      dex: "xyz",
      markets: [
        { symbol: "BTC", type: "perps" },
        { symbol: "xyz:GOLD", type: "equities" },
      ],
      mids: { BTC: 1, "xyz:GOLD": 2500 },
      spotMidKeyBySymbol: new Map(),
    });

    expect([...updates.entries()]).toEqual([["xyz:GOLD", 2500]]);
  });
});
