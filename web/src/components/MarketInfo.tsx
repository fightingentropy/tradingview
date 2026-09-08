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
    class="text-brand-slate-400"
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
    <div class="flex items-center gap-4 px-4 py-2 bg-brand-surface border-b border-brand-border">
      {/* Market Selector */}
      <button
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-800/50 transition-colors"
        onClick={() => setSearchOpen(true)}
      >
        <Show
          when={ICON_SYMBOLS.has(displaySymbol())}
          fallback={
            <div class="w-6 h-6 rounded-full bg-brand-screen flex items-center justify-center border border-brand-border text-[10px] font-semibold text-slate-200">
              {displaySymbol().slice(0, 4)}
            </div>
          }
        >
          <img src={iconSrc()} alt={displaySymbol()} class="w-6 h-6" />
        </Show>
        <span class="font-semibold text-slate-100">{displayMarketName()}</span>
        <span class="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded">
          {leverageLabel()}
        </span>
        <ChevronDown />
      </button>

      {/* Price */}
      <div class="flex flex-col">
        <span class="text-lg font-bold text-brand-green-400 font-mono">
          {markPrice()}
        </span>
        <span class="text-xs text-brand-slate-400">Mark Price</span>
      </div>

      {/* Stats */}
      <div class="flex items-center gap-6 ml-4 text-sm">
        <div class="flex flex-col">
          <span class={`font-mono ${changeColor()}`}>{changeText()}</span>
          <span class="text-xs text-brand-slate-500">24h Change</span>
        </div>
        <div class="flex flex-col">
          <span class="text-slate-200 font-mono">{oraclePrice()}</span>
          <span class="text-xs text-brand-slate-500">Oracle</span>
        </div>
        <div class="flex flex-col">
          <span class="text-slate-200 font-mono">{volume24h()}</span>
          <span class="text-xs text-brand-slate-500">24h Volume</span>
        </div>
        <Show when={currentMarketType() !== "spot"}>
          <div class="flex flex-col">
            <span class="text-slate-200 font-mono">{openInterest()}</span>
            <span class="text-xs text-brand-slate-500">Open Interest</span>
          </div>
          <div class="flex flex-col">
            <div class="flex items-center gap-3">
              <span class={`font-mono ${fundingColor()}`}>{fundingRate()}</span>
              <span class="font-mono text-slate-200">{fundingCountdown()}</span>
            </div>
            <span class="text-xs text-brand-slate-500">
              Funding / Countdown
            </span>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default MarketInfo;
