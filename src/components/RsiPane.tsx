import { DashPathEffect, Group, Line as SkiaLine, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { CartesianChart, Line, type ChartBounds, type Scale, type useChartTransformState } from 'victory-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Indicators, Spacing } from '@/constants/theme';
import { rsi } from '@/domain/indicators';
import type { Candle } from '@/domain/types';

type ChartTransform = ReturnType<typeof useChartTransformState>['state'];
const PANE_HEIGHT = 96;

/** Uses the price chart's rendered bars and transform, with full indicator lead-in. */
export function RsiPane({ candles, period, startIndex, viewport, transformState, activeIndex, crossX, crossActive }: {
  candles: Candle[];
  period: number;
  startIndex: number;
  viewport?: { x: [number, number] };
  transformState: ChartTransform;
  activeIndex: number | null;
  crossX: SharedValue<number>;
  crossActive: SharedValue<boolean>;
}) {
  // Historical closes can change during reconnect recovery; array identity is
  // intentional, so an unchanged last bar cannot hide a repaired RSI history.
  const values = useMemo(() => rsi(candles.map((candle) => candle.c), period), [candles, period]);
  const data = useMemo(() => values.slice(startIndex).map((value, index) => ({ x: index, rsi: value })), [values, startIndex]);
  const value = values[activeIndex ?? values.length - 1] ?? null;
  const color = value == null ? Colors.textMuted : value >= 70 ? Colors.down : value <= 30 ? Colors.up : Colors.text;

  return (
    <View style={styles.pane} pointerEvents="none">
      <View style={styles.labelRow}>
        <AppText variant="caption" muted>RSI {period}</AppText>
        <AppText variant="caption" numeric color={color}>{value == null ? '—' : value.toFixed(1)}</AppText>
      </View>
      {data.length >= 2 ? (
        <CartesianChart
          data={data}
          xKey="x"
          yKeys={['rsi']}
          domain={{ x: [0, data.length - 1], y: [0, 100] }}
          viewport={viewport}
          transformState={transformState}
          transformConfig={{ pan: { enabled: false }, pinch: { enabled: false } }}
          domainPadding={{ left: 8, right: 8, top: 22, bottom: 4 }}>
          {({ points, chartBounds, yScale }) => (
            <>
              <RsiGuides yScale={yScale} bounds={chartBounds} matrix={transformState.matrix} />
              <Line points={points.rsi} color={Indicators.rsi} strokeWidth={1.5} curveType="linear" />
              <RsiCrosshair x={crossX} active={crossActive} bounds={chartBounds} />
            </>
          )}
        </CartesianChart>
      ) : null}
    </View>
  );
}

function RsiGuides({ yScale, bounds, matrix }: { yScale: Scale; bounds: ChartBounds; matrix: ChartTransform['matrix'] }) {
  const y70 = yScale(70);
  const y30 = yScale(30);
  const left70 = useDerivedValue(() => vec(bounds.left - (matrix.value[3] ?? 0), y70));
  const right70 = useDerivedValue(() => vec(bounds.right - (matrix.value[3] ?? 0), y70));
  const left30 = useDerivedValue(() => vec(bounds.left - (matrix.value[3] ?? 0), y30));
  const right30 = useDerivedValue(() => vec(bounds.right - (matrix.value[3] ?? 0), y30));
  return (
    <>
      <SkiaLine p1={left70} p2={right70} color={Colors.border} strokeWidth={1}><DashPathEffect intervals={[3, 3]} /></SkiaLine>
      <SkiaLine p1={left30} p2={right30} color={Colors.border} strokeWidth={1}><DashPathEffect intervals={[3, 3]} /></SkiaLine>
    </>
  );
}

function RsiCrosshair({ x, active, bounds }: { x: SharedValue<number>; active: SharedValue<boolean>; bounds: ChartBounds }) {
  const top = useDerivedValue(() => vec(x.value, bounds.top));
  const bottom = useDerivedValue(() => vec(x.value, bounds.bottom));
  const opacity = useDerivedValue(() => active.value ? 1 : 0);
  return <Group opacity={opacity}><SkiaLine p1={top} p2={bottom} color={Colors.textMuted} strokeWidth={1}><DashPathEffect intervals={[4, 4]} /></SkiaLine></Group>;
}

const styles = StyleSheet.create({
  pane: { height: PANE_HEIGHT, marginTop: Spacing.xs },
  labelRow: { position: 'absolute', top: 0, left: Spacing.lg, zIndex: 2, flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
});
