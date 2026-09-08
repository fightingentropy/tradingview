import { describe, expect, test } from "bun:test";
import {
  ACCOUNT_TABS,
  annualizeHourlyFundingRate,
  accountSideOptions,
  accountTabHasMarketFilter,
  accountTabHasSideFilter,
  formatAccountMarket,
  formatAnnualizedFundingRate,
} from "./accountDock";

describe("account dock structure", () => {
  test("keeps the Hyperliquid account tabs in the expected order", () => {
    expect(ACCOUNT_TABS.map((tab) => tab.label)).toEqual([
      "Balances",
      "Positions",
      "Open Orders",
      "TWAP",
      "Chase",
      "Trade History",
      "Funding History",
      "Order History",
    ]);
  });

  test("uses position-side filters for positions and funding", () => {
    expect(accountSideOptions("positions").map((option) => option.value)).toEqual([
      "all",
      "long",
      "short",
    ]);
    expect(
      accountSideOptions("fundingHistory").map((option) => option.value),
    ).toEqual(["all", "long", "short"]);
    expect(accountSideOptions("openOrders").map((option) => option.value)).toEqual([
      "all",
      "buy",
      "sell",
    ]);
  });

  test("shows only filters that apply to each table", () => {
    expect(accountTabHasSideFilter("balances")).toBe(false);
    expect(accountTabHasMarketFilter("balances")).toBe(false);
    expect(accountTabHasSideFilter("chase")).toBe(false);
    expect(accountTabHasMarketFilter("chase")).toBe(true);
  });

  test("removes builder DEX prefixes from display markets", () => {
    expect(formatAccountMarket("xyz:ALUMINIUM")).toBe("ALUMINIUM");
    expect(formatAccountMarket("HYPE")).toBe("HYPE");
  });

  test("annualizes Hyperliquid's hourly funding rate", () => {
    expect(annualizeHourlyFundingRate(0.000013)).toBeCloseTo(0.11388);
    expect(formatAnnualizedFundingRate(0.000013)).toBe("11.39%");
    expect(formatAnnualizedFundingRate(-0.000001)).toBe("-0.8760%");
  });
});
