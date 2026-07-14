import {
  Canvas,
  DashPathEffect,
  Group,
  Line as SkiaLine,
  type Matrix4,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
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
  formatCompact,
  formatPercent,
  formatPrice,
  formatSignedPrice,
  signedUsd,
  type AxisTickKind,
} from '@/lib/format';

export type ChartType = 'candle' | 'line';

/**
 * An open position to overlay on the chart: a horizontal entry-price line, an
 * optional liquidation line, and a compact size/unrealized-PnL tag. Structurally a
 * subset of {@link HlPosition}, so a position object passes straight through.
 */
export interface ChartPosition {
  side: 'long' | 'short';
  /** Absolute size in coins. */
  size: number;
  entryPx: number;
  liquidationPx: number | null;
  unrealizedPnl: number;
  /** Return on equity as a fraction (0.07 = +7%). */
  roe: number;
  /** Effective leverage, available to position-management surfaces. */
  leverage?: number;
  /** Fraction of the position covered by reduce-only stops. Null = not loaded. */
  stopCoverage?: number | null;
}

export type ChartOrderKind = 'take-profit' | 'stop-loss' | 'limit' | 'trigger';

/** A resting order/trigger level to draw over the price chart. */
export interface ChartOrderLevel {
  id: string | number;
  price: number;
  kind: ChartOrderKind;
  /** Compact description such as `TP`, `SL`, or `Buy limit`. */
  label: string;
  /** Remaining coin size, shown beside the label unless privacy mode is enabled. */
  size?: number;
}

/** Masked stand-in for account values when privacy mode is on. */
const POS_MASK = '••••';

/** Compact position size for the on-chart tag, e.g. `0.5`, `1250`, `1.2M`. */
function formatPositionSize(size: number): string {
  if (size >= 100_000) return formatCompact(size);
  const d = size >= 1000 ? 0 : size >= 1 ? 3 : 5;
  return String(Number(size.toFixed(d)));
}

/** Hyperliquid-style quantity: preserve useful precision but keep two decimals for whole sizes. */
function formatPositionOverlaySize(size: number): string {
  if (size >= 100_000) return formatCompact(size);
  if (size < 1) return String(Number(size.toFixed(5)));
  if (size >= 1000) return formatPrice(size, 0);

  const [whole, initialFraction = ''] = size.toFixed(3).split('.');
  let fraction = initialFraction;
  while (fraction.length > 2 && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  return `${whole}.${fraction}`;
}

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
   * Candles initially in view — the chart opens scrolled to the last N (keeps
   * them thick) via the `viewport`, and you can drag back to reveal the rest.
   */
  visibleCount?: number;
  /**
   * Candles actually rendered (visible + pannable history). Defaults to
   * `visibleCount`. Indicators are computed across the full lead-included series,
   * so SMA 200 keeps drawing even on the oldest rendered bars.
   */
  renderCount?: number;
  /** Time-axis label granularity for the visible range (hours, days, …). */
  axisKind?: AxisTickKind;
  /** Open position to overlay (entry/liq lines + PnL tag). Null = nothing to show. */
  position?: ChartPosition | null;
  /** Resting TP/SL and limit-order levels to overlay. */
  orderLevels?: readonly ChartOrderLevel[];
  /** Ticker for the position tag, e.g. `BTC`. */
  symbol?: string;
  /** Privacy mode: mask the position's size + PnL (price levels stay visible). */
  hideValues?: boolean;
  /** Opens the position-management surface when the on-chart position tag is tapped. */
  onPositionPress?: () => void;
}

