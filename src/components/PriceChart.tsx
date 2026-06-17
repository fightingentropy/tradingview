import {
  DashPathEffect,
  Group,
  Line as SkiaLine,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  Candlestick,
  CartesianChart,
  Line,
  useChartTransformState,
  type ChartBounds,
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

/** Plot geometry mirrored into shared values so the crosshair gesture can read it on the UI thread. */
type Bounds = { top: number; bottom: number; left: number; right: number };

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
/** Height of the floating price label that rides the horizontal crosshair. */
const PRICE_PILL_H = 22;

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

const smaColor = (period: number) => Indicators.sma[period] ?? Colors.textMuted;

/** Index of the candle whose x-pixel is nearest the touch — runs on the UI thread. */
function nearestIndex(xs: number[], x: number): number {
  'worklet';
  let best = -1;
  let bestD = 1e12;
  for (let i = 0; i < xs.length; i++) {
    const d = x > xs[i] ? x - xs[i] : xs[i] - x;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Group-thousands price formatter that is safe to run inside a reanimated worklet (no regex). */
function formatPriceWorklet(v: number, decimals: number): string {
  'worklet';
  if (!Number.isFinite(v)) return '';
  const neg = v < 0;
  const fixed = Math.abs(v).toFixed(decimals);
  const dot = fixed.indexOf('.');
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  const fracPart = dot === -1 ? '' : fixed.slice(dot);
  let grouped = '';
  let count = 0;
  for (let i = intPart.length - 1; i >= 0; i--) {
    grouped = intPart[i] + grouped;
    count++;
    if (count % 3 === 0 && i > 0) grouped = ',' + grouped;
  }
  return (neg ? '-' : '') + grouped + fracPart;
}

export function PriceChart({
  candles,
  priceDecimals,
  type,
  smaPeriods = [],
  showVolume = false,
  visibleCount,
  axisKind,
}: Props) {
  // While a finger is pressing the chart, hold the candle series steady so live
  // websocket ticks can't shift the bar under the crosshair (or reset gestures).
  const [pressing, setPressing] = useState(false);
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const frozenRef = useRef<Candle[]>(candles);
  const pressingRef = useRef(false);
  const activeCandles = pressing ? frozenRef.current : candles;

  const start = visibleCount != null ? Math.max(0, activeCandles.length - visibleCount) : 0;
  const shown = useMemo(() => activeCandles.slice(start), [activeCandles, start]);

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
    const closes = activeCandles.map((c) => c.c);
    const out: Record<number, (number | null)[]> = {};
    for (const p of smaPeriods) out[p] = sma(closes, p).slice(start);
    return out;
  }, [activeCandles, smaPeriods, start]);

  const volMax = useMemo(
    () => (showVolume ? shown.reduce((m, c) => Math.max(m, c.v), 0) : 0),
    [shown, showVolume],
  );

  const transform = useChartTransformState();

  // ----- Crosshair state, driven by our own long-press pan (not victory's press
  // state, which snaps Y to the close). The vertical line snaps to the nearest
  // candle; the horizontal line + price pill follow the finger freely. -----
  const crossActive = useSharedValue(false);
  const crossX = useSharedValue(0); // snapped candle x, px
  const crossY = useSharedValue(0); // raw finger y, px (clamped to plot band)
  const crossIdx = useSharedValue(-1);
  const xPositionsSV = useSharedValue<number[]>([]);
  const boundsSV = useSharedValue<Bounds>({ top: 0, bottom: 0, left: 0, right: 0 });
  const priceMSV = useSharedValue(0); // price = m*y + b  (pixel→price, linear)
  const priceBSV = useSharedValue(0);

  // Plot geometry is only available inside the chart's render-prop, which runs
  // during React render — where writing to a shared value is illegal. So stash it
  // in a ref there and flush it to the shared values in a post-commit effect.
  const geomRef = useRef<{ xs: number[]; bounds: Bounds; m: number; b: number }>({
    xs: [],
    bounds: { top: 0, bottom: 0, left: 0, right: 0 },
    m: 0,
    b: 0,
  });
  useEffect(() => {
    const g = geomRef.current;
    xPositionsSV.value = g.xs;
    boundsSV.value = g.bounds;
    priceMSV.value = g.m;
    priceBSV.value = g.b;
  });

  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const onScrub = useCallback((index: number) => {
    if (index >= 0) {
      if (!pressingRef.current) {
        // Press just went down — freeze the series at this instant.
        pressingRef.current = true;
        frozenRef.current = candlesRef.current;
        setPressing(true);
      }
      setActiveIndex(index);
      Haptics.selectionAsync().catch(() => {});
    } else {
      if (pressingRef.current) {
        pressingRef.current = false;
        setPressing(false);
      }
      setActiveIndex(null);
    }
  }, []);

  // Mirror the matched candle into React state for the legend + haptics. Only the
  // index crosses to JS, so the haptic ticks per candle, not per pixel of drag.
  useAnimatedReaction(
    () => (crossActive.value ? crossIdx.value : -1),
    (cur, prev) => {
      if (cur !== prev) runOnJS(onScrub)(cur);
    },
  );

  const crossGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activateAfterLongPress(160)
      .onStart((e) => {
        'worklet';
        crossActive.value = true;
        const xs = xPositionsSV.value;
        if (xs.length > 0) {
          const idx = nearestIndex(xs, e.x);
          if (idx >= 0) {
            crossIdx.value = idx;
            crossX.value = xs[idx];
          }
        }
        const b = boundsSV.value;
        crossY.value = e.y < b.top ? b.top : e.y > b.bottom ? b.bottom : e.y;
      })
      .onUpdate((e) => {
        'worklet';
        const xs = xPositionsSV.value;
        if (xs.length > 0) {
          const idx = nearestIndex(xs, e.x);
          if (idx >= 0) {
            crossIdx.value = idx;
            crossX.value = xs[idx];
          }
        }
        const b = boundsSV.value;
        crossY.value = e.y < b.top ? b.top : e.y > b.bottom ? b.bottom : e.y;
      })
      .onFinalize(() => {
        'worklet';
        crossActive.value = false;
        crossIdx.value = -1;
      });
    // customGestures expects a ComposedGesture; Race around the single pan satisfies that.
    return Gesture.Race(pan);
    // Shared values are stable refs, so this gesture only needs to be built once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: crossActive.value ? 1 : 0,
    transform: [{ translateY: crossY.value - PRICE_PILL_H / 2 }],
  }));
  const priceProps = useAnimatedProps(
    () =>
      ({
        text: formatPriceWorklet(priceMSV.value * crossY.value + priceBSV.value, priceDecimals),
      }) as object,
    [priceDecimals],
  );

  const scrubbing = activeIndex !== null;
  const legendIndex = scrubbing ? activeIndex! : shown.length - 1;
  const legend = shown[legendIndex];

  // Period-over-period change for the highlighted candle (vs the prior close,
  // reaching into the off-screen lead for the first visible bar).
  const prevClose =
    legend != null
      ? start + legendIndex - 1 >= 0
        ? activeCandles[start + legendIndex - 1].c
        : legend.o
      : null;
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
          customGestures={crossGesture}
          transformState={transform.state}
          transformConfig={{ pan: { enabled: true }, pinch: { enabled: true } }}
          domainPadding={{ left: 8, right: 8, top: 24, bottom: 8 }}>
          {({ points, chartBounds, yScale }) => {
            // Capture plot geometry for the crosshair gesture + price pill. This runs
            // during render, so we can't touch shared values here — stash it in a ref
            // and let the post-commit effect push it onto the UI thread.
            const xs: number[] = [];
            for (let i = 0; i < points.close.length; i++) xs.push(points.close[i].x as number);
            const invert = (yScale as unknown as { invert?: (n: number) => number }).invert;
            const vTop = invert ? invert(chartBounds.top) : 0;
            const vBottom = invert ? invert(chartBounds.bottom) : 0;
            const span = chartBounds.bottom - chartBounds.top;
            const m = span !== 0 ? (vBottom - vTop) / span : 0;
            geomRef.current = {
              xs,
              bounds: {
                top: chartBounds.top,
                bottom: chartBounds.bottom,
                left: chartBounds.left,
                right: chartBounds.right,
              },
              m,
              b: vTop - m * chartBounds.top,
            };

            return (
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
                <Crosshair x={crossX} y={crossY} active={crossActive} bounds={boundsSV} />
              </>
            );
          }}
        </CartesianChart>

        <Animated.View style={[styles.pricePill, pillStyle]} pointerEvents="none">
          <AnimatedTextInput
            style={styles.pricePillText}
            editable={false}
            defaultValue=""
            animatedProps={priceProps}
            underlineColorAndroid="transparent"
          />
        </Animated.View>
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

