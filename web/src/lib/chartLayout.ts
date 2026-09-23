import { normalizeSymbol } from "./format";
import { CHART_RESOLUTIONS, type ChartResolution } from "./candles";
export { CHART_RESOLUTIONS, type ChartResolution } from "./candles";

export const CHART_COUNTS = [1, 2, 3, 4, 5, 6] as const;
export type ChartCount = typeof CHART_COUNTS[number];
export const CHART_LAYOUT_KEY = "trade-xyz-chart-layout-v2";
export interface ChartLayout { count: ChartCount; symbols: string[]; resolution: ChartResolution; activeIndex: number }
const defaults = ["BTC", "HYPE", "ETH", "ZEC", "xyz:SP500", "xyz:XYZ100"];

export function restoreChartLayout(raw: Partial<ChartLayout> | null): ChartLayout {
  const count = CHART_COUNTS.includes(raw?.count as ChartCount) ? raw!.count! : 4;
  const saved = Array.isArray(raw?.symbols) ? raw.symbols : [];
  const symbols = defaults.map((fallback, index) => typeof saved[index] === "string" && saved[index].trim()
    ? normalizeSymbol(saved[index]) || fallback : fallback);
  return { count, symbols,
    resolution: CHART_RESOLUTIONS.includes(raw?.resolution as ChartResolution) ? raw!.resolution! : "5",
    activeIndex: Number.isInteger(raw?.activeIndex) ? Math.max(0, Math.min(count - 1, raw!.activeIndex!)) : 0 };
}

export function withChartCount(state: ChartLayout, count: ChartCount): ChartLayout {
  if (!CHART_COUNTS.includes(count)) return state;
  return { ...state, count, activeIndex: Math.min(state.activeIndex, count - 1) };
}
export function withoutChart(state: ChartLayout, index: number): ChartLayout {
  if (state.count === 1 || !Number.isInteger(index) || index < 0 || index >= state.count) return state;
  const symbols = [...state.symbols];
  const [removed] = symbols.splice(index, 1);
  // Keep unused choices available when the user expands the layout again.
  symbols.push(removed);
  const count = (state.count - 1) as ChartCount;
  const activeIndex = state.activeIndex > index ? state.activeIndex - 1 : Math.min(state.activeIndex, count - 1);
  return { ...state, symbols, count, activeIndex };
}
export function withChartSymbol(state: ChartLayout, symbol: string, index = state.activeIndex): ChartLayout {
  if (!Number.isInteger(index) || index < 0 || index >= state.count || !symbol.trim()) return state;
  const symbols = [...state.symbols];
  symbols[index] = normalizeSymbol(symbol);
  return { ...state, symbols };
}