/** Height of the position tag chip riding the entry-price line. */
const POS_TAG_H = 20;

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
  renderCount,
  axisKind,
  position = null,
  orderLevels = [],
  symbol,
  hideValues = false,
  onPositionPress,
}: Props) {
  // While a finger is pressing the chart, hold the candle series steady so live
  // websocket ticks can't shift the bar under the crosshair (or reset gestures).
  const [pressing, setPressing] = useState(false);
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const frozenRef = useRef<Candle[]>(candles);
  const pressingRef = useRef(false);
  const activeCandles = pressing ? frozenRef.current : candles;

  // Render `renderCount` candles (visible window + pannable history); everything
  // before `start` stays off-screen as moving-average lead.
  const renderWindow = renderCount ?? visibleCount;
  const start =
    renderWindow != null ? Math.max(0, activeCandles.length - renderWindow) : 0;
  const shown = useMemo(() => activeCandles.slice(start), [activeCandles, start]);

  const data = useMemo<ChartDatum[]>(
    () => shown.map((c, i) => ({ x: i, open: c.o, high: c.h, low: c.l, close: c.c })),
    [shown],
  );

  const R = shown.length;

  // Which candles are on screen, as `[lo, hi]` indices into `shown`. A pan updates
  // this (via the reaction below) so the y-scale and time labels follow the scroll;
  // null means "not panned" and falls back to the opening viewport window.
  const [visWin, setVisWin] = useState<[number, number] | null>(null);
  const winLo = visWin
    ? Math.max(0, Math.min(visWin[0], R - 1))
    : visibleCount != null
      ? Math.max(0, R - visibleCount)
      : 0;
  const winHi = visWin ? Math.max(winLo, Math.min(visWin[1], R - 1)) : Math.max(0, R - 1);

  // Open scrolled to the last `visibleCount` candles; the rest of `data` extends
  // to the left so a horizontal drag pans back through history (see transformConfig).
  const viewport = useMemo<{ x: [number, number] } | undefined>(() => {
    if (visibleCount == null || shown.length <= visibleCount) return undefined;
    return { x: [shown.length - visibleCount, shown.length - 1] };
  }, [shown.length, visibleCount]);
  // Scale the price axis to the candles *currently on screen*. Account overlays
  // stay out of the domain so a distant entry, liquidation price, target, or stop
  // cannot flatten the candles; off-screen labels pin to the nearest chart edge.
  const yDomain = useMemo<[number, number] | undefined>(() => {
    if (R === 0) return undefined;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = winLo; i <= winHi; i++) {
      const c = shown[i];
      if (!c) continue;
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.01 || 1;
    return [lo - pad, hi + pad];
  }, [shown, winLo, winHi, R]);

  // Evenly spaced time labels sampled across the on-screen window, so they track
  // the candles as you pan back through history.
  const axisTicks = useMemo(() => {
    if (!axisKind || winHi - winLo < 1) return [];
    const span = winHi - winLo;
    return Array.from({ length: AXIS_TICKS }, (_, k) => {
      const idx = winLo + Math.round((k / (AXIS_TICKS - 1)) * span);
      const c = shown[idx];
      return c ? formatChartAxisLabel(c.t, axisKind) : '';
    });
  }, [shown, axisKind, winLo, winHi]);

  // SMA over the full series (including the off-screen lead), then sliced to the
  // visible window so a 200-period line still renders on a short range.
  //
  // The websocket swaps `activeCandles` for a new array every tick, but the SMA
  // only moves when the bar count or the latest close changes. Key the memo on a
  // stable signature (length + last close/timestamp + periods + start) so an
  // identity-only change skips the ~400-bar-per-period recompute.
  const lastClose = activeCandles.length ? activeCandles[activeCandles.length - 1].c : null;
  const lastStamp = activeCandles.length ? activeCandles[activeCandles.length - 1].t : null;
  const smaKey = smaPeriods.join(',');
  const smaSeries = useMemo(() => {
    const closes = activeCandles.map((c) => c.c);
    const out: Record<number, (number | null)[]> = {};
    for (const p of smaPeriods) out[p] = sma(closes, p).slice(start);
    return out;
    // `activeCandles` identity churns every tick; the signature below captures
    // every input that actually changes the computed series.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCandles.length, lastClose, lastStamp, smaKey, start]);

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
  // Last on-screen window pushed to JS, so the pan reaction only re-renders when
  // a candle actually enters or leaves the view (not every pixel of the drag).
  const lastLoSV = useSharedValue(-1);
  const lastHiSV = useSharedValue(-1);

  // Plot geometry is only available inside the chart's render-prop, which runs
  // during React render — where writing to a shared value is illegal. So stash it
  // in a ref there and flush it to the shared values in a post-commit effect.
  // `sig` is a cheap signature of the geometry (set in the render-prop) so the
  // effect can skip the four shared-value writes when nothing moved — otherwise a
  // live-tick re-render would re-push identical geometry onto the UI thread.
  const geomRef = useRef<{ xs: number[]; bounds: Bounds; m: number; b: number; sig: string }>({
    xs: [],
    bounds: { top: 0, bottom: 0, left: 0, right: 0 },
    m: 0,
    b: 0,
    sig: '',
  });
  const flushedSigRef = useRef('');
  useEffect(() => {
    const g = geomRef.current;
    if (g.sig === flushedSigRef.current) return;
    flushedSigRef.current = g.sig;
    xPositionsSV.value = g.xs;
    boundsSV.value = g.bounds;
    priceMSV.value = g.m;
    priceBSV.value = g.b;
  });

  // As the chart pans, work out which candle indices are on screen (undo the
  // matrix's x-translate/scale over the pre-transform candle positions) and push
  // the window to JS — but only when it changes by a whole candle, so the y-scale
  // and time labels refit per bar without re-rendering on every frame.
  useAnimatedReaction(
    () => {
      const m = transform.state.matrix.value;
      return { tx: m ? (m[3] ?? 0) : 0, sx: m && m[0] ? m[0] : 1 };
    },
    ({ tx, sx }) => {
      const xs = xPositionsSV.value;
      const b = boundsSV.value;
      const n = xs.length;
      if (n === 0) return;
      const loX = (b.left - tx) / sx;
      const hiX = (b.right - tx) / sx;
      let lo = -1;
      let hi = -1;
      for (let i = 0; i < n; i++) {
        if (xs[i] >= loX && xs[i] <= hiX) {
          if (lo < 0) lo = i;
          hi = i;
        }
      }
      if (lo < 0) {
        lo = 0;
        hi = n - 1;
      }
      // Pad by a bar each side so an edge candle's wick still counts toward the range.
      if (lo > 0) lo -= 1;
      if (hi < n - 1) hi += 1;
      if (lo !== lastLoSV.value || hi !== lastHiSV.value) {
        lastLoSV.value = lo;
        lastHiSV.value = hi;
        runOnJS(setVisWin)([lo, hi]);
      }
    },
  );

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

  // Map a finger point to the crosshair: snap x to the nearest candle and track y
  // freely. Candle x-positions are pre-transform, so undo the pan's x-translate
  // (matrix[3]) / x-scale (matrix[0]) before snapping — keeps the crosshair on the
  // right bar after the chart has been dragged back through history.
  const applyTouch = (px: number, py: number) => {
    'worklet';
    const m = transform.state.matrix.value;
    const tx = m ? (m[3] ?? 0) : 0;
    const sx = m && m[0] ? m[0] : 1;
    const xs = xPositionsSV.value;
    if (xs.length > 0) {
      const idx = nearestIndex(xs, (px - tx) / sx);
      if (idx >= 0) {
        crossIdx.value = idx;
        crossX.value = xs[idx];
      }
    }
    const b = boundsSV.value;
    crossY.value = py < b.top ? b.top : py > b.bottom ? b.bottom : py;
  };

  const crossGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activateAfterLongPress(160)
      .onStart((e) => {
        'worklet';
        crossActive.value = true;
        applyTouch(e.x, e.y);
      })
      .onUpdate((e) => {
        'worklet';
        applyTouch(e.x, e.y);
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
          viewport={viewport}
          customGestures={crossGesture}
          transformState={transform.state}
          // Horizontal-only pan = scroll back through history; no pinch zoom (the
          // date-range buttons set the zoom level, and x-only keeps the crosshair
          // math to a single translate).
          transformConfig={{ pan: { enabled: true, dimensions: 'x' }, pinch: { enabled: false } }}
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
            const b = vTop - m * chartBounds.top;
            // Candle x-positions move together under pan (the matrix translate is
            // applied separately), so count + endpoints capture any geometry change;
            // bounds + the pixel→price coefficients cover the y-scale refit.
            const sig =
              `${xs.length}|${xs[0] ?? 0}|${xs[xs.length - 1] ?? 0}|` +
              `${chartBounds.top}|${chartBounds.bottom}|${chartBounds.left}|${chartBounds.right}|${m}|${b}`;
            geomRef.current = {
              xs,
              bounds: {
                top: chartBounds.top,
                bottom: chartBounds.bottom,
                left: chartBounds.left,
                right: chartBounds.right,
              },
              m,
              b,
              sig,
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
                    // Size bars to the visible window, not the full rendered set —
                    // otherwise victory divides the width by all the (mostly
                    // off-screen) history candles and draws them hair-thin.
                    candleCount={visibleCount}
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
                <Crosshair
                  x={crossX}
                  y={crossY}
                  active={crossActive}
                  bounds={boundsSV}
                  matrix={transform.state.matrix}
                />
              </>
            );
          }}
        </CartesianChart>

        {position ? (
          <PositionOverlay
            position={position}
            priceDecimals={priceDecimals}
            hideValues={hideValues}
            priceM={priceMSV}
            priceB={priceBSV}
            bounds={boundsSV}
            onPress={onPositionPress}
          />
        ) : null}

        {orderLevels.length > 0 ? (
          <OrderLevelsOverlay
            levels={orderLevels}
            symbol={symbol ?? ''}
            priceDecimals={priceDecimals}
            hideValues={hideValues}
            priceM={priceMSV}
            priceB={priceBSV}
            bounds={boundsSV}
          />
        ) : null}

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

/** True when two pixel-position arrays describe the same plot geometry. */
function sameXs(a: { x: number }[], b: { x: number }[]): boolean {
  // Candle x-positions translate together under pan (the matrix moves them as a
  // group), so length + endpoints uniquely identify the layout without an O(n) scan.
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  return a[0].x === b[0].x && a[a.length - 1].x === b[a.length - 1].x;
}

/** True when two chart-bounds rects are identical. */
function sameBounds(a: ChartBounds, b: ChartBounds): boolean {
  return a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

/** Volume bars packed into a band along the bottom of the price area. */
const VolumeBars = memo(function VolumeBars({
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
},
// victory hands us fresh `xs`/`bounds` objects every render; skip the re-tessellation
// unless the data (candles), pixel layout, band, or max volume actually changed.
(prev, next) =>
  prev.candles === next.candles &&
  prev.max === next.max &&
  sameBounds(prev.bounds, next.bounds) &&
  sameXs(prev.xs, next.xs));

/** A single simple-moving-average overlay line, scaled onto the price axis. */
const SmaLine = memo(function SmaLine({
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
},
// `values` is referentially stable (memoized upstream), so an identity check tells
// us whether the SMA data moved. victory recreates `xs`/`bounds`/`yScale` each
// render; probe the scale at two points to catch a y-domain refit, and compare the
// pixel layout by content — so a crosshair/legend re-render doesn't redraw the line.
(prev, next) =>
  prev.values === next.values &&
  prev.color === next.color &&
  sameBounds(prev.bounds, next.bounds) &&
  sameXs(prev.xs, next.xs) &&
  prev.yScale(0) === next.yScale(0) &&
  prev.yScale(1) === next.yScale(1));

/**
 * TradingView-style crosshair: vertical line snapped to the candle, horizontal
 * line tracking the finger. It's drawn inside the chart's pan-transformed group,
 * so the vertical line (at a candle's pre-transform x) rides along when you pan,
 * while the horizontal line undoes the x-translate so it always spans full width.
 */
function Crosshair({
  x,
  y,
  active,
  bounds,
  matrix,
}: {
  x: SharedValue<number>;
  y: SharedValue<number>;
  active: SharedValue<boolean>;
  bounds: SharedValue<Bounds>;
  matrix: SharedValue<Matrix4>;
}) {
  const tx = useDerivedValue(() => {
    const m = matrix.value;
    return m ? (m[3] ?? 0) : 0;
  });
  const vTop = useDerivedValue(() => vec(x.value, bounds.value.top));
  const vBottom = useDerivedValue(() => vec(x.value, bounds.value.bottom));
  const hLeft = useDerivedValue(() => vec(bounds.value.left - tx.value, y.value));
  const hRight = useDerivedValue(() => vec(bounds.value.right - tx.value, y.value));
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

function PositionGuideLines({
  entryY,
  liquidationY,
  hasLiquidation,
  entryColor,
  bounds,
}: {
  entryY: SharedValue<number>;
  liquidationY: SharedValue<number>;
  hasLiquidation: boolean;
  entryColor: string;
  bounds: SharedValue<Bounds>;
}) {
  const entryStart = useDerivedValue(() => vec(bounds.value.left, entryY.value));
  const entryEnd = useDerivedValue(() => vec(bounds.value.right, entryY.value));
  const entryOpacity = useDerivedValue(() => {
    const y = entryY.value;
    const b = bounds.value;
    return Number.isFinite(y) && y >= b.top && y <= b.bottom ? 0.88 : 0;
  });
  const liquidationStart = useDerivedValue(() =>
    vec(bounds.value.left, liquidationY.value),
  );
  const liquidationEnd = useDerivedValue(() =>
    vec(bounds.value.right, liquidationY.value),
  );
  const liquidationOpacity = useDerivedValue(() => {
    const y = liquidationY.value;
    const b = bounds.value;
    return Number.isFinite(y) && y >= b.top && y <= b.bottom ? 0.7 : 0;
  });

  return (
    <Canvas style={styles.positionGuideCanvas} pointerEvents="none">
      <Group opacity={entryOpacity}>
        <SkiaLine
          p1={entryStart}
          p2={entryEnd}
          color={entryColor}
          strokeWidth={1.5}
          strokeCap="round">
          <DashPathEffect intervals={[1, 5]} />
        </SkiaLine>
      </Group>
      {hasLiquidation ? (
        <Group opacity={liquidationOpacity}>
          <SkiaLine
            p1={liquidationStart}
            p2={liquidationEnd}
            color={Colors.warning}
            strokeWidth={1}>
            <DashPathEffect intervals={[5, 4]} />
          </SkiaLine>
        </Group>
      ) : null}
    </Canvas>
  );
}

/**
 * Overlays an open position on the price area: a dotted horizontal entry line
 * spanning the full width, an optional liquidation line, a compact PnL/size tag,
 * and right-edge price tags. Everything rides the
 * existing pixel↔price coefficients (`price = m·y + b`, inverted to `y = (price − b)/m`),
 * so the lines track the y-scale as it refits on pan — no chart-geometry changes.
 * A line whose price is off the visible band fades out while its label pins to the
 * nearest edge, preserving both candle scale and access to position management.
 */
function PositionOverlay({
  position,
  priceDecimals,
  hideValues,
  priceM,
  priceB,
  bounds,
  onPress,
}: {
  position: ChartPosition;
  priceDecimals: number;
  hideValues: boolean;
  priceM: SharedValue<number>;
  priceB: SharedValue<number>;
  bounds: SharedValue<Bounds>;
  onPress?: () => void;
}) {
  const pnlColor = position.unrealizedPnl >= 0 ? Colors.up : Colors.down;
  const hasLiq = position.liquidationPx != null;

  // Pixel y for a price, or NaN before the first geometry flush (m === 0).
  const yForPrice = (price: number, m: number, b: number) => {
    'worklet';
    return m ? (price - b) / m : Number.NaN;
  };
  const entryY = useDerivedValue(() => yForPrice(position.entryPx, priceM.value, priceB.value));
  const liqY = useDerivedValue(() =>
    hasLiq ? yForPrice(position.liquidationPx as number, priceM.value, priceB.value) : Number.NaN,
  );

  // Lines are visible only while their price sits inside the plot band. The entry
  // tag stays visible and pins to the closest edge, so a distant winning position
  // never crushes the candle scale or loses its management control.
  const entryTagStyle = useAnimatedStyle(() => {
    const v = entryY.value;
    const b = bounds.value;
    const ready = b.bottom > b.top && Number.isFinite(v);
    const clamped = ready
      ? Math.max(b.top + POS_TAG_H / 2, Math.min(b.bottom - POS_TAG_H / 2, v))
      : POS_TAG_H / 2;
    return { opacity: ready ? 1 : 0, transform: [{ translateY: clamped - POS_TAG_H / 2 }] };
  });
  const liqTagStyle = useAnimatedStyle(() => {
    const v = liqY.value;
    const b = bounds.value;
    const on = Number.isFinite(v) && v >= b.top && v <= b.bottom;
    return { opacity: on ? 1 : 0, transform: [{ translateY: (Number.isFinite(v) ? v : 0) - POS_TAG_H / 2 }] };
  });

  const sizeText = hideValues ? POS_MASK : formatPositionOverlaySize(position.size);
  const pnlText = hideValues ? POS_MASK : signedUsd(position.unrealizedPnl);

  return (
    <>
      <PositionGuideLines
        entryY={entryY}
        liquidationY={liqY}
        hasLiquidation={hasLiq}
        entryColor={pnlColor}
        bounds={bounds}
      />

      {/* Hyperliquid-style inline tag: only PnL and size at the actual entry price. */}
      <Animated.View
        style={[styles.posTag, styles.posTagLeft, { borderColor: pnlColor }, entryTagStyle]}
        pointerEvents={onPress ? 'auto' : 'none'}>
        <Pressable
          style={({ pressed }) => [styles.posTagContent, pressed && styles.posTagPressed]}
          disabled={!onPress}
          onPress={onPress}
          hitSlop={12}
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={onPress ? `Manage ${position.side} position` : undefined}>
          <View style={[styles.posPnlSegment, { backgroundColor: `${pnlColor}24` }]}>
            <AppText
              variant="caption"
              color={pnlColor}
              numeric
              numberOfLines={1}
              ellipsizeMode="clip"
              style={styles.posPnlText}>
              PNL {pnlText}
            </AppText>
          </View>
          <View style={styles.posSizeSegment}>
            <AppText variant="caption" numeric numberOfLines={1} style={styles.posSizeText}>
              {sizeText}
            </AppText>
          </View>
        </Pressable>
      </Animated.View>

      {/* Right (axis-side) price tags — price levels, shown even in privacy mode. */}
      <Animated.View
        style={[styles.posPriceTag, { backgroundColor: pnlColor }, entryTagStyle]}
        pointerEvents="none">
        <AppText variant="caption" color="#FFFFFF" numeric>
          {formatPrice(position.entryPx, priceDecimals)}
        </AppText>
      </Animated.View>
      {hasLiq ? (
        <Animated.View
          style={[styles.posPriceTag, styles.posLiqTag, liqTagStyle]}
          pointerEvents="none">
          <AppText variant="caption" color="#FFFFFF" numeric>
            Liq {formatPrice(position.liquidationPx, priceDecimals)}
          </AppText>
        </Animated.View>
      ) : null}
    </>
  );
}

/** Draw working order levels only at their real price. If a stop, target, or
 * limit sits outside the visible price range, both its line and label disappear
 * instead of pinning to an edge and implying a false on-screen level. */
function OrderLevelsOverlay({
  levels,
  symbol,
  priceDecimals,
  hideValues,
  priceM,
  priceB,
  bounds,
}: {
  levels: readonly ChartOrderLevel[];
  symbol: string;
  priceDecimals: number;
  hideValues: boolean;
  priceM: SharedValue<number>;
  priceB: SharedValue<number>;
  bounds: SharedValue<Bounds>;
}) {
  return (
    <>
      {levels.map((level) => (
        <OrderLevelOverlay
          key={String(level.id)}
          level={level}
          symbol={symbol}
          priceDecimals={priceDecimals}
          hideValues={hideValues}
          priceM={priceM}
          priceB={priceB}
          bounds={bounds}
        />
      ))}
    </>
  );
}

function OrderLevelOverlay({
  level,
  symbol,
  priceDecimals,
  hideValues,
  priceM,
  priceB,
  bounds,
}: {
  level: ChartOrderLevel;
  symbol: string;
  priceDecimals: number;
  hideValues: boolean;
  priceM: SharedValue<number>;
  priceB: SharedValue<number>;
  bounds: SharedValue<Bounds>;
}) {
  const color =
    level.kind === 'take-profit'
      ? Colors.up
      : level.kind === 'stop-loss'
        ? Colors.down
        : level.kind === 'trigger'
          ? Colors.warning
          : Colors.accent;
  const rawY = useDerivedValue(() =>
    priceM.value ? (level.price - priceB.value) / priceM.value : Number.NaN,
  );
  const lineStyle = useAnimatedStyle(() => {
    const y = rawY.value;
    const b = bounds.value;
    const ready = b.bottom > b.top && Number.isFinite(y);
    const inside = ready && y >= b.top && y <= b.bottom;
    return { opacity: inside ? 0.78 : 0, transform: [{ translateY: ready ? y : 0 }] };
  });
  const tagStyle = useAnimatedStyle(() => {
    const y = rawY.value;
    const b = bounds.value;
    const ready = b.bottom > b.top && Number.isFinite(y);
    const inside = ready && y >= b.top && y <= b.bottom;
    return {
      opacity: inside ? 1 : 0,
      transform: [{ translateY: (ready ? y : POS_TAG_H / 2) - POS_TAG_H / 2 }],
    };
  });
  const sizeText =
    level.size == null
      ? ''
      : hideValues
        ? ` ${POS_MASK}`
        : ` ${formatPositionSize(level.size)} ${symbol}`.trimEnd();

  return (
    <>
      <Animated.View
        style={[
          styles.orderLevelLine,
          { borderTopColor: color, borderStyle: level.kind === 'limit' ? 'dotted' : 'dashed' },
          lineStyle,
        ]}
        pointerEvents="none"
      />
      <Animated.View
        style={[styles.orderTag, styles.orderTagLeft, { borderColor: color }, tagStyle]}
        pointerEvents="none">
        <AppText variant="caption" color={color} numeric numberOfLines={1}>
          {level.label}{sizeText}
        </AppText>
      </Animated.View>
      <Animated.View
        style={[styles.orderPriceTag, { backgroundColor: color }, tagStyle]}
        pointerEvents="none">
        <AppText variant="caption" color={level.kind === 'take-profit' || level.kind === 'limit' ? '#04150E' : '#FFFFFF'} numeric>
          {formatPrice(level.price, priceDecimals)}
        </AppText>
      </Animated.View>
    </>
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
    zIndex: 7,
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
  // Native-drawn position/liquidation guides; kept below their endpoint tags.
  positionGuideCanvas: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 2,
  },
  // Compact Hyperliquid-style position chip riding the dotted entry line.
  posTag: {
    position: 'absolute',
    top: 0,
    height: POS_TAG_H,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: Colors.surfaceAlt,
    overflow: 'hidden',
    zIndex: 6,
  },
  posTagLeft: { left: Spacing.sm, maxWidth: '58%' },
  posTagContent: {
    height: POS_TAG_H - StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  posTagPressed: { backgroundColor: Colors.surfacePress },
  posPnlSegment: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: 6,
    flexShrink: 1,
  },
  posSizeSegment: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: Colors.border,
  },
  posSizeText: { color: Colors.text, flexShrink: 0 },
  // PnL yields first on narrow charts; the exact position size remains visible.
  posPnlText: { flexShrink: 1, fontWeight: '600' },
  // Right (axis-side) price tag — the entry/liq price level.
  posPriceTag: {
    position: 'absolute',
    right: 0,
    top: 0,
    height: POS_TAG_H,
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: 4,
    zIndex: 6,
  },
  posLiqTag: { backgroundColor: Colors.warning },
  orderLevelLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 0,
    borderTopWidth: 1,
    zIndex: 2,
  },
  orderTag: {
    position: 'absolute',
    top: 0,
    height: POS_TAG_H,
    maxWidth: '58%',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: Colors.surfaceAlt,
    zIndex: 4,
  },
  orderTagLeft: { left: Spacing.sm },
  orderPriceTag: {
    position: 'absolute',
    right: 0,
    top: 0,
    height: POS_TAG_H,
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: 4,
    zIndex: 4,
  },
});
