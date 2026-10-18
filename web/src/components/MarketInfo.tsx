import {
  Component,
  Show,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  currentMarket,
  currentMarketLeverage,
  currentMarketType,
  currentSymbol,
  markPrice,
  oraclePrice,
  change24h,
  volume24h,
  openInterest,
  fundingRate,
  setSearchOpen,
  getUrlSymbol,
} from "../stores/market";

const ChevronDown = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="market-selector-chevron"
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const ICON_SOURCES: Record<string, string> = {
  NATGAS: "https://s3-symbol-logo.tradingview.com/natural-gas.svg",
};

const ICON_SYMBOLS = new Set([
  "BTC",
  "ETH",
  "HYPE",
  "SOL",
  "ZEC",
  "XYZ100",
  "TSLA",
  "NVDA",
  "HOOD",
  "PLTR",
  "MSTR",
  "GOOGL",
  "AMZN",
  "INTC",
  "CRCL",
  "COIN",
  "AMD",
  "META",
  "MU",
  "NFLX",
  "MSFT",
  "AAPL",
  "SNDK",
  "ORCL",
  "SILVER",
  "GOLD",
  "COPPER",
  "NATGAS",
  "PLATINUM",
]);

const MarketInfo: Component = () => {
  const [fundingCountdown, setFundingCountdown] = createSignal("00:00:00");

  const displaySymbol = () => {
    const symbol = currentSymbol();
    return symbol.toLowerCase().startsWith("xyz:")
      ? symbol.slice(symbol.indexOf(":") + 1)
      : symbol;
  };
  const iconSrc = () =>
    ICON_SOURCES[displaySymbol()] ?? `/${displaySymbol().toLowerCase()}.svg`;
  const displayMarketName = () => getUrlSymbol(currentMarket());
  const leverageLabel = () =>
    currentMarketType() === "spot" ? "Spot" : currentMarketLeverage();
  const changeColor = () => {
    const val = change24h();
    if (!Number.isFinite(val)) return "text-brand-slate-500";
    return val >= 0 ? "text-brand-green-400" : "text-brand-red-400";
  };
  const changeText = () => {
    const val = change24h();
    if (!Number.isFinite(val)) return "--";
    const sign = val >= 0 ? "+" : "";
    return `${sign}${val.toFixed(2)}%`;
  };
  const fundingColor = () => {
    const rate = fundingRate();
    if (rate === "--") return "text-brand-slate-500";
    return rate.startsWith("-") ? "text-brand-red-400" : "text-brand-green-400";
  };

  const formatFundingCountdown = () => {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    const remaining = Math.max(0, next.getTime() - now.getTime());
    const totalSeconds = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0"),
    ].join(":");
  };

  createEffect(() => {
    if (currentMarketType() === "spot") {
      setFundingCountdown("--:--:--");
      return;
    }
    const update = () => setFundingCountdown(formatFundingCountdown());
    update();
    const timer = setInterval(update, 1000);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <div class="market-overview">
      {/* Market Selector */}
      <button
        class="market-selector"
        aria-label="Choose market"
        onClick={() => setSearchOpen(true)}
      >
        <Show
          when={ICON_SYMBOLS.has(displaySymbol())}
          fallback={
            <div class="market-selector-fallback">
              {displaySymbol().slice(0, 4)}
            </div>
          }
        >
          <img src={iconSrc()} alt={displaySymbol()} />
        </Show>
        <span class="market-selector-copy">
          <span class="market-pair">{displayMarketName()}</span>
          <span class="market-subtitle">
            {currentMarketType() === "spot" ? "Spot market" : "Perpetual"}
            <Show when={currentMarketType() !== "spot"}>
              <span>·</span>
              {leverageLabel()}
            </Show>
          </span>
        </span>
        <ChevronDown />
      </button>

      {/* Price */}
      <div class="market-mark">
        <span class="market-label">Mark Price</span>
        <span class="market-mark-price">{markPrice()}</span>
      </div>

      {/* Stats */}
      <div class="market-stats">
        <div class="market-stat">
          <span class="market-label">24h Change</span>
          <span class={`market-value font-mono ${changeColor()}`}>
            {changeText()}
          </span>
        </div>
        <div class="market-stat">
          <span class="market-label">Oracle</span>
          <span class="market-value font-mono">{oraclePrice()}</span>
        </div>
        <div class="market-stat">
          <span class="market-label">24h Volume</span>
          <span class="market-value font-mono">{volume24h()}</span>
        </div>
        <Show when={currentMarketType() !== "spot"}>
          <div class="market-stat">
            <span class="market-label">Open Interest</span>
            <span class="market-value font-mono">{openInterest()}</span>
          </div>
          <div class="market-stat">
            <span class="market-label">Funding / Next payment</span>
            <span class="market-value">
              <span class={`font-mono ${fundingColor()}`}>{fundingRate()}</span>
              <span class="market-funding-countdown font-mono">
                {fundingCountdown()}
              </span>
            </span>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default MarketInfo;
