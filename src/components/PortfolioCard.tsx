import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EquityCurve } from '@/components/EquityCurve';
import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useHlPortfolio } from '@/data/useHlAccount';
import { formatPercent, signedUsd } from '@/lib/format';
import type { HlPortfolioPeriodKey, HlPortfolioPoint } from '@/lib/hyperliquid/info';

const PERIODS: { key: HlPortfolioPeriodKey; label: string }[] = [
  { key: 'day', label: '1D' },
  { key: 'week', label: '1W' },
  { key: 'month', label: '1M' },
  { key: 'allTime', label: 'All' },
];

/** Largest peak-to-trough drop over the window, as a positive percent. */
function maxDrawdownPct(points: HlPortfolioPoint[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const { v } of points) {
    if (v > peak) peak = v;
    if (peak > 0) mdd = Math.max(mdd, (peak - v) / peak);
  }
  return mdd * 100;
}

/**
 * Portfolio overview card: an account-value sparkline over a selectable window plus the
 * period change and max drawdown. Sourced from Hyperliquid's own `portfolio` series, so
 * the latest point lines up with the "Account Value" shown above it.
 */
export function PortfolioCard({ hidden }: { hidden: boolean }) {
  const { data } = useHlPortfolio();
  const [period, setPeriod] = useState<HlPortfolioPeriodKey>('week');
  const points = data?.[period]?.accountValue ?? [];

  const stats = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0].v;
    const last = points[points.length - 1].v;
    const change = last - first;
    return {
      change,
      pct: first !== 0 ? (change / first) * 100 : 0,
      mdd: maxDrawdownPct(points),
      up: change >= 0,
    };
  }, [points]);

  // Nothing to show until the first portfolio fetch resolves.
  if (!data) return null;

  const color = stats ? (stats.up ? Colors.up : Colors.down) : Colors.textMuted;
  const mask = (s: string) => (hidden ? '••••' : s);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <AppText variant="caption" muted>
          Portfolio
        </AppText>
        {stats ? (
          <AppText variant="label" numeric color={color}>
            {mask(`${signedUsd(stats.change)} (${formatPercent(stats.pct)})`)}
          </AppText>
        ) : null}
      </View>

      {points.length >= 2 ? (
        <EquityCurve points={points} color={color} />
      ) : (
        <View style={styles.empty}>
          <AppText variant="caption" muted>
            Not enough history yet
          </AppText>
        </View>
      )}

      <View style={styles.foot}>
        <View style={styles.periods}>
          {PERIODS.map((p) => {
            const active = p.key === period;
            return (
              <Pressable
                key={p.key}
                onPress={() => setPeriod(p.key)}
                style={[styles.period, active && styles.periodActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}>
                <AppText variant="caption" color={active ? Colors.text : Colors.textMuted}>
                  {p.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        {stats ? (
          <AppText variant="caption" muted>
            Max DD {mask(`${stats.mdd.toFixed(1)}%`)}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: { height: 96, alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  periods: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  period: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  periodActive: { backgroundColor: Colors.surfaceAlt },
});
