import { afterEach, describe, expect, test } from "bun:test";
import {
  hyperliquidAppUrl,
  hyperliquidInfoUrl,
  hyperliquidWsUrl,
  setHyperliquidDataNetwork,
} from "./hyperliquidNetwork";

afterEach(() => setHyperliquidDataNetwork("mainnet"));

describe("Hyperliquid selected-network endpoints", () => {
  test("keeps REST and WebSocket data on mainnet together", () => {
    setHyperliquidDataNetwork("mainnet");
    expect(hyperliquidInfoUrl()).toBe("https://api.hyperliquid.xyz/info");
    expect(hyperliquidWsUrl()).toBe("wss://api.hyperliquid.xyz/ws");
  });

  test("keeps REST and WebSocket data on testnet together", () => {
    setHyperliquidDataNetwork("testnet");
    expect(hyperliquidInfoUrl()).toBe(
      "https://api.hyperliquid-testnet.xyz/info",
    );
    expect(hyperliquidWsUrl()).toBe(
      "wss://api.hyperliquid-testnet.xyz/ws",
    );
  });

  test("routes account-management pages to the selected account network", () => {
    expect(hyperliquidAppUrl("mainnet", "portfolio")).toBe(
      "https://app.hyperliquid.xyz/portfolio",
    );
    expect(hyperliquidAppUrl("testnet", "settings")).toBe(
      "https://app.hyperliquid-testnet.xyz/settings",
    );
  });
});
