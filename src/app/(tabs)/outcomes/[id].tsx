import { Ionicons } from '@expo/vector-icons';
import { useIsRestoring } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { OutcomeEventIcon } from '@/components/OutcomeEventIcon';
import {
  OutcomeHistoryChart,
  OUTCOME_SERIES_COLORS,
} from '@/components/OutcomeHistoryChart';
import { AppText } from '@/components/ui/AppText';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { Screen } from '@/components/ui/Screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useOutcomeMarkets } from '@/data/useMarkets';
import type { Instrument, Quote } from '@/domain/types';
import {
  formatCompact,
  formatPrice,
  formatProbability,
  formatProbabilityPointChange,
} from '@/lib/format';
import type { OutcomeChoice, OutcomeEvent } from '@/lib/outcomeMarkets';

const INITIAL_NOW = Date.now();

function categoryLabel(category: string): string {
  if (category === 'crypto') return 'Crypto (1d)';
  if (category === 'economics') return 'Economics';
  if (category === 'sports') return 'Sports';
  return 'Outcome market';
}

function payout(value: number | null): string {
  if (value === null || value <= 0) return '—';
  const multiple = 1 / value;
  return multiple >= 1000 ? '>999x' : `${multiple.toFixed(2)}x`;
}

function countdown(expiryAt: number | null, now: number): string | null {
  if (expiryAt === null) return null;
  const remaining = expiryAt - now;
  if (remaining <= 0) return 'Awaiting settlement';
  const minutes = Math.floor(remaining / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return days > 0 ? `${days}d ${hours}h remaining` : `${hours}h ${mins}m remaining`;
}

function probabilityFor(
  choice: OutcomeChoice | undefined,
  quote: Quote | undefined,
): number | null {
  if (!choice) return null;
  return quote?.last ?? choice.probability;
}

function ChoiceDetailRow({
  choice,
  instrument,
  quote,
  probability,
  index,
  selected,
  onPress,
}: {
  choice: OutcomeChoice;
  instrument: Instrument | undefined;
  quote: Quote | undefined;
  probability: number | null;
  index: number;
  selected: boolean;
  onPress: () => void;
}) {
  const previous = quote?.prevClose ?? choice.previousProbability;
  const change = probability !== null && previous !== null ? probability - previous : null;
  const volume = quote?.dayVolume ?? choice.dayVolume;
  const color = OUTCOME_SERIES_COLORS[index % OUTCOME_SERIES_COLORS.length];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.outcomeRow,
        selected && styles.outcomeRowSelected,
        pressed && styles.outcomeRowPressed,
      ]}>
      <View style={[styles.outcomeBar, { backgroundColor: color }]} />
      <View style={styles.outcomeMain}>
        <View style={styles.outcomeTitleRow}>
          <AppText style={styles.outcomeName} numberOfLines={1}>
            {choice.label}
          </AppText>
          <AppText variant="caption" muted numeric>
            {payout(probability)} payout
          </AppText>
        </View>
        <AppText variant="caption" muted numeric numberOfLines={1}>
          Price {formatPrice(probability, instrument?.priceDecimals ?? 5)}
          {change === null ? '' : `  ·  ${formatProbabilityPointChange(change)}`}
          {volume === null ? '' : `  ·  $${formatCompact(volume)} vol`}
        </AppText>
      </View>
      <View style={[styles.chanceButton, { borderColor: `${color}80` }]}>
        <AppText style={styles.chanceButtonText} numeric>
          {probability === null ? '—' : `${Math.round(probability * 100)}%`}
        </AppText>
      </View>
    </Pressable>
  );
}

