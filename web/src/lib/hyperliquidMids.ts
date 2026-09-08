export type LiveMidMarket = {
  symbol: string;
  type: "perps" | "spot" | "equities";
};

export const parseHyperliquidMids = (
  value: unknown,
): Record<string, number> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const mids: Record<string, number> = {};
  for (const [symbol, rawPrice] of Object.entries(value)) {
    if (!symbol || symbol.length > 80) continue;
    const price = Number(rawPrice);
    if (Number.isFinite(price) && price > 0) mids[symbol] = price;
  }
  return mids;
};

export const mapHyperliquidMidsToMarkets = ({
  dex,
  markets,
  mids,
  spotMidKeyBySymbol,
}: {
  dex: string;
  markets: LiveMidMarket[];
  mids: Record<string, number>;
  spotMidKeyBySymbol: ReadonlyMap<string, string>;
}) => {
  const updates = new Map<string, number>();
  const normalizedDex = dex.trim().toLowerCase();

  for (const market of markets) {
    const separator = market.symbol.indexOf(":");
    const symbolDex = separator > 0
      ? market.symbol.slice(0, separator).toLowerCase()
      : "";
    if (normalizedDex ? symbolDex !== normalizedDex : symbolDex !== "") {
      continue;
    }

    const baseSymbol =
      separator > 0 ? market.symbol.slice(separator + 1) : market.symbol;
    const keys =
      market.type === "spot"
        ? [spotMidKeyBySymbol.get(market.symbol), market.symbol, baseSymbol]
        : [market.symbol, baseSymbol];
    const key = keys.find(
      (candidate): candidate is string =>
        !!candidate && Number.isFinite(mids[candidate]) && mids[candidate] > 0,
    );
    if (key) updates.set(market.symbol, mids[key]);
  }

  return updates;
};
