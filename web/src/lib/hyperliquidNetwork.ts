import { createRoot, createSignal } from "solid-js";

export type HyperliquidDataNetwork = "mainnet" | "testnet";

const [hyperliquidDataNetwork, setHyperliquidDataNetwork] = createRoot(() =>
  createSignal<HyperliquidDataNetwork>("mainnet"),
);

export const hyperliquidHttpUrl = () =>
  hyperliquidDataNetwork() === "testnet"
    ? "https://api.hyperliquid-testnet.xyz"
    : "https://api.hyperliquid.xyz";

export const hyperliquidInfoUrl = () => `${hyperliquidHttpUrl()}/info`;

export const hyperliquidWsUrl = () =>
  hyperliquidDataNetwork() === "testnet"
    ? "wss://api.hyperliquid-testnet.xyz/ws"
    : "wss://api.hyperliquid.xyz/ws";

export const hyperliquidAppUrl = (
  network: HyperliquidDataNetwork,
  path: "portfolio" | "settings",
) =>
  `${
    network === "testnet"
      ? "https://app.hyperliquid-testnet.xyz"
      : "https://app.hyperliquid.xyz"
  }/${path}`;

export { hyperliquidDataNetwork, setHyperliquidDataNetwork };
