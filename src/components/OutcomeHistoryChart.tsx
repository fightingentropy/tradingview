import { Canvas, Line as SkiaLine, Path, Skia, vec } from '@shopify/react-native-skia';
import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { CandleInterval, Instrument } from '@/domain/types';
import { queryKeys } from '@/lib/queryKeys';
import { getProvider } from '@/providers/registry';

export const OUTCOME_SERIES_COLORS = ['#53D8C7', '#5B8CFF', '#F4B860', '#D978F0', '#FF718B'];

type RangeKey = '1H' | '1D' | '1W' | 'All';

const RANGES: Record<RangeKey, { interval: CandleInterval; count: number }> = {
  '1H': { interval: '1m', count: 60 },
  '1D': { interval: '15m', count: 96 },
  '1W': { interval: '2h', count: 84 },
  All: { interval: '1d', count: 365 },
};

interface ChartChoice {
  label: string;
  instrument: Instrument;
}

export function OutcomeHistoryChart({ choices }: { choices: ChartChoice[] }) {
  const [range, setRange] = useState<RangeKey>('1D');
  const [width, setWidth] = useState(0);
  const config = RANGES[range];
  const queries = useQueries({
    queries: choices.map(({ instrument }) => ({
      queryKey: queryKeys.candles(instrument.id, config.interval, config.count),
      queryFn: () => {
        const provider = getProvider(instrument.source);
        if (!provider) throw new Error(`No provider for ${instrument.source}`);
        return provider.getCandles(instrument, config.interval, config.count);
      },
      staleTime: 20_000,
    })),
  });

  const chartHeight = 208;
  const plotWidth = Math.max(0, width - 42);
  const paths = queries.map((query) => {
    const candles = query.data ?? [];
    if (!candles.length || plotWidth <= 0) return null;
    const first = candles[0]?.t ?? 0;
    const last = candles.at(-1)?.t ?? first;
    const duration = Math.max(1, last - first);
    const path = Skia.Path.Make();
    candles.forEach((candle, index) => {
      const x = 5 + ((candle.t - first) / duration) * (plotWidth - 10);
      const chance = Math.max(0, Math.min(1, candle.c));
      const y = 8 + (1 - chance) * (chartHeight - 16);
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    return path;
  });

  const loading = queries.some((query) => query.isLoading);
  const hasHistory = paths.some(Boolean);

  return (
    <View>
      <View style={styles.rangeRow}>
        {Object.keys(RANGES).map((key) => {
          const item = key as RangeKey;
          const active = item === range;
          return (
            <Pressable
              key={item}
              onPress={() => setRange(item)}
              style={[styles.rangeButton, active && styles.rangeButtonActive]}>
              <AppText style={[styles.rangeLabel, active && styles.rangeLabelActive]}>
                {item}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.chart} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Canvas style={StyleSheet.absoluteFill}>
            {[0.25, 0.5, 0.75].map((tick) => {
              const y = 8 + (1 - tick) * (chartHeight - 16);
              return (
                <SkiaLine
                  key={tick}
                  p1={vec(5, y)}
                  p2={vec(plotWidth, y)}
                  color="rgba(255,255,255,0.09)"
                  strokeWidth={1}
                />
              );
            })}
            {paths.map((path, index) =>
              path ? (
                <Path
                  key={choices[index]?.instrument.id ?? index}
                  path={path}
                  style="stroke"
                  strokeWidth={2.4}
                  color={OUTCOME_SERIES_COLORS[index % OUTCOME_SERIES_COLORS.length]}
                />
              ) : null,
            )}
          </Canvas>
        ) : null}

        {[75, 50, 25].map((tick) => (
          <AppText
            key={tick}
            numeric
            style={[styles.axisLabel, { top: 8 + (1 - tick / 100) * (chartHeight - 16) - 7 }]}>
            {tick}%
          </AppText>
        ))}

        {loading && !hasHistory ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : !hasHistory ? (
          <View style={styles.center}>
            <AppText variant="caption" muted>Probability history is not available yet.</AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rangeRow: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  rangeButton: {
    minWidth: 42,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  rangeButtonActive: { backgroundColor: 'rgba(255,255,255,0.13)' },
  rangeLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: '600' },
  rangeLabelActive: { color: Colors.text },
  chart: {
    height: 208,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  axisLabel: {
    position: 'absolute',
    right: 4,
    width: 34,
    textAlign: 'right',
    color: Colors.textFaint,
    fontSize: 10,
  },
  center: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
});
