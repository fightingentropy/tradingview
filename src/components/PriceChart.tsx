import {
  Circle,
  DashPathEffect,
  Group,
  Line as SkiaLine,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
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
import { formatPrice } from '@/lib/format';

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
}

const smaColor = (period: number) => Indicators.sma[period] ?? Colors.textMuted;

export function PriceChart({
  candles,
  priceDecimals,
  type,
  smaPeriods = [],
  showVolume = false,
}: Props) {
  const data = useMemo<ChartDatum[]>(
    () => candles.map((c, i) => ({ x: i, open: c.o, high: c.h, low: c.l, close: c.c })),
    [candles],
  );

  const smaSeries = useMemo(() => {
    const closes = candles.map((c) => c.c);
    const out: Record<number, (number | null)[]> = {};
    for (const p of smaPeriods) out[p] = sma(closes, p);
    return out;
  }, [candles, smaPeriods]);

  const volMax = useMemo(
    () => (showVolume ? candles.reduce((m, c) => Math.max(m, c.v), 0) : 0),
    [candles, showVolume],
  );

  const { state } = useChartPressState({ x: 0, y: { open: 0, high: 0, low: 0, close: 0 } });
  const pressState = state as unknown as PressState;
  const transform = useChartTransformState();

  // Mirror the crosshair's matched index into React state for the OHLC legend.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  useAnimatedReaction(
    () => (state.isActive.value ? state.matchedIndex.value : -1),
    (cur, prev) => {
      if (cur !== prev) runOnJS(setActiveIndex)(cur >= 0 ? cur : null);
    },
  );

  const legendIndex = activeIndex !== null ? activeIndex : candles.length - 1;
  const legend = candles[legendIndex];

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
        </View>
      ) : null}

      <CartesianChart
        data={data}
        xKey="x"
        yKeys={['high', 'low', 'open', 'close']}
        chartPressState={pressState}
        transformState={transform.state}
        transformConfig={{ pan: { enabled: true }, pinch: { enabled: true } }}
        domainPadding={{ left: 8, right: 8, top: 24, bottom: 8 }}>
        {({ points, chartBounds, yScale }) => (
          <>
            {showVolume ? (
              <VolumeBars candles={candles} xs={points.close} bounds={chartBounds} max={volMax} />
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
                color={smaColor(p)}
              />
            ))}
            <Crosshair state={pressState} bounds={chartBounds} />
          </>
        )}
      </CartesianChart>
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
  color,
}: {
  values: (number | null)[];
  xs: { x: number }[];
  yScale: (v: number) => number;
  color: string;
}) {
  const path = Skia.Path.Make();
  let started = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const px = xs[i]?.x;
    if (v == null || px == null) continue;
    const y = yScale(v);
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
  legend: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.lg,
    zIndex: 2,
    gap: 2,
  },
  legendRow: { flexDirection: 'row', gap: Spacing.md },
  ohlcItem: { flexDirection: 'row', gap: 4, alignItems: 'center' },
});