function DetailsModal({
  event,
  visible,
  onClose,
}: {
  event: OutcomeEvent;
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <GlassSurface style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <OutcomeEventIcon event={event} size={38} />
            <AppText style={styles.modalTitle} numberOfLines={3}>
              {event.title}
            </AppText>
            <Pressable hitSlop={10} onPress={onClose} accessibilityLabel="Close details">
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.modalBody}
            contentContainerStyle={styles.modalBodyContent}
            showsVerticalScrollIndicator={false}>
            <AppText style={styles.modalCopy}>
              {event.description || 'Resolution details are provided by Hyperliquid.'}
            </AppText>
            {event.expiryLabel ? (
              <View style={styles.resolutionRow}>
                <Ionicons name="time-outline" size={16} color={Colors.textMuted} />
                <AppText variant="caption" muted>
                  Resolution time · {event.expiryLabel}
                </AppText>
              </View>
            ) : null}
            <AppText variant="caption" muted style={styles.rulesNote}>
              Review the official market rules before relying on an outcome. Displayed prices are
              probabilities, not guarantees.
            </AppText>
          </ScrollView>
        </GlassSurface>
      </View>
    </Modal>
  );
}

export default function OutcomeDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useOutcomeMarkets();
  const isRestoring = useIsRestoring();
  const event = data?.outcomeEvents.find((candidate) => candidate.id === id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(INITIAL_NOW);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const chartChoices = useMemo(
    () =>
      event?.choices.flatMap((choice) => {
        const instrument = data?.byId[choice.instrumentId];
        return instrument ? [{ label: choice.label, instrument }] : [];
      }) ?? [],
    [event, data?.byId],
  );

  const selectedChoice =
    event?.choices.find((choice) => choice.id === selectedId) ?? event?.choices[0];
  const selectedQuote = selectedChoice ? data?.quotes[selectedChoice.instrumentId] : undefined;
  const selectedProbability = probabilityFor(selectedChoice, selectedQuote);
  const selectedPrevious = selectedQuote?.prevClose ?? selectedChoice?.previousProbability ?? null;
  const selectedChange =
    selectedProbability !== null && selectedPrevious !== null
      ? selectedProbability - selectedPrevious
      : null;
  const selectedChangePct =
    selectedProbability !== null && selectedPrevious !== null && selectedPrevious !== 0
      ? ((selectedProbability - selectedPrevious) / selectedPrevious) * 100
      : null;
  const selectedVolume = selectedQuote?.dayVolume ?? selectedChoice?.dayVolume ?? null;
  const expiryStatus = countdown(event?.expiryAt ?? null, now);
  const outcomeError = data?.outcomeMarketsError ?? null;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/outcomes' as never);
  };

  if ((isLoading || isRestoring) && !event) {
    return (
      <Screen>
        <View style={styles.loadingState}>
          <ActivityIndicator color={Colors.accent} />
          <AppText variant="caption" muted>Loading event…</AppText>
        </View>
      </Screen>
    );
  }

  if (!event) {
    return (
      <Screen>
        <View style={styles.missingHeader}>
          <Pressable hitSlop={10} onPress={goBack}>
            <Ionicons name="chevron-back" size={27} color={Colors.text} />
          </Pressable>
        </View>
        <View style={styles.loadingState}>
          <Ionicons name="alert-circle-outline" size={30} color={Colors.textMuted} />
          <AppText style={styles.missingTitle}>
            {isError || outcomeError ? 'Event unavailable' : 'Event not found'}
          </AppText>
          <AppText variant="caption" muted style={styles.missingCopy}>
            {outcomeError ??
              (isError && error instanceof Error
                ? error.message
                : 'This outcome may have settled or rolled to a newer event.')}
          </AppText>
          {isError || outcomeError ? (
            <Pressable onPress={() => refetch()} style={styles.retryButton}>
              <AppText style={styles.retryLabel}>Try again</AppText>
            </Pressable>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.navRow}>
          <Pressable hitSlop={10} onPress={goBack} style={styles.navButton}>
            <Ionicons name="chevron-back" size={25} color={Colors.text} />
          </Pressable>
          <View style={styles.navSpacer} />
          <Pressable onPress={() => setDetailsOpen(true)} style={styles.detailsButton}>
            <Ionicons name="document-text-outline" size={15} color={Colors.text} />
            <AppText style={styles.detailsLabel}>Details</AppText>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <OutcomeEventIcon event={event} size={50} />
          <View style={styles.heroText}>
            <AppText variant="caption" color={Colors.textMuted} style={styles.category}>
              {categoryLabel(event.category).toUpperCase()}
            </AppText>
            <AppText style={styles.title}>{event.title}</AppText>
            {expiryStatus ? (
              <View style={styles.statusRow}>
                <View style={styles.liveDot} />
                <AppText variant="caption" muted>{expiryStatus}</AppText>
              </View>
            ) : null}
          </View>
        </View>

        <GlassSurface style={styles.metricsCard}>
          <View style={styles.selectedHeader}>
            <View
              style={[
                styles.legendDot,
                {
                  backgroundColor:
                    OUTCOME_SERIES_COLORS[
                      Math.max(0, event.choices.findIndex((choice) => choice.id === selectedChoice?.id)) %
                        OUTCOME_SERIES_COLORS.length
                    ],
                },
              ]}
            />
            <AppText style={styles.selectedName} numberOfLines={1}>
              {selectedChoice?.label ?? 'Outcome'}
            </AppText>
            <AppText style={styles.headlineChance} numeric>
              {formatProbability(selectedProbability)}
            </AppText>
          </View>
          <View style={styles.metricsGrid}>
            <View style={styles.metric}>
              <AppText variant="caption" muted>% Chance</AppText>
              <AppText style={styles.metricValue} numeric>{formatProbability(selectedProbability)}</AppText>
            </View>
            <View style={styles.metric}>
              <AppText variant="caption" muted>Price</AppText>
              <AppText style={styles.metricValue} numeric>{formatPrice(selectedProbability, 5)}</AppText>
            </View>
            <View style={styles.metric}>
              <AppText variant="caption" muted>24h Change</AppText>
              <AppText
                style={[
                  styles.metricValue,
                  {
                    color:
                      selectedChange === null
                        ? Colors.text
                        : selectedChange >= 0
                          ? Colors.up
                          : Colors.down,
                  },
                ]}
                numeric>
                {selectedChange === null
                  ? '—'
                  : `${formatProbabilityPointChange(selectedChange)} · ${
                      selectedChangePct === null
                        ? '—'
                        : `${selectedChangePct >= 0 ? '+' : ''}${selectedChangePct.toFixed(2)}%`
                    }`}
              </AppText>
            </View>
            <View style={styles.metric}>
              <AppText variant="caption" muted>24h Volume</AppText>
              <AppText style={styles.metricValue} numeric>
                {selectedVolume === null ? '—' : `$${formatCompact(selectedVolume)}`}
              </AppText>
            </View>
          </View>
        </GlassSurface>

        <GlassSurface style={styles.chartCard}>
          <View style={styles.sectionHeader}>
            <View>
              <AppText style={styles.sectionTitle}>Probability history</AppText>
              <AppText variant="caption" muted>Outcomes</AppText>
            </View>
          </View>
          <View style={styles.legend}>
            {event.choices.map((choice, index) => {
              const quote = data?.quotes[choice.instrumentId];
              const probability = probabilityFor(choice, quote);
              return (
                <View key={choice.id} style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendDot,
                      {
                        backgroundColor:
                          OUTCOME_SERIES_COLORS[index % OUTCOME_SERIES_COLORS.length],
                      },
                    ]}
                  />
                  <AppText variant="caption" numberOfLines={1} style={styles.legendName}>
                    {choice.label}
                  </AppText>
                  <AppText variant="caption" color={Colors.text} numeric>
                    {probability === null ? '—' : `${(probability * 100).toFixed(1)}%`}
                  </AppText>
                </View>
              );
            })}
          </View>
          <OutcomeHistoryChart choices={chartChoices} />
        </GlassSurface>

        <View style={styles.liveHeader}>
          <AppText style={styles.sectionTitle}>Live outcomes</AppText>
          <AppText variant="caption" muted>{event.choices.length} choices</AppText>
        </View>
        <GlassSurface style={styles.outcomesCard}>
          {event.choices.map((choice, index) => {
            const quote = data?.quotes[choice.instrumentId];
            return (
              <ChoiceDetailRow
                key={choice.id}
                choice={choice}
                instrument={data?.byId[choice.instrumentId]}
                quote={quote}
                probability={probabilityFor(choice, quote)}
                index={index}
                selected={choice.id === selectedChoice?.id}
                onPress={() => setSelectedId(choice.id)}
              />
            );
          })}
        </GlassSurface>

        <GlassSurface style={styles.readOnlyCard}>
          <View style={styles.readOnlyIcon}>
            <Ionicons name="eye-outline" size={18} color={Colors.text} />
          </View>
          <View style={styles.readOnlyText}>
            <AppText style={styles.readOnlyTitle}>View only</AppText>
            <AppText variant="caption" muted style={styles.readOnlyCopy}>
              Live Hyperliquid event odds are shown here without order entry.
            </AppText>
          </View>
        </GlassSurface>
      </ScrollView>

      <DetailsModal event={event} visible={detailsOpen} onClose={() => setDetailsOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
  navRow: { height: 42, flexDirection: 'row', alignItems: 'center' },
  navButton: { width: 36, height: 36, alignItems: 'flex-start', justifyContent: 'center' },
  navSpacer: { flex: 1 },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  detailsLabel: { color: Colors.text, fontSize: 12, fontWeight: '700' },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, marginTop: Spacing.sm },
  heroText: { flex: 1 },
  category: { letterSpacing: 0.7, marginBottom: 5 },
  title: { color: Colors.text, fontSize: 21, fontWeight: '700', lineHeight: 27 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.up },
  metricsCard: { borderRadius: Radius.lg, marginTop: Spacing.lg, padding: Spacing.lg },
  selectedHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.lg },
  selectedName: { flex: 1, color: Colors.text, fontSize: 16, fontWeight: '700' },
  headlineChance: { color: Colors.text, fontSize: 24, fontWeight: '700' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  metric: { width: '47%', gap: 4 },
  metricValue: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  chartCard: { borderRadius: Radius.lg, marginTop: Spacing.md, padding: Spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginVertical: Spacing.md },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '48%',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  legendDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  legendName: { color: Colors.textMuted, maxWidth: 105 },
  liveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },
  outcomesCard: { borderRadius: Radius.lg },
  outcomeRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  outcomeRowSelected: { backgroundColor: 'rgba(255,255,255,0.045)' },
  outcomeRowPressed: { backgroundColor: 'rgba(255,255,255,0.075)' },
  outcomeBar: { width: 3, height: 34, borderRadius: 2, marginRight: Spacing.md },
  outcomeMain: { flex: 1, gap: 5, paddingRight: Spacing.sm },
  outcomeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  outcomeName: { flex: 1, color: Colors.text, fontSize: 14, fontWeight: '700' },
  chanceButton: {
    minWidth: 58,
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  chanceButtonText: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  readOnlyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginTop: Spacing.lg,
  },
  readOnlyIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginRight: Spacing.md,
  },
  readOnlyText: { flex: 1 },
  readOnlyTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  readOnlyCopy: { marginTop: 3, lineHeight: 16 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  missingHeader: { height: 48, justifyContent: 'center', paddingHorizontal: Spacing.md },
  missingTitle: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  missingCopy: { textAlign: 'center' },
  retryButton: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceAlt,
  },
  retryLabel: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  modalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '82%',
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  modalTitle: { flex: 1, color: Colors.text, fontSize: 16, fontWeight: '700', lineHeight: 21 },
  modalBody: { flexShrink: 1, marginTop: Spacing.lg },
  modalBodyContent: { paddingBottom: Spacing.xs },
  modalCopy: { color: Colors.textMuted, fontSize: 14, lineHeight: 21 },
  resolutionRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: Spacing.lg },
  rulesNote: {
    lineHeight: 17,
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
});
