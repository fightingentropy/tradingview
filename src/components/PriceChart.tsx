import {
  Circle,
  DashPathEffect,
  Group,
  Line as SkiaLine,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAnimatedReaction, useDerivedValue, runOnJS } from 'react-native-reanimated';
import {
  Candlestick,
  CartesianChart,
  Line,
  useChartPressState,
  useChartTransformState,
  type ChartBounds,
  type ChartPressState,
} from 'victory-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Indicators, Spacing } from '@/constants/theme';
import { sma } from '@/domain/indicators';
import type { Candle } from '@/domain/types';
import {
  formatCandleStamp,
  formatChartAxisLabel,
  formatPercent,
  formatPrice,
  formatSignedPrice,
  type AxisTickKind,
} from '@/lib/format';

export type ChartType = 'candle' | 'line';

interface ChartDatum {
  x: number;
  open: number;
  high: number;
  low: number;
  close: number;
  [key: string]: number;
}

type PressState = ChartPressState<{
  x: number;
  y: { open: number; high: number; low: number; close: number };
}>;

interface Props {
  candles: Candle[];
  priceDecimals: number;
  type: ChartType;
  /** SMA overlay lines to draw, by period (e.g. [20, 50, 200]). */
  smaPeriods?: number[];
  /** Draw volume bars in a band along the bottom of the chart. */
  showVolume?: boolean;
  /**
   * Render only the last N candles (keeps them thick on wide date ranges).
   * Indicators are still computed across the full lead-included series, so
   * SMA 200 keeps drawing even when fewer bars are visible.
   */
  visibleCount?: number;
  /** Time-axis label granularity for the visible range (hours, days, …). */
  axisKind?: AxisTickKind;
}

/** Roughly how many time labels to print across the bottom axis. */
const AXIS_TICKS = 5;

const smaColor = (period: number) => Indicators.sma[period] ?? Colors.textMuted;

