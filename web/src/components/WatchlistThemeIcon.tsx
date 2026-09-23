import { type Component } from "solid-js";

const paths: Record<string, string> = {
  watchlist: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z",
  indices: "M4 19V9m5 10V5m5 14v-7m5 7V3",
  rates: "M3 14h4l3-8 4 13 3-8h4",
  commodities: "m3 9 4-5h10l4 5-9 11Zm0 0h18M7 4l5 16 5-16",
  stocks: "M4 21V5l8-2v18m0-12h8v12M8 7v1m0 3v1m0 3v1m8-3v1m0 3v1M2 21h20",
  etfs: "m3 7 9-4 9 4-9 4Zm0 5 9 4 9-4M3 17l9 4 9-4",
  forex: "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4",
  crypto: "M8 5h7a3 3 0 0 1 0 6H8m0 0h8a4 4 0 0 1 0 8H8M9 5v14M11 2v3m4-3v3m-4 14v3m4-3v3",
};

const WatchlistThemeIcon: Component<{ theme: string }> = (props) => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[props.theme] ?? "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"} /></svg>
);

export default WatchlistThemeIcon;
