import { Ionicons } from '@expo/vector-icons';
import { useIsRestoring } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { OutcomeEventIcon } from '@/components/OutcomeEventIcon';
import { OUTCOME_SERIES_COLORS } from '@/components/OutcomeHistoryChart';
import { AppText } from '@/components/ui/AppText';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { Screen } from '@/components/ui/Screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useOutcomeMarkets } from '@/data/useMarkets';
import type { Quote } from '@/domain/types';
import { formatCompact } from '@/lib/format';
import type { OutcomeChoice, OutcomeEvent } from '@/lib/outcomeMarkets';

type Filter = 'all' | 'crypto' | 'economics' | 'sports';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'crypto', label: 'Crypto (1d)' },
  { key: 'economics', label: 'Economics' },
  { key: 'sports', label: 'Sports' },
];

const CATEGORY_ORDER = ['crypto', 'economics', 'sports', 'other'];

function categoryLabel(category: string): string {
  if (category === 'crypto') return 'Crypto (1d)';
  if (category === 'economics') return 'Economics';
  if (category === 'sports') return 'Sports';
  return 'Other';
}

function chance(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function payout(value: number | null): string {
  if (value === null || value <= 0) return '—';
  const multiple = 1 / value;
  return multiple >= 1000 ? '>999x' : `${multiple.toFixed(2)}x`;
}

function eventVolume(
  event: OutcomeEvent,
  quoteVolumes: Readonly<Record<string, number | null>>,
): number | null {
  const volumes = event.choices.map(
    (choice) => quoteVolumes[choice.instrumentId] ?? choice.dayVolume,
  );
  if (event.kind === 'standalone') return volumes[0] ?? null;
  const finite = volumes.filter((value): value is number => value !== null);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) : null;
}

function ChoiceRow({
  choice,
  index,
  probability,
}: {
  choice: OutcomeChoice;
  index: number;
  probability: number | null;
}) {
  return (
    <View style={styles.choiceRow}>
      <View
        style={[
          styles.choiceDot,
          { backgroundColor: OUTCOME_SERIES_COLORS[index % OUTCOME_SERIES_COLORS.length] },
        ]}
      />
      <AppText style={styles.choiceName} numberOfLines={1}>
        {choice.label}
      </AppText>
      <AppText style={styles.payout} numeric>
        {payout(probability)}
      </AppText>
      <View style={styles.probabilityPill}>
        <AppText style={styles.probability} numeric>
          {chance(probability)}
        </AppText>
      </View>
    </View>
  );
}

function EventCard({
  event,
  quotes,
  quoteVolumes,
  onPress,
}: {
  event: OutcomeEvent;
  quotes: Record<string, Quote>;
  quoteVolumes: Record<string, number | null>;
  onPress: (event: OutcomeEvent) => void;
}) {
  const volume = eventVolume(event, quoteVolumes);
  const visibleChoices = event.choices.slice(0, 4);

  return (
    <GlassSurface interactive style={styles.card}>
      <Pressable
        onPress={() => onPress(event)}
        style={({ pressed }) => [styles.cardPressable, pressed && styles.cardPressed]}>
        <View style={styles.cardHeader}>
          <OutcomeEventIcon event={event} />
          <AppText style={styles.cardTitle} numberOfLines={3}>
            {event.title}
          </AppText>
          <Ionicons name="chevron-forward" size={17} color={Colors.textFaint} />
        </View>

        <View style={styles.choices}>
          {visibleChoices.map((choice, index) => (
            <ChoiceRow
              key={choice.id}
              choice={choice}
              index={index}
              probability={quotes[choice.instrumentId]?.last ?? choice.probability}
            />
          ))}
          {event.choices.length > visibleChoices.length ? (
            <AppText variant="caption" muted style={styles.moreChoices}>
              +{event.choices.length - visibleChoices.length} more outcomes
            </AppText>
          ) : null}
        </View>

        <View style={styles.cardFooter}>
          <AppText variant="caption" muted numeric>
            {volume === null ? '—' : `$${formatCompact(volume)}`} · 24h Volume
          </AppText>
          {event.kind === 'question' ? (
            <AppText variant="caption" muted>
              Outcomes ({event.choices.length})
            </AppText>
          ) : null}
        </View>
      </Pressable>
    </GlassSurface>
  );
}