export function PriceChart({
  candles,
  priceDecimals,
  type,
  smaPeriods = [],
  showVolume = false,
  visibleCount,
  axisKind,
}: Props) {
  const start = visibleCount != null ? Math.max(0, candles.length - visibleCount) : 0;
  const shown = useMemo(() => candles.slice(start), [candles, start]);

  const data = useMemo<ChartDatum[]>(
    () => shown.map((c, i) => ({ x: i, open: c.o, high: c.h, low: c.l, close: c.c })),
    [shown],
  );

  // Scale the price axis to the visible candles (plus a little headroom) rather
  // than to the indicator overlays. SMA 200 on a strong trend sits far below the
  // bars; letting it set the domain squashes the candles into a sliver, so we
  // anchor on the price action and clamp the SMA lines to the band (below).
  const yDomain = useMemo<[number, number] | undefined>(() => {
    if (shown.length === 0) return undefined;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of shown) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.01 || 1;
    return [lo - pad, hi + pad];
  }, [shown]);

  // Evenly spaced time labels sampled from the visible candles' open times.
  const axisTicks = useMemo(() => {
    if (!axisKind || shown.length < 2) return [];
    const n = shown.length;
    return Array.from({ length: AXIS_TICKS }, (_, k) => {
      const idx = Math.round((k / (AXIS_TICKS - 1)) * (n - 1));
      return formatChartAxisLabel(shown[idx].t, axisKind);
    });
  }, [shown, axisKind]);

  // SMA over the full series (including the off-screen lead), then sliced to the
  // visible window so a 200-period line still renders on a short range.
  const smaSeries = useMemo(() => {
    const closes = candles.map((c) => c.c);
    const out: Record<number, (number | null)[]> = {};
    for (const p of smaPeriods) out[p] = sma(closes, p).slice(start);
    return out;
  }, [candles, smaPeriods, start]);

  const volMax = useMemo(
    () => (showVolume ? shown.reduce((m, c) => Math.max(m, c.v), 0) : 0),
    [shown, showVolume],
  );

  const { state } = useChartPressState({ x: 0, y: { open: 0, high: 0, low: 0, close: 0 } });
  const pressState = state as unknown as PressState;
  const transform = useChartTransformState();

  // Mirror the crosshair's matched index into React state for the OHLC legend,
  // and tick the Taptic Engine each time the press crosses onto a new candle —
  // the light "selection" feedback the TradingView app gives while scrubbing.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const onScrub = useCallback((index: number) => {
    setActiveIndex(index >= 0 ? index : null);
    if (index >= 0) Haptics.selectionAsync().catch(() => {});
  }, []);
  useAnimatedReaction(
    () => (state.isActive.value ? state.matchedIndex.value : -1),
    (cur, prev) => {
      if (cur !== prev) runOnJS(onScrub)(cur);
    },
  );

  const scrubbing = activeIndex !== null;
  const legendIndex = scrubbing ? activeIndex! : shown.length - 1;
  const legend = shown[legendIndex];

  // Period-over-period change for the highlighted candle (vs the prior close,
  // reaching into the off-screen lead for the first visible bar).
  const prevClose =
    legend != null ? (start + legendIndex - 1 >= 0 ? candles[start + legendIndex - 1].c : legend.o) : null;
  const legendChange = legend && prevClose != null ? legend.c - prevClose : null;
  const legendChangePct = legendChange != null && prevClose ? (legendChange / prevClose) * 100 : null;

  if (data.length === 0) {
    return <View style={styles.fill} />;
  }

  return (
    <View style={styles.fill}>
      {legend ? (
        <View style={styles.legend} pointerEvents="none">
          <View style={styles.legendRow}>
            <OhlcItem label="O" value={legend.o} decimals={priceDecimals} candle={legend} />
            <OhlcItem label="H" value={legend.h} decimals={priceDecimals} candle={legend} />
            <OhlcItem label="L" value={legend.l} decimals={priceDecimals} candle={legend} />
            <OhlcItem label="C" value={legend.c} decimals={priceDecimals} candle={legend} />
          </View>
          {smaPeriods.length > 0 ? (
            <View style={styles.legendRow}>
              {smaPeriods.map((p) => (
                <SmaLegendItem
                  key={p}
                  period={p}
                  value={smaSeries[p]?.[legendIndex] ?? null}
                  decimals={priceDecimals}
                />
              ))}
            </View>
          ) : null}
          {scrubbing ? (
            <View style={styles.stampRow}>
              <AppText variant="caption" muted numeric>
                {formatCandleStamp(legend.t, axisKind ?? 'time')}
              </AppText>
              {legendChange != null ? (
                <AppText
                  variant="caption"
                  numeric
                  color={legendChange >= 0 ? Colors.up : Colors.down}>
                  {formatSignedPrice(legendChange, priceDecimals)} {formatPercent(legendChangePct)}
                </AppText>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.chartFill}>
        <CartesianChart
          data={data}
          xKey="x"
          yKeys={['high', 'low', 'open', 'close']}
          domain={yDomain ? { y: yDomain } : undefined}
          chartPressState={pressState}
          transformState={transform.state}
          transformConfig={{ pan: { enabled: true }, pinch: { enabled: true } }}
          domainPadding={{ left: 8, right: 8, top: 24, bottom: 8 }}>
        {({ points, chartBounds, yScale }) => (
          <>
            {showVolume ? (
              <VolumeBars candles={shown} xs={points.close} bounds={chartBounds} max={volMax} />
            ) : null}
            {type === 'candle' ? (
              <Candlestick
                openPoints={points.open}
                highPoints={points.high}
                lowPoints={points.low}
                closePoints={points.close}
                chartBounds={chartBounds}
                candleColors={{ positive: Colors.up, negative: Colors.down }}
              />
            ) : (
              <Line points={points.close} color={Colors.accent} strokeWidth={2} curveType="linear" />
            )}
            {smaPeriods.map((p) => (
              <SmaLine
                key={p}
                values={smaSeries[p] ?? []}
                xs={points.close}
                yScale={yScale}
                bounds={chartBounds}
                color={smaColor(p)}
              />
            ))}
            <Crosshair state={pressState} bounds={chartBounds} />
          </>
        )}
        </CartesianChart>
      </View>

      {axisTicks.length > 0 ? (
        <View style={styles.axisRow} pointerEvents="none">
          {axisTicks.map((label, i) => (
            <AppText key={i} variant="caption" muted numeric>
              {label}
            </AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Volume bars packed into a band along the bottom of the price area. */
function VolumeBars({
  candles,
  xs,
  bounds,
  max,
}: {
  candles: Candle[];
  xs: { x: number }[];
  bounds: ChartBounds;
  max: number;
}) {
  if (!max || xs.length < 2) return null;
  const band = (bounds.bottom - bounds.top) * 0.18;
  const baseY = bounds.bottom;
  const spacing = Math.abs(xs[1].x - xs[0].x);
  const width = Math.max(1, spacing * 0.6);

  const up = Skia.Path.Make();
  const down = Skia.Path.Make();
  for (let i = 0; i < candles.length; i++) {
    const px = xs[i]?.x;
    if (px == null) continue;
    const c = candles[i];
    const h = (c.v / max) * band;
    if (h <= 0) continue;
    (c.c >= c.o ? up : down).addRect(Skia.XYWHRect(px - width / 2, baseY - h, width, h));
  }
  return (
    <Group opacity={0.5}>
      <Path path={down} color={Colors.down} />
      <Path path={up} color={Colors.up} />
    </Group>
  );
}

/** A single simple-moving-average overlay line, scaled onto the price axis. */
function SmaLine({
  values,
  xs,
  yScale,
  bounds,
  color,
}: {
  values: (number | null)[];
  xs: { x: number }[];
  yScale: (v: number) => number;
  bounds: ChartBounds;
  color: string;
}) {
  const path = Skia.Path.Make();
  let started = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const px = xs[i]?.x;
    if (v == null || px == null) continue;
    // Domain is anchored to the candles, so an SMA can fall outside it — clamp to
    // the plot band instead of letting it draw over the axis labels below.
    const y = Math.max(bounds.top, Math.min(bounds.bottom, yScale(v)));
    if (!started) {
      path.moveTo(px, y);
      started = true;
    } else {
      path.lineTo(px, y);
    }
  }
  if (!started) return null;
  return <Path path={path} style="stroke" strokeWidth={1.5} color={color} />;
}

function Crosshair({ state, bounds }: { state: PressState; bounds: ChartBounds }) {
  const top = bounds.top;
  const bottom = bounds.bottom;
  const left = bounds.left;
  const right = bounds.right;

  const vTop = useDerivedValue(() => vec(state.x.position.value, top));
  const vBottom = useDerivedValue(() => vec(state.x.position.value, bottom));
  const hLeft = useDerivedValue(() => vec(left, state.y.close.position.value));
  const hRight = useDerivedValue(() => vec(right, state.y.close.position.value));
  const dot = useDerivedValue(() => vec(state.x.position.value, state.y.close.position.value));
  const opacity = useDerivedValue(() => (state.isActive.value ? 1 : 0));

  return (
    <Group opacity={opacity}>
      <SkiaLine p1={vTop} p2={vBottom} color={Colors.textMuted} strokeWidth={1}>
        <DashPathEffect intervals={[4, 4]} />
      </SkiaLine>
      <SkiaLine p1={hLeft} p2={hRight} color={Colors.textMuted} strokeWidth={1}>
        <DashPathEffect intervals={[4, 4]} />
      </SkiaLine>
      <Circle c={dot} r={4} color={Colors.accent} />
    </Group>
  );
}

function OhlcItem({
  label,
  value,
  decimals,
  candle,
}: {
  label: string;
  value: number | null;
  decimals: number;
  candle: Candle;
}) {
  const color = candle.c >= candle.o ? Colors.up : Colors.down;
  return (
    <View style={styles.ohlcItem}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="caption" numeric color={color}>
        {formatPrice(value, decimals)}
      </AppText>
    </View>
  );
}

function SmaLegendItem({
  period,
  value,
  decimals,
}: {
  period: number;
  value: number | null;
  decimals: number;
}) {
  const color = smaColor(period);
  return (
    <View style={styles.ohlcItem}>
      <AppText variant="caption" color={color}>
        SMA{period}
      </AppText>
      <AppText variant="caption" numeric color={color}>
        {formatPrice(value, decimals)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  chartFill: { flex: 1 },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  legend: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.lg,
    zIndex: 2,
    gap: 2,
  },
  legendRow: { flexDirection: 'row', gap: Spacing.md },
  stampRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', marginTop: 1 },
  ohlcItem: { flexDirection: 'row', gap: 4, alignItems: 'center' },
});
