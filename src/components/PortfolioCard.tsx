import { Ionicons } from '@expo/vector-icons';
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
export function PortfolioCard({ hidden, compact = false }: { hidden: boolean; compact?: boolean }) {
  const { data } = useHlPortfolio();
  const [period, setPeriod] = useState<HlPortfolioPeriodKey>('week');
  const [compactExpanded, setCompactExpanded] = useState(false);
  const expanded = compact ? compactExpanded : true;
  const points = useMemo(() => data?.[period]?.accountValue ?? [], [data, period]);

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
    <View style={[styles.card, compact && !expanded && styles.cardCompact]}>
      <Pressable
        style={({ pressed }) => [styles.head, compact && pressed && styles.headPressed]}
        onPress={() => compact && setCompactExpanded((current) => !current)}
        disabled={!compact}
        accessibilityRole={compact ? 'button' : undefined}
        accessibilityLabel={compact ? `${expanded ? 'Collapse' : 'Expand'} portfolio history` : undefined}
        accessibilityState={compact ? { expanded } : undefined}>
        <View style={styles.headTitle}>
          <AppText variant="caption" muted>
            Portfolio history
          </AppText>
          {!expanded ? (
            <AppText variant="caption" color={Colors.textFaint}>
              {PERIODS.find((item) => item.key === period)?.label}
              {stats ? ` · Max DD ${mask(`${stats.mdd.toFixed(1)}%`)}` : ''}
            </AppText>
          ) : null}
        </View>
        <View style={styles.headValue}>
          {stats ? (
            <AppText variant="label" numeric color={color}>
              {mask(`${signedUsd(stats.change)} (${formatPercent(stats.pct)})`)}
            </AppText>
          ) : null}
          {compact ? (
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={17}
              color={Colors.textFaint}
            />
          ) : null}
        </View>
      </Pressable>

      {expanded ? (
        <>
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
        </>
      ) : null}
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
  cardCompact: { paddingVertical: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headPressed: { opacity: 0.72 },
  headTitle: { flex: 1, gap: 2 },
  headValue: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
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
