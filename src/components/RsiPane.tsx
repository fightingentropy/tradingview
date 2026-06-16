import { DashPathEffect, Line as SkiaLine, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { CartesianChart, Line, type ChartBounds, type Scale } from 'victory-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Indicators, Spacing } from '@/constants/theme';
import { rsi } from '@/domain/indicators';
import type { Candle } from '@/domain/types';

const PANE_HEIGHT = 96;

/** A compact RSI oscillator pane (0–100) with 30/70 guide lines. */
export function RsiPane({ candles, period }: { candles: Candle[]; period: number }) {
  const data = useMemo(() => {
    const values = rsi(
      candles.map((c) => c.c),
      period,
    );
    const out: { x: number; rsi: number }[] = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v != null) out.push({ x: i, rsi: v });
    }
    return out;
  }, [candles, period]);

  const last = data.length ? data[data.length - 1].rsi : null;
  const lastColor =
    last == null ? Colors.textMuted : last >= 70 ? Colors.down : last <= 30 ? Colors.up : Colors.text;

  return (
    <View style={styles.pane}>
      <View style={styles.labelRow} pointerEvents="none">
        <AppText variant="caption" muted>
          RSI {period}
        </AppText>
        <AppText variant="caption" numeric color={lastColor}>
          {last == null ? '—' : last.toFixed(1)}
        </AppText>
      </View>
      {data.length >= 2 ? (
        <CartesianChart
          data={data}
          xKey="x"
          yKeys={['rsi']}
          domain={{ y: [0, 100] }}
          domainPadding={{ left: 8, right: 8, top: 4, bottom: 4 }}>
          {({ points, chartBounds, yScale }) => (
            <>
              <RsiGuides yScale={yScale} bounds={chartBounds} />
              <Line points={points.rsi} color={Indicators.rsi} strokeWidth={1.5} curveType="linear" />
            </>
          )}
        </CartesianChart>
      ) : null}
    </View>
  );
}

function RsiGuides({ yScale, bounds }: { yScale: Scale; bounds: ChartBounds }) {
  const y70 = yScale(70);
  const y30 = yScale(30);
  return (
    <>
      <SkiaLine p1={vec(bounds.left, y70)} p2={vec(bounds.right, y70)} color={Colors.border} strokeWidth={1}>
        <DashPathEffect intervals={[3, 3]} />
      </SkiaLine>
      <SkiaLine p1={vec(bounds.left, y30)} p2={vec(bounds.right, y30)} color={Colors.border} strokeWidth={1}>
        <DashPathEffect intervals={[3, 3]} />
      </SkiaLine>
    </>
  );
}

const styles = StyleSheet.create({
  pane: { height: PANE_HEIGHT, marginTop: Spacing.xs },
  labelRow: {
    position: 'absolute',
    top: 0,
    left: Spacing.lg,
    zIndex: 2,
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
});
