import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { NewsSourceIcon } from '@/components/NewsSourceIcon';
import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { NewsExecutiveSummary, NewsPulseLabel } from '@/domain/news';

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

const pulseColor: Record<NewsPulseLabel, string> = {
  'risk-on': Colors.up,
  'risk-off': Colors.down,
  mixed: Colors.warning,
  calm: Colors.textMuted,
  'event-driven': Colors.accent,
};

const pulseLabel: Record<NewsPulseLabel, string> = {
  'risk-on': 'Risk on',
  'risk-off': 'Risk off',
  mixed: 'Mixed',
  calm: 'Calm',
  'event-driven': 'Event driven',
};

export function NewsExecutiveSummaryView({
  summary,
  refreshing,
  onRefresh,
}: {
  summary: NewsExecutiveSummary;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const signalCount = summary.analyzedItems || Object.values(summary.sourceCounts).reduce((sum, count) => sum + count, 0);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
      }>
      <View style={styles.kickerRow}>
        <View style={styles.kickerBadge}>
          <Ionicons name="pulse" size={13} color={Colors.accent} />
          <AppText style={styles.kicker}>HOURLY PULSE</AppText>
        </View>
        <AppText variant="caption">Updated {relativeTime(summary.generatedAt)}</AppText>
      </View>

      <View style={styles.hero}>
        <View style={styles.pulseRow}>
          <View style={[styles.pulseDot, { backgroundColor: pulseColor[summary.pulse.label] }]} />
          <AppText style={[styles.pulseName, { color: pulseColor[summary.pulse.label] }]}>
            {pulseLabel[summary.pulse.label]}
          </AppText>
          <AppText variant="caption">· {signalCount} signals analyzed</AppText>
        </View>
        <AppText variant="heading" style={styles.headline}>{summary.headline}</AppText>
        <AppText style={styles.overview}>{summary.overview}</AppText>
        <View style={styles.pulseSummary}>
          <Ionicons name="analytics-outline" size={16} color={Colors.accent} />
          <AppText style={styles.pulseSummaryText}>{summary.pulse.summary}</AppText>
        </View>
      </View>

      <View style={styles.sectionHeading}>
        <AppText style={styles.sectionTitle}>What matters now</AppText>
        <AppText variant="caption">Tap a point to expand</AppText>
      </View>

      <View style={styles.bulletList}>
        {summary.bullets.map((bullet, index) => {
          const isExpanded = expanded === index;
          return (
            <View key={`${summary.id}:${index}`} style={[styles.bulletCard, isExpanded && styles.bulletCardExpanded]}>
              <Pressable
                onPress={() => setExpanded(isExpanded ? null : index)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isExpanded }}
                style={({ pressed }) => [styles.bulletButton, pressed && styles.pressed]}>
                <View style={styles.bulletDot}><View style={styles.bulletDotCore} /></View>
                <View style={styles.bulletCopy}>
                  <AppText style={styles.bulletHeadline}>{bullet.headline}</AppText>
                  <AppText style={styles.bulletSummary}>{bullet.summary}</AppText>
                </View>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={17}
                  color={Colors.textMuted}
                />
              </Pressable>

              <View style={styles.sourcesRow}>
                <AppText variant="caption" style={styles.sourcesLabel}>SOURCES</AppText>
                {bullet.sources.map((source) => (
                  <Pressable
                    key={source.itemKey}
                    onPress={() => void Linking.openURL(source.url)}
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${source.author} source`}
                    hitSlop={7}
                    style={({ pressed }) => [styles.sourceButton, pressed && styles.sourcePressed]}>
                    <NewsSourceIcon source={source.source} size={19} />
                  </Pressable>
                ))}
              </View>

              {isExpanded ? (
                <View style={styles.expandedBody}>
                  <View style={styles.whyBlock}>
                    <AppText style={styles.whyLabel}>WHY IT MATTERS</AppText>
                    <AppText style={styles.whyText}>{bullet.whyItMatters}</AppText>
                  </View>
                  <AppText style={styles.details}>{bullet.details}</AppText>
                  <View style={styles.sourceDetails}>
                    {bullet.sources.map((source) => (
                      <Pressable
                        key={`detail:${source.itemKey}`}
                        onPress={() => void Linking.openURL(source.url)}
                        style={({ pressed }) => [styles.sourceDetailRow, pressed && styles.pressed]}>
                        <NewsSourceIcon source={source.source} size={18} />
                        <AppText style={styles.sourceDetailText} numberOfLines={1}>{source.author}</AppText>
                        <Ionicons name="open-outline" size={13} color={Colors.textFaint} />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {summary.watchNext.length > 0 ? (
        <View style={styles.watchCard}>
          <View style={styles.watchHeading}>
            <Ionicons name="eye-outline" size={17} color={Colors.warning} />
            <AppText style={styles.watchTitle}>Watch next</AppText>
          </View>
          {summary.watchNext.map((item, index) => (
            <View key={`${index}:${item}`} style={styles.watchRow}>
              <AppText style={styles.watchNumber}>{index + 1}</AppText>
              <AppText style={styles.watchText}>{item}</AppText>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.noiseCard}>
        <Ionicons name="filter-outline" size={16} color={Colors.textMuted} />
        <View style={styles.noiseCopy}>
          <AppText style={styles.noiseTitle}>Noise filtered</AppText>
          <AppText variant="caption" style={styles.noiseText}>{summary.noiseSummary}</AppText>
        </View>
      </View>

      <AppText variant="caption" style={styles.modelLine}>
        Synthesized by {summary.model} · {summary.reasoningEffort} reasoning · Sources remain one tap away
      </AppText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: 40, gap: Spacing.lg },
  kickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kickerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker: { color: Colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  hero: { gap: Spacing.sm },
  pulseRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pulseDot: { width: 7, height: 7, borderRadius: 4 },
  pulseName: { fontSize: 12, fontWeight: '800' },
  headline: { fontSize: 26, lineHeight: 31, letterSpacing: -0.5 },
  overview: { color: Colors.textMuted, fontSize: 15, lineHeight: 22, fontWeight: '400' },
  pulseSummary: {
    marginTop: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentSoft,
  },
  pulseSummaryText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '500' },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  bulletList: { gap: Spacing.sm },
  bulletCard: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
  },
  bulletCardExpanded: { borderColor: '#2A3A55' },
  bulletButton: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: Spacing.md },
  pressed: { opacity: 0.72 },
  bulletDot: {
    width: 18,
    height: 18,
    marginTop: 1,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentSoft,
  },
  bulletDotCore: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.accent },
  bulletCopy: { flex: 1, gap: 5 },
  bulletHeadline: { fontSize: 15, lineHeight: 19, fontWeight: '700' },
  bulletSummary: { color: Colors.textMuted, fontSize: 13, lineHeight: 19, fontWeight: '400' },
  sourcesRow: {
    minHeight: 31,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  sourcesLabel: { marginRight: 1, fontSize: 9, letterSpacing: 0.7 },
  sourceButton: { borderRadius: 7 },
  sourcePressed: { opacity: 0.55, transform: [{ scale: 0.94 }] },
  expandedBody: { gap: Spacing.md, padding: Spacing.md, paddingTop: 0 },
  whyBlock: { gap: 5, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: Colors.accent },
  whyLabel: { color: Colors.accent, fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  whyText: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  details: { color: Colors.textMuted, fontSize: 13, lineHeight: 20, fontWeight: '400' },
  sourceDetails: { gap: 2 },
  sourceDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  sourceDetailText: { flex: 1, color: Colors.textMuted, fontSize: 12, fontWeight: '500' },
  watchCard: { gap: 10, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: '#211E12' },
  watchHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  watchTitle: { fontSize: 15, fontWeight: '800' },
  watchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  watchNumber: {
    width: 18,
    height: 18,
    borderRadius: 9,
    overflow: 'hidden',
    textAlign: 'center',
    color: Colors.warning,
    backgroundColor: '#342D12',
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '800',
  },
  watchText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '500' },
  noiseCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 4 },
  noiseCopy: { flex: 1, gap: 3 },
  noiseTitle: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
  noiseText: { lineHeight: 16, fontWeight: '400' },
  modelLine: { textAlign: 'center', color: Colors.textFaint, lineHeight: 16 },
});
