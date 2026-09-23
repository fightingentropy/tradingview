import { createRoot, createSignal, createEffect } from "solid-js";
import { CHART_LAYOUT_KEY, restoreChartLayout, withChartCount, withChartSymbol, withoutChart, type ChartCount, type ChartResolution } from "../lib/chartLayout";

function load() {
  try {
    const stored = localStorage.getItem(CHART_LAYOUT_KEY);
    if (stored) return restoreChartLayout(JSON.parse(stored));
    return restoreChartLayout({
      count: Number(localStorage.getItem("trade-xyz-charts-count")) as ChartCount,
      symbols: JSON.parse(localStorage.getItem("trade-xyz-charts-grid") ?? "null"),
      resolution: localStorage.getItem("trade-xyz-charts-resolution") as ChartResolution,
    });
  } catch { return restoreChartLayout(null); }
}

export const { chartLayout, setChartLayout } = createRoot(() => {
  const [chartLayout, setChartLayout] = createSignal(load());
  createEffect(() => {
    try { localStorage.setItem(CHART_LAYOUT_KEY, JSON.stringify(chartLayout())); } catch { /* storage unavailable */ }
  });
  return { chartLayout, setChartLayout };
});
export const setChartCount = (count: ChartCount) => setChartLayout(state => withChartCount(state, count));
export const setChartSymbol = (symbol: string, index?: number) => setChartLayout(state => withChartSymbol(state, symbol, index));
export const removeChart = (index: number) => setChartLayout(state => withoutChart(state, index));