export default function OutcomesScreen() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch, isFetching } = useOutcomeMarkets();
  const isRestoring = useIsRestoring();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const quoteVolumes = useMemo<Record<string, number | null>>(
    () =>
      Object.fromEntries(
        Object.entries(data?.quotes ?? {}).map(([id, quote]) => [id, quote.dayVolume]),
      ),
    [data?.quotes],
  );

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const events = (data?.outcomeEvents ?? []).filter((event) => {
      if (filter !== 'all' && event.category !== filter) return false;
      if (!query) return true;
      const searchable = [
        event.title,
        event.description,
        event.category,
        event.subCategory ?? '',
        ...event.choices.map((choice) => choice.label),
      ]
        .join(' ')
        .toLowerCase();
      return searchable.includes(query);
    });

    return CATEGORY_ORDER.flatMap((category) => {
      const items = events
        .filter((event) => event.category === category)
        .sort(
          (a, b) =>
            (eventVolume(b, quoteVolumes) ?? 0) - (eventVolume(a, quoteVolumes) ?? 0),
        );
      return items.length ? [{ category, items }] : [];
    });
  }, [data?.outcomeEvents, filter, search, quoteVolumes]);

  const openEvent = (event: OutcomeEvent) =>
    router.push({ pathname: '/outcomes/[id]' as never, params: { id: event.id } });

  const loading = isLoading || isRestoring;
  const outcomeError = data?.outcomeMarketsError ?? null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <View>
            <AppText variant="title">Outcomes</AppText>
            <AppText variant="caption" muted style={styles.subtitle}>
              Live event probabilities on Hyperliquid
            </AppText>
          </View>
          {isFetching && !loading ? <ActivityIndicator size="small" color={Colors.accent} /> : null}
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={17} color={Colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search outcomes"
            placeholderTextColor={Colors.textFaint}
            autoCorrect={false}
            style={styles.searchInput}
          />
          {search ? (
            <Pressable hitSlop={8} onPress={() => setSearch('')} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={17} color={Colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          contentContainerStyle={styles.filters}
          showsHorizontalScrollIndicator={false}>
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setFilter(item.key)}
                style={[styles.filter, active && styles.filterActive]}>
                <AppText style={[styles.filterLabel, active && styles.filterLabelActive]}>
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.accent} />
            <AppText variant="caption" muted>Loading live outcomes…</AppText>
          </View>
        ) : isError || outcomeError ? (
          <View style={styles.state}>
            <Ionicons name="cloud-offline-outline" size={28} color={Colors.textMuted} />
            <AppText style={styles.stateTitle}>Outcomes unavailable</AppText>
            <AppText variant="caption" muted style={styles.stateCopy}>
              {outcomeError ??
                (error instanceof Error ? error.message : 'Could not load Hyperliquid outcomes.')}
            </AppText>
            <Pressable onPress={() => refetch()} style={styles.retryButton}>
              <AppText style={styles.retryLabel}>Try again</AppText>
            </Pressable>
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.state}>
            <Ionicons name="search-outline" size={28} color={Colors.textMuted} />
            <AppText style={styles.stateTitle}>No matching events</AppText>
            <AppText variant="caption" muted>Try another search or category.</AppText>
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.category} style={styles.section}>
              <AppText style={styles.sectionTitle}>{categoryLabel(group.category)}</AppText>
              <View style={styles.cardList}>
                {group.items.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    quotes={data?.quotes ?? {}}
                    quoteVolumes={quoteVolumes}
                    onPress={openEvent}
                  />
                ))}
              </View>
            </View>
          ))
        )}

        <AppText variant="caption" muted style={styles.disclaimer}>
          View only · Probabilities and market data are provided by Hyperliquid.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  subtitle: { marginTop: 3 },
  searchWrap: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 0 },
  filters: { gap: Spacing.sm, paddingVertical: Spacing.md, paddingRight: Spacing.lg },
  filter: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  filterActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  filterLabel: { color: Colors.textMuted, fontSize: 13, fontWeight: '600' },
  filterLabelActive: { color: Colors.background },
  section: { marginTop: Spacing.sm },
  sectionTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  cardList: { gap: Spacing.md, marginBottom: Spacing.xl },
  card: { borderRadius: Radius.lg },
  cardPressable: { padding: Spacing.lg },
  cardPressed: { backgroundColor: 'rgba(255,255,255,0.035)' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  cardTitle: { flex: 1, color: Colors.text, fontSize: 16, fontWeight: '700', lineHeight: 21 },
  choices: { marginTop: Spacing.md, gap: 7 },
  choiceRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center' },
  choiceDot: { width: 7, height: 7, borderRadius: 4, marginRight: Spacing.sm },
  choiceName: { flex: 1, color: Colors.text, fontSize: 14, fontWeight: '600' },
  payout: { color: Colors.textMuted, fontSize: 13, marginHorizontal: Spacing.sm },
  probabilityPill: {
    minWidth: 56,
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  probability: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  moreChoices: { marginTop: 2, marginLeft: 15 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.09)',
  },
  state: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  stateTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  stateCopy: { textAlign: 'center', lineHeight: 17 },
  retryButton: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceAlt,
  },
  retryLabel: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  disclaimer: { textAlign: 'center', lineHeight: 17, paddingHorizontal: Spacing.xl },
});
