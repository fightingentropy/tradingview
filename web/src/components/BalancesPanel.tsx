import { Component, For, Show, createMemo } from "solid-js";
import "./AccountTables.css";
import { hyperliquidAppUrl } from "../lib/hyperliquidNetwork";
import {
  getAvailableBalance,
  getBalance,
  getMarkPriceForSymbol,
} from "../stores/clob";
import { MARKETS, selectMarket, type Market } from "../stores/market";
import { setCurrentPage } from "../stores/page";
import {
  SpotAsset,
  getSpotBalance,
  getSpotBalances,
  getSpotBorrowedBalance,
  getSpotCollateralLtv,
  getSpotTotalBalance,
  isSpotAsset,
  openTransferModal,
} from "../stores/wallet";
import {
  hyperliquidAccountMode,
  hyperliquidConnection,
  isHyperliquidExecution,
} from "../stores/hyperliquidExecution";

const baseColumns = [
  "Asset",
  "Total Balance",
  "Available Balance",
  "USDC Value",
  "PNL (ROE %)",
  "Actions",
  "Contract",
];

const numericColumns = new Set([
  "LTV",
  "Net Balance",
  "Total Balance",
  "Available Balance",
  "USDC Value",
  "PNL (ROE %)",
]);

const formatUsd = (value: number) => {
  if (!Number.isFinite(value)) return "--";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatAmount = (value: number, decimals: number) => {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const formatAmountWithUnit = (
  value: number,
  decimals: number,
  unit: string,
) => {
  const formatted = formatAmount(value, decimals);
  return formatted === "--" ? formatted : `${formatted} ${unit}`;
};

const spotAssets: {
  symbol: SpotAsset;
  accent: string;
  contract?: string;
}[] = [
  {
    symbol: "HYPE",
    accent: "text-brand-slate-100",
    contract: "0x0d01...11ec",
  },
  {
    symbol: "BTC",
    accent: "text-brand-slate-100",
  },
];

const BalancesPanel: Component<{
  compact?: boolean;
}> = (props) => {
  const perpsTotal = createMemo(() => getBalance("USDC"));
  const perpsAvailable = createMemo(() => getAvailableBalance("USDC"));
  const spotUsdcBalance = createMemo(() => getSpotTotalBalance("USDC"));
  const spotUsdcAvailable = createMemo(() => getSpotBalance("USDC"));
  const spotUsdcBorrowed = createMemo(() => getSpotBorrowedBalance("USDC"));
  const spotUsdcIsBorrowed = createMemo(() => spotUsdcBorrowed() > 0);
  const spotUsdcContext = createMemo(() => {
    if (spotUsdcIsBorrowed()) return "Borrowed";
    return isHyperliquidExecution() &&
      (hyperliquidAccountMode() === "unifiedAccount" ||
        hyperliquidAccountMode() === "portfolioMargin")
      ? "Shared collateral"
      : "Spot";
  });
  const showLtvColumn = createMemo(
    () =>
      isHyperliquidExecution() &&
      hyperliquidAccountMode() === "portfolioMargin",
  );
  const columns = createMemo(() => [
    baseColumns[0],
    ...(showLtvColumn() ? ["LTV"] : []),
    showLtvColumn() ? "Net Balance" : baseColumns[1],
    ...baseColumns.slice(2),
  ]);
  const visibleSpotAssets = createMemo(() =>
    isHyperliquidExecution()
        ? Object.keys(getSpotBalances())
            .filter(
              (symbol): symbol is SpotAsset =>
                symbol !== "USDC" &&
                isSpotAsset(symbol) &&
                getSpotTotalBalance(symbol) > 0,
            )
            .map((symbol) => ({
              symbol,
              accent: "text-brand-slate-100",
              contract: undefined,
            }))
        : spotAssets.filter((asset) => getSpotBalance(asset.symbol) > 0),
  );

  const goToTrade = (symbol: string, type: Market["type"]) => {
    const market =
      MARKETS().find((item) => item.symbol === symbol && item.type === type) ??
      MARKETS().find((item) => item.symbol === symbol);
    if (market) {
      selectMarket(market);
    }
    setCurrentPage("trade");
  };

  return (
    <div class="space-y-4">
      <div class="overflow-x-auto">
        <table
          class={`account-table ${showLtvColumn() ? "min-w-[1040px]" : "min-w-[980px]"} ${props.compact ? "is-compact" : ""}`}
        >
          <thead>
            <tr>
              <For each={columns()}>
                {(col) => (
                  <th class={numericColumns.has(col) ? "num" : undefined}>
                    {col}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <Show
              when={
                !isHyperliquidExecution() ||
                hyperliquidAccountMode() === "default" ||
                hyperliquidAccountMode() === "disabled"
              }
            >
            <tr>
              <td>
                <div class="flex items-center gap-2">
                  <span class="font-semibold text-brand-slate-100">USDC</span>
                  <span class="text-[12px] text-brand-slate-500">
                    {isHyperliquidExecution() ? "Standard" : "Perps"}
                  </span>
                </div>
              </td>
              <Show when={showLtvColumn()}>
                <td class="num">
                  <span class="text-brand-slate-500">N/A</span>
                </td>
              </Show>
              <td class="num">
                <span class="font-mono">
                  {formatAmountWithUnit(perpsTotal(), 2, "USDC")}
                </span>
              </td>
              <td class="num">
                <span class="font-mono">
                  {formatAmountWithUnit(perpsAvailable(), 2, "USDC")}
                </span>
              </td>
              <td class="num">
                <span class="font-mono">{formatUsd(perpsTotal())}</span>
              </td>
              <td class="num">
                <span class="text-brand-slate-500">--</span>
              </td>
              <td>
                <div class="flex items-center gap-4 whitespace-nowrap">
                  <Show
                    when={!isHyperliquidExecution()}
                    fallback={
                      <a
                        href={hyperliquidAppUrl(
                          hyperliquidConnection()?.network ?? "mainnet",
                          "portfolio",
                        )}
                        target="_blank"
                        rel="noreferrer"
                        class="text-brand-accent hover:underline"
                      >
                        Manage
                      </a>
                    }
                  >
                    <button
                      class="text-brand-accent hover:underline"
                      onClick={() => openTransferModal("perpsToSpot")}
                    >
                      Transfer to Spot
                    </button>
                  </Show>
                </div>
              </td>
              <td>
                <span class="text-brand-slate-500">--</span>
              </td>
            </tr>
            </Show>
            {/* Spot USDC Row */}
            <Show
              when={
                (spotUsdcBalance() !== 0 || spotUsdcIsBorrowed())
              }
            >
              <tr>
                <td>
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-brand-slate-100">USDC</span>
                    <span class="text-[12px] text-brand-slate-500">
                      {spotUsdcContext()}
                    </span>
                  </div>
                </td>
                <Show when={showLtvColumn()}>
                  <td class="num">
                    <span class="text-brand-slate-500">N/A</span>
                  </td>
                </Show>
                <td class="num">
                  <span
                    class={`font-mono ${spotUsdcBalance() < 0 ? "text-brand-red-400" : ""}`}
                  >
                    {formatAmountWithUnit(spotUsdcBalance(), 2, "USDC")}
                  </span>
                  <Show when={spotUsdcIsBorrowed()}>
                    <span class="mt-0.5 block whitespace-nowrap font-mono text-[12px] text-brand-red-400">
                      Borrowed{" "}
                      {formatAmountWithUnit(spotUsdcBorrowed(), 4, "USDC")}
                    </span>
                  </Show>
                </td>
                <td class="num">
                  <span class="font-mono">
                    {formatAmountWithUnit(spotUsdcAvailable(), 2, "USDC")}
                  </span>
                </td>
                <td class="num">
                  <span class="font-mono">{formatUsd(spotUsdcBalance())}</span>
                </td>
                <td class="num">
                  <span class="text-brand-slate-500">--</span>
                </td>
                <td>
                  <div class="flex items-center gap-4 whitespace-nowrap">
                    <Show
                      when={!isHyperliquidExecution()}
                      fallback={
                        <a
                          href={hyperliquidAppUrl(
                            hyperliquidConnection()?.network ?? "mainnet",
                            "portfolio",
                          )}
                          target="_blank"
                          rel="noreferrer"
                          class="text-brand-accent hover:underline"
                        >
                          Manage
                        </a>
                      }
                    >
                      <button
                        class="text-brand-accent hover:underline"
                        onClick={() => openTransferModal("spotToPerps")}
                      >
                        Transfer to Perps
                      </button>
                    </Show>
                  </div>
                </td>
                <td>
                  <span class="text-brand-slate-500">--</span>
                </td>
              </tr>
            </Show>
            <For each={visibleSpotAssets()}>
              {(asset) => {
                const balance = createMemo(() =>
                  getSpotTotalBalance(asset.symbol),
                );
                const available = createMemo(() =>
                  getSpotBalance(asset.symbol),
                );
                const collateralLtv = createMemo(() =>
                  getSpotCollateralLtv(asset.symbol),
                );
                const price = createMemo(() =>
                  getMarkPriceForSymbol(asset.symbol),
                );
                const value = createMemo(() => {
                  const latestPrice =
                    asset.symbol === "USDT" ? 1 : price();
                  const latestBalance = balance();
                  if (!Number.isFinite(latestPrice) || latestPrice <= 0)
                    return 0;
                  return latestBalance * latestPrice;
                });
                const decimals = asset.symbol === "BTC" ? 6 : 4;

                return (
                  <tr>
                    <td>
                      <div class="flex items-center gap-2">
                        <span class={`font-semibold ${asset.accent}`}>
                          {asset.symbol}
                        </span>
                        <span class="text-[12px] text-brand-slate-500">Spot</span>
                      </div>
                    </td>
                    <Show when={showLtvColumn()}>
                      <td class="num">
                        <span class="font-mono text-brand-slate-100">
                          {collateralLtv() === undefined
                            ? "N/A"
                            : `${((collateralLtv() ?? 0) * 100).toFixed(0)}%`}
                        </span>
                      </td>
                    </Show>
                    <td class="num">
                      <span class="font-mono">
                        {formatAmountWithUnit(
                          balance(),
                          decimals,
                          asset.symbol,
                        )}
                      </span>
                    </td>
                    <td class="num">
                      <span class="font-mono">
                        {formatAmountWithUnit(
                          available(),
                          decimals,
                          asset.symbol,
                        )}
                      </span>
                    </td>
                    <td class="num">
                      <span class="font-mono">{formatUsd(value())}</span>
                    </td>
                    <td class="num">
                      <span class="text-brand-slate-500">--</span>
                    </td>
                    <td>
                      <div class="flex items-center gap-4 whitespace-nowrap">
                        <Show
                          when={!isHyperliquidExecution()}
                          fallback={
                            <a
                              href={hyperliquidAppUrl(
                                hyperliquidConnection()?.network ?? "mainnet",
                                "portfolio",
                              )}
                              target="_blank"
                              rel="noreferrer"
                              class="text-brand-accent hover:underline"
                            >
                              Manage
                            </a>
                          }
                        >
                          <button
                            class="text-brand-accent hover:underline"
                            onClick={() => goToTrade(asset.symbol, "spot")}
                          >
                            Buy Spot
                          </button>
                        </Show>
                      </div>
                    </td>
                    <td>
                      <span class="font-mono text-xs text-brand-slate-400">
                        {asset.contract ?? "--"}
                      </span>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BalancesPanel;
