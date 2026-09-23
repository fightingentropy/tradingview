import { type Component, Show, createSignal } from "solid-js";
import usFlag from "../assets/flags/us.svg";
import euFlag from "../assets/flags/eu.svg";
import gbFlag from "../assets/flags/gb.svg";
import jpFlag from "../assets/flags/jp.svg";
import chFlag from "../assets/flags/ch.svg";
import auFlag from "../assets/flags/au.svg";
import caFlag from "../assets/flags/ca.svg";
import nzFlag from "../assets/flags/nz.svg";
import "./MarketAvatar.css";

const localLogos = new Set([
  "AAPL", "AMD", "AMZN", "BABA", "BTC", "COIN", "COPPER", "CRCL", "ETH", "GOLD", "GOOGL", "HOOD", "HYPE",
  "INTC", "META", "MSFT", "MSTR", "MU", "NFLX", "NVDA", "ORCL", "PLTR", "SIL", "SILVER", "SNDK", "SOL", "TSLA", "XYZ100", "ZEC",
]);
// The same verified brand artwork used by the native watchlist.
const brandLogos: Record<string, string> = {
  SPCX: "spacex", HIMS: "hims-and-hers-health", LLY: "eli-lilly", LITE: "lumentum-hldgs",
  AVGO: "broadcom", CRM: "salesforce", QCOM: "qualcomm", BE: "bloom-energy", NATGAS: "natural-gas",
};
const flags: Record<string, string> = { EUR: euFlag, GBP: gbFlag, JPY: jpFlag, CHF: chFlag, AUD: auFlag, CAD: caFlag, NZD: nzFlag, "10Y": usFlag, "2Y": usFlag, "5Y": usFlag, "30Y": usFlag };
const colors: Record<string, string> = { SP500: "#ef6172", XYZ100: "#7fafff", TLT: "#88a9dc", HYPE: "#78dec2", GOLD: "#d6b36c" };
const palette = ["#8bb1d8", "#b39ac9", "#80b8aa", "#cfad80", "#c991a2"];
const failedImages = new Set<string>();

const MarketAvatar: Component<{ symbol: string; size?: number }> = (props) => {
  const ticker = () => props.symbol.split(":").pop()!.toUpperCase();
  const source = () => flags[ticker()] ?? (localLogos.has(ticker()) ? `/${ticker().toLowerCase()}.svg`
    : brandLogos[ticker()] ? `https://s3-symbol-logo.tradingview.com/${brandLogos[ticker()]}.svg` : undefined);
  const [failed, setFailed] = createSignal<string>();
  const tint = () => colors[ticker()] ?? palette[[...ticker()].reduce((hash, char) => hash + char.charCodeAt(0), 0) % palette.length];
  return <span class="market-avatar" aria-hidden="true" style={{ "--avatar-size": `${props.size ?? 30}px`, "--avatar-tint": tint() }}>
    <span>{ticker() === "SP500" ? "500" : ticker().slice(0, 3)}</span>
    <Show when={source() && failed() !== source() && !failedImages.has(source()!)}>
      <img src={source()} alt="" width={props.size ?? 30} height={props.size ?? 30} loading="lazy" decoding="async"
        onError={event => {
          const failedSource = event.currentTarget.getAttribute("src");
          if (failedSource) { failedImages.add(failedSource); setFailed(failedSource); }
        }} />
    </Show>
  </span>;
};

export default MarketAvatar;
