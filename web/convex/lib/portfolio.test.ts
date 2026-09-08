import { describe, expect, test } from "bun:test";
import { getCollateralWeight, getCollateralWeightBps } from "./portfolio";

describe("paper portfolio collateral weights", () => {
  test("models HYPE with a 65 percent paper collateral weight", () => {
    expect(getCollateralWeight("HYPE")).toBe(0.65);
    expect(getCollateralWeightBps("HYPE")).toBe(6_500n);
  });

  test("fails closed for unsupported collateral", () => {
    expect(getCollateralWeight("UNKNOWN")).toBe(0);
  });
});
