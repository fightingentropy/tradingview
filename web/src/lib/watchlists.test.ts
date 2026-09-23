import { expect, test } from "bun:test";
import { restoreWatchlists, syncWatchlistThemes, themeForMarket } from "./watchlists";

test("existing lists and selection survive the themed-list upgrade", () => {
  const saved = { activeId: "Personal", lists: { Personal: ["BTC", "xyz:NVDA"], crypto: ["HYPE"], watchlist: ["ZEC"] } };
  const state = restoreWatchlists(saved);
  expect(state.activeId).toBe("Personal");
  expect(state.lists.Personal).toEqual(saved.lists.Personal);
  expect(state.lists.watchlist).toEqual(["ZEC"]);
  expect(state.lists.crypto).toEqual(["HYPE"]);
  expect(state.lists.rates).toEqual(["para:10Y", "xyz:TLT"]);
});

test("new listings join themes once without restoring removed symbols on reload", () => {
  const initial = restoreWatchlists(null);
  const catalog = [{ symbol: "xyz:GOLD", type: "equities" }, { symbol: "xyz:PALLADIUM", type: "equities" }];
  const synced = syncWatchlistThemes(initial, catalog);
  expect(synced.lists.commodities).toContain("xyz:PALLADIUM");
  const edited = { ...synced, activeId: "commodities", lists: { ...synced.lists, commodities: ["xyz:PALLADIUM"] } };
  const reloaded = restoreWatchlists(JSON.parse(JSON.stringify(edited)));
  expect(syncWatchlistThemes(reloaded, catalog)).toBe(reloaded);
  expect(reloaded.lists.commodities).toEqual(["xyz:PALLADIUM"]);
  expect(reloaded.activeId).toBe("commodities");
});

test("existing index lists receive newer indices while previously removed defaults stay removed", () => {
  const state = restoreWatchlists({ activeId: "indices", lists: { indices: [], crypto: ["HYPE"] } });
  const next = syncWatchlistThemes(state, ["xyz:XYZ100", "xyz:SP500", "xyz:JP225", "BTC", "ETH", "SOL"].map(symbol => ({ symbol, type: "perps" })));
  expect(next.lists.indices).toEqual(["xyz:JP225", "xyz:SP500"]);
  expect(next.lists.crypto).toEqual(["HYPE", "SOL"]);
});

test("theme classification matches native indices, rates, currencies and ETFs", () => {
  for (const [symbol, expected] of [["xyz:SP500", "indices"], ["para:10Y", "rates"], ["xyz:TLT", "rates"], ["xyz:EUR", "forex"], ["xyz:SMH", "etfs"], ["xyz:KIOXIA", "stocks"], ["xyz:CL", "commodities"], ["HYPE", "crypto"]]) {
    expect(themeForMarket({ symbol, type: "perps" })).toBe(expected);
  }
  expect(themeForMarket({ symbol: "BTC", type: "spot" })).toBeNull();
});

test("malformed storage recovers safely and legacy main watchlists are retained", () => {
  expect(restoreWatchlists({ lists: { custom: null }, activeId: "custom" }).activeId).toBe("watchlist");
  expect(restoreWatchlists(null, ["BTC", "BTC", 17, "", "ETH"]).lists.watchlist).toEqual(["BTC", "ETH"]);
});