/** TradingView-style crosshair: vertical line snapped to the candle, horizontal line at the finger. */
function Crosshair({
  x,
  y,
  active,
  bounds,
}: {
  x: SharedValue<number>;
  y: SharedValue<number>;
  active: SharedValue<boolean>;
  bounds: SharedValue<Bounds>;
}) {
  const vTop = useDerivedValue(() => vec(x.value, bounds.value.top));
  const vBottom = useDerivedValue(() => vec(x.value, bounds.value.bottom));
  const hLeft = useDerivedValue(() => vec(bounds.value.left, y.value));
  const hRight = useDerivedValue(() => vec(bounds.value.right, y.value));
  const opacity = useDerivedValue(() => (active.value ? 1 : 0));

  return (
    <Group opacity={opacity}>
      <SkiaLine p1={vTop} p2={vBottom} color={Colors.textMuted} strokeWidth={1}>
        <DashPathEffect intervals={[4, 4]} />
      </SkiaLine>
      <SkiaLine p1={hLeft} p2={hRight} color={Colors.textMuted} strokeWidth={1}>
        <DashPathEffect intervals={[4, 4]} />
      </SkiaLine>
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
  // Floating price label on the right edge that rides the horizontal crosshair.
  pricePill: {
    position: 'absolute',
    right: 0,
    top: 0,
    height: PRICE_PILL_H,
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: '#363A45',
    zIndex: 3,
  },
  pricePillText: {
    minWidth: 58,
    padding: 0,
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
