import { LineSeries, type IChartApi, type ISeriesApi, type LineData, type Time } from "lightweight-charts";
import type { Candle } from "./candles";

export const MA_PERIODS = [20, 50, 200] as const;
export type MaPeriod = typeof MA_PERIODS[number];
export type MaSettings = Record<MaPeriod, boolean>;
export const DEFAULT_MA_ENABLED: MaSettings = { 20: false, 50: false, 200: true };
export const MA_COLORS: Record<MaPeriod, string> = { 20: "#f59e0b", 50: "#38bdf8", 200: "#b0a079" };

export function restoreMaSettings(raw: unknown): MaSettings {
  const next = { ...DEFAULT_MA_ENABLED };
  if (raw && typeof raw === "object") {
    for (const period of MA_PERIODS) {
      const value = (raw as Record<string, unknown>)[period];
      if (typeof value === "boolean") next[period] = value;
    }
  }
  return next;
}

export function calculateSma(candles: readonly Candle[], period: MaPeriod): LineData<Time>[] {
  const data: LineData<Time>[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) data.push({ time: (candles[i].time / 1000) as Time, value: sum / period });
  }
  return data;
}

export function latestSma(candles: readonly Candle[], period: MaPeriod): LineData<Time> | null {
  if (candles.length < period) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) sum += candles[i].close;
  return { time: (candles[candles.length - 1].time / 1000) as Time, value: sum / period };
}

// Both chart views use the same series styling and calculations. Live ticks only
// update the latest point; history and interval changes replace the full series.
export function createMovingAverages(chart: IChartApi) {
  const series = new Map<MaPeriod, ISeriesApi<"Line">>();
  let enabled: MaSettings = { 20: false, 50: false, 200: false };
  for (const period of MA_PERIODS) {
    series.set(period, chart.addSeries(LineSeries, {
      color: MA_COLORS[period], lineWidth: period === 200 ? 2 : 1,
      priceLineVisible: false, lastValueVisible: false, visible: false,
    }));
  }
  const setData = (candles: readonly Candle[]) => {
    for (const period of MA_PERIODS) {
      // Hidden series still contribute timestamps to the chart's shared axis.
      // Clear them so a previous interval cannot stretch the current timeline.
      series.get(period)!.setData(enabled[period] ? calculateSma(candles, period) : []);
    }
  };
  return {
    setData,
    setEnabled(next: MaSettings, candles: readonly Candle[]) {
      enabled = next;
      for (const period of MA_PERIODS) series.get(period)!.applyOptions({ visible: enabled[period] });
      setData(candles);
    },
    update(candles: readonly Candle[]) {
      for (const period of MA_PERIODS) {
        if (!enabled[period]) continue;
        const point = latestSma(candles, period);
        if (point) series.get(period)!.update(point);
        else series.get(period)!.setData([]);
      }
    },
  };
}
