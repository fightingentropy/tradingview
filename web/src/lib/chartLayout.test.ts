import { expect, test } from "bun:test";
import { restoreChartLayout, withChartCount, withChartSymbol, withoutChart } from "./chartLayout";
import { normalizeSymbol } from "./format";
import { resolveHyperliquidMarketCoin } from "./hyperliquid";

test("one-chart layout preserves hidden panes and the saved resolution", () => {
  const grid = restoreChartLayout({ count: 4, symbols: ["BTC", "ZEC", "ETH", "HYPE"], resolution: "60", activeIndex: 3 });
  const single = withChartCount(grid, 1);
  expect(single.activeIndex).toBe(0);
  expect(single.symbols.slice(0, 4)).toEqual(grid.symbols.slice(0, 4));
  const reopened = restoreChartLayout(JSON.parse(JSON.stringify(single)));
  expect(reopened.count).toBe(1);
  expect(reopened.resolution).toBe("60");
  expect(withChartCount(reopened, 4).symbols).toEqual(grid.symbols);
});

test("watchlist selections replace only the active pane and preserve venue identity", async () => {
  const state = restoreChartLayout({ count: 4, symbols: ["BTC", "ZEC", "ETH", "HYPE"], activeIndex: 2 });
  const next = withChartSymbol(state, "para:10Y");
  expect(next.symbols.slice(0, 4)).toEqual(["BTC", "ZEC", "para:10Y", "HYPE"]);
  expect(normalizeSymbol("PARA:10y")).toBe("para:10Y");
  expect(normalizeSymbol("kBONK")).toBe("kBONK");
  expect(await resolveHyperliquidMarketCoin({ symbol: "kBONK", marketType: "perps" })).toBe("kBONK");
  expect(await resolveHyperliquidMarketCoin({ symbol: "para:10Y", marketType: "equities" })).toBe("para:10Y");
  expect(withChartSymbol(state, "xyz:TLT", 5)).toBe(state);
});

test("invalid saved layout values are bounded", () => {
  expect(restoreChartLayout({ count: 9 as never, activeIndex: 99 }).count).toBe(4);
  expect(restoreChartLayout({ count: 1, activeIndex: 99 }).activeIndex).toBe(0);
  expect(restoreChartLayout(null).symbols).toHaveLength(6);
});

test("the one-minute interval survives layout changes and reloads", () => {
  const single = withChartCount(restoreChartLayout({ resolution: "1" }), 1);
  expect(restoreChartLayout(JSON.parse(JSON.stringify(single))).resolution).toBe("1");
  expect(restoreChartLayout({ resolution: "invalid" as never }).resolution).toBe("5");
});

test("removing a chart preserves the remaining order and selected market after refresh", () => {
  const grid = restoreChartLayout({ count: 4, symbols: ["BTC", "para:10Y", "ETH", "xyz:SP500", "HYPE", "ZEC"], activeIndex: 2, resolution: "15" });
  const next = withoutChart(grid, 1);
  expect(next.count).toBe(3);
  expect(next.symbols.slice(0, next.count)).toEqual(["BTC", "ETH", "xyz:SP500"]);
  expect(next.symbols.slice(next.count)).toEqual(["HYPE", "ZEC", "para:10Y"]);
  expect(next.activeIndex).toBe(1);
  expect(next.symbols[next.activeIndex]).toBe("ETH");
  expect(restoreChartLayout(JSON.parse(JSON.stringify(next)))).toEqual(next);
});

test("removing the selected chart selects its neighbour and never removes the final chart", () => {
  let grid = restoreChartLayout({ count: 6, activeIndex: 5 });
  grid = withoutChart(grid, 5);
  expect(grid.count).toBe(5);
  expect(grid.activeIndex).toBe(4);
  expect(restoreChartLayout(JSON.parse(JSON.stringify(grid)))).toEqual(grid);
  grid = withoutChart(grid, 4);
  grid = withoutChart(grid, 3);
  grid = withoutChart(grid, 2);
  grid = withoutChart(grid, 1);
  expect(grid.count).toBe(1);
  expect(grid.activeIndex).toBe(0);
  expect(withoutChart(grid, 0)).toBe(grid);
  const middle = withoutChart(restoreChartLayout({ count: 4, activeIndex: 1 }), 1);
  expect(middle.activeIndex).toBe(1);
  expect(middle.symbols[middle.activeIndex]).toBe("ETH");
});

test("invalid removal and count changes leave the layout intact", () => {
  const grid = restoreChartLayout({ count: 3 });
  for (const index of [-1, 3, 1.5, NaN]) expect(withoutChart(grid, index)).toBe(grid);
  for (const count of [0, 7, 2.5]) expect(withChartCount(grid, count as never)).toBe(grid);
  expect(withoutChart(grid, 2).activeIndex).toBe(0);
});
