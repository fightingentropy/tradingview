import { expect, test } from "bun:test";
import type { IChartApi, LineData, Time } from "lightweight-charts";
import type { Candle } from "./candles";
import { calculateSma, createMovingAverages, latestSma, MA_PERIODS, restoreMaSettings } from "./movingAverages";

const candle = (close: number, index: number): Candle => ({
  time: (index + 1) * 60_000, open: close, high: close, low: close, close, volume: 1,
});

test("SMA starts only after a full period and uses closing prices", () => {
  const candles = Array.from({ length: 25 }, (_, i) => candle(i + 1, i));
  expect(calculateSma(candles.slice(0, 19), 20)).toEqual([]);
  expect(latestSma(candles.slice(0, 19), 20)).toBeNull();
  const points = calculateSma(candles, 20);
  expect(points).toHaveLength(6);
  expect(points[0]).toEqual({ time: 1200, value: 10.5 });
  expect(points[5]).toEqual({ time: 1500, value: 15.5 });
});

test("live SMA handles an appended candle and corrections to the current candle", () => {
  for (const period of MA_PERIODS) {
    const candles = Array.from({ length: period }, (_, i) => candle(100, i));
    expect(latestSma(candles, period)?.value).toBe(100);
    candles.push(candle(200, period));
    expect(latestSma(candles, period)?.value).toBeCloseTo(100 + 100 / period);
    candles[candles.length - 1] = candle(150, period);
    expect(latestSma(candles, period)?.value).toBeCloseTo(100 + 50 / period);
    expect(latestSma(candles, period)).toEqual(calculateSma(candles, period).at(-1)!);
  }
});

test("MA choices retain existing saved settings, including all disabled", () => {
  const selected = { 20: true, 50: false, 200: false };
  expect(restoreMaSettings(JSON.parse(JSON.stringify(selected)))).toEqual(selected);
  expect(restoreMaSettings({ 20: false, 50: false, 200: false })).toEqual({ 20: false, 50: false, 200: false });
  expect(restoreMaSettings({ 20: "true", 200: false })).toEqual({ 20: false, 50: false, 200: false });
  expect(restoreMaSettings(null)).toEqual({ 20: false, 50: false, 200: true });
});

test("series clear on an interval change and re-enable from the current market's candles", () => {
  const series: Array<{ data: LineData<Time>[]; visible: boolean; updates: number }> = [];
  const chart = { addSeries() {
    const state = { data: [] as LineData<Time>[], visible: false, updates: 0 };
    series.push(state);
    return {
      applyOptions(options: { visible: boolean }) { state.visible = options.visible; },
      setData(data: LineData<Time>[]) { state.data = data; },
      update(point: LineData<Time>) { state.updates++; state.data[state.data.length - 1] = point; },
    };
  } } as unknown as IChartApi;
  const ma = createMovingAverages(chart);
  const oldMarket = Array.from({ length: 210 }, (_, i) => candle(100, i));
  ma.setEnabled({ 20: false, 50: false, 200: true }, oldMarket);
  expect(series[2].data.at(-1)?.value).toBe(100);
  expect(series[0].data).toEqual([]);
  ma.update(oldMarket);
  expect(series.map(item => item.updates)).toEqual([0, 0, 1]);
  ma.setEnabled({ 20: false, 50: false, 200: false }, oldMarket);
  expect(series[2].data).toEqual([]);
  ma.setEnabled({ 20: false, 50: false, 200: true }, oldMarket);
  ma.setData([]);
  expect(series[2].data).toEqual([]);
  const newMarket = Array.from({ length: 60 }, (_, i) => candle(25, i));
  ma.setData(newMarket);
  expect(series[2].data).toEqual([]);
  ma.setEnabled({ 20: true, 50: true, 200: false }, newMarket);
  expect(series.map(item => item.visible)).toEqual([true, true, false]);
  expect(series[0].data.at(-1)?.value).toBe(25);
  expect(series[1].data.at(-1)?.value).toBe(25);
});
