import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { NewsSourceIcon } from '@/components/NewsSourceIcon';
import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type {
  NewsConfidence,
  NewsExecutiveSummary,
  NewsPulseChange,
  NewsPulseLabel,
} from '@/domain/news';

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
  mixed: 'Mixed signals',
  calm: 'Calm',
  'event-driven': 'Event risk elevated',
};

const changeLabel: Record<NewsPulseChange, string> = {
  new: 'New',
  changed: 'Changed',
  unchanged: 'Unchanged',
};

const changeColor: Record<NewsPulseChange, string> = {
  new: Colors.accent,
  changed: Colors.warning,
  unchanged: Colors.textFaint,
};

const confidenceLabel: Record<NewsConfidence, string> = {
  confirmed: 'Confirmed',
  reported: 'Reported',
  disputed: 'Disputed',
  speculative: 'Speculative',
};

const confidenceColor: Record<NewsConfidence, string> = {
  confirmed: Colors.up,
  reported: '#7EA2FF',
  disputed: Colors.down,
  speculative: Colors.warning,
};

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.statusBadge, { borderColor: `${color}70`, backgroundColor: `${color}14` }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <AppText style={[styles.statusText, { color }]}>{label}</AppText>
    </View>
  );
}

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
  const [showSecondary, setShowSecondary] = useState(false);
  const signalCount = summary.analyzedItems || Object.values(summary.sourceCounts).reduce((sum, count) => sum + count, 0);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
      }>
      <View style={styles.topline}>
        <View style={styles.kickerBadge}>
          <View style={[styles.liveDot, { backgroundColor: pulseColor[summary.pulse.label] }]} />
          <AppText style={[styles.kicker, { color: pulseColor[summary.pulse.label] }]}>
            {pulseLabel[summary.pulse.label].toUpperCase()}
          </AppText>
        </View>
        <AppText variant="caption">Updated {relativeTime(summary.generatedAt)}</AppText>
      </View>

      <View style={styles.hero}>
        <AppText variant="heading" style={styles.headline}>{summary.headline}</AppText>
        <AppText style={styles.overview}>{summary.overview}</AppText>
        <View style={styles.marketRead}>
          <AppText style={styles.marketReadLabel}>MARKET READ</AppText>
          <AppText style={styles.marketReadText}>{summary.pulse.summary}</AppText>
        </View>
      </View>

      <AppText style={styles.sectionTitle}>Top developments</AppText>

      <View style={styles.bulletList}>
        {summary.bullets.map((bullet, index) => {
          const isExpanded = expanded === index;
          return (
            <View key={`${summary.id}:${index}`} style={[styles.bulletCard, isExpanded && styles.bulletCardExpanded]}>
              <Pressable
                onPress={() => setExpanded(isExpanded ? null : index)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isExpanded }}
                accessibilityLabel={`${bullet.headline}. ${isExpanded ? 'Collapse' : 'Expand'} evidence`}
                style={({ pressed }) => [styles.bulletButton, pressed && styles.pressed]}>
                <View style={styles.cardMeta}>
                  <AppText style={styles.cardNumber}>{String(index + 1).padStart(2, '0')}</AppText>
                  <StatusBadge label={changeLabel[bullet.change]} color={changeColor[bullet.change]} />
                  <StatusBadge label={confidenceLabel[bullet.confidence]} color={confidenceColor[bullet.confidence]} />
                  <View style={styles.sourceIcons}>
                    {bullet.sources.map((source) => (
                      <View key={source.itemKey} style={styles.sourceIconShell}>
                        <NewsSourceIcon source={source.source} size={16} />
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.cardCopy}>
                  <AppText style={styles.bulletHeadline}>{bullet.headline}</AppText>
                  <AppText style={styles.bulletSummary}>{bullet.summary}</AppText>
                  <View style={styles.impactRow}>
                    <Ionicons name="trending-up-outline" size={14} color={Colors.textFaint} />
                    <AppText style={styles.impactText}>{bullet.marketImpact}</AppText>
                  </View>
                </View>

                <View style={styles.expandHint}>
                  <AppText style={styles.expandHintText}>{isExpanded ? 'Hide evidence' : 'View evidence'}</AppText>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={Colors.textFaint}
                  />
                </View>
              </Pressable>

              {isExpanded ? (
                <View style={styles.expandedBody}>
                  <View style={styles.divider} />
                  <AppText style={styles.evidenceLabel}>EVIDENCE</AppText>
                  <AppText style={styles.details}>{bullet.details}</AppText>
                  <View style={styles.sourceDetails}>
                    {bullet.sources.map((source) => (
                      <Pressable
                        key={`detail:${source.itemKey}`}
                        onPress={() => void Linking.openURL(source.url)}
                        accessibilityRole="link"
                        accessibilityLabel={`Open ${source.author} source`}
                        style={({ pressed }) => [styles.sourceDetailRow, pressed && styles.pressed]}>
                        <NewsSourceIcon source={source.source} size={17} />
                        <View style={styles.sourceDetailCopy}>
                          <AppText style={styles.sourceDetailAuthor} numberOfLines={1}>{source.author}</AppText>
                          <AppText variant="caption" numberOfLines={1}>{source.title}</AppText>
                        </View>
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

      {summary.secondarySignals.length > 0 ? (
        <View style={styles.secondarySection}>
          <Pressable
            onPress={() => setShowSecondary((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showSecondary }}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <View style={styles.secondaryTitleRow}>
              <Ionicons name="layers-outline" size={15} color={Colors.textMuted} />
              <AppText style={styles.secondaryTitle}>More signals</AppText>
              <AppText variant="caption">{summary.secondarySignals.length}</AppText>
            </View>
            <Ionicons name={showSecondary ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textFaint} />
          </Pressable>
          {showSecondary ? (
            <View style={styles.secondaryList}>
              {summary.secondarySignals.map((item, index) => (
                <View key={`${index}:${item}`} style={styles.secondaryRow}>
                  <View style={styles.secondaryDot} />
                  <AppText style={styles.secondaryText}>{item}</AppText>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {summary.watchNext.length > 0 ? (
        <View style={styles.watchSection}>
          <View style={styles.watchHeading}>
            <Ionicons name="eye-outline" size={15} color={Colors.warning} />
            <AppText style={styles.watchTitle}>Watch next</AppText>
          </View>
          {summary.watchNext.map((item, index) => (
            <View key={`${index}:${item}`} style={styles.watchRow}>
              <AppText style={styles.watchNumber}>{String(index + 1).padStart(2, '0')}</AppText>
              <AppText style={styles.watchText}>{item}</AppText>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.footer}>
        <AppText variant="caption" style={styles.footerText}>
          {signalCount} source items scanned · refreshed hourly
        </AppText>
        <AppText variant="caption" style={styles.footerText}>{summary.noiseSummary}</AppText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: 44, gap: Spacing.lg },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kickerBadge: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 0.85 },
  hero: { gap: 9 },
  headline: { fontSize: 27, lineHeight: 31, letterSpacing: -0.65 },
  overview: { color: Colors.textMuted, fontSize: 14, lineHeight: 20, fontWeight: '400' },
  marketRead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: 3,
  },
  marketReadLabel: { width: 72, color: Colors.accent, fontSize: 9, lineHeight: 18, fontWeight: '800', letterSpacing: 0.7 },
  marketReadText: { flex: 1, color: Colors.text, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  bulletList: { gap: 10 },
  bulletCard: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  bulletCardExpanded: { borderColor: '#30425F', backgroundColor: '#121922' },
  bulletButton: { gap: 11, padding: Spacing.md },
  pressed: { opacity: 0.7 },
  cardMeta: { minHeight: 18, flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardNumber: { marginRight: 1, color: Colors.textFaint, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
  },
  statusDot: { width: 4, height: 4, borderRadius: 2 },
  statusText: { fontSize: 9, lineHeight: 10, fontWeight: '800' },
  sourceIcons: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 },
  sourceIconShell: { opacity: 0.82 },
  cardCopy: { gap: 5 },
  bulletHeadline: { fontSize: 16, lineHeight: 20, fontWeight: '700', letterSpacing: -0.15 },
  bulletSummary: { color: Colors.textMuted, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  impactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingTop: 3 },
  impactText: { flex: 1, color: '#BBC2CC', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  expandHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  expandHintText: { color: Colors.textFaint, fontSize: 10, fontWeight: '600' },
  expandedBody: { gap: 9, padding: Spacing.md, paddingTop: 0 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  evidenceLabel: { color: Colors.textFaint, fontSize: 9, fontWeight: '800', letterSpacing: 0.75 },
  details: { color: Colors.textMuted, fontSize: 13, lineHeight: 19, fontWeight: '400' },
  sourceDetails: { gap: 1 },
  sourceDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  sourceDetailCopy: { flex: 1, gap: 1 },
  sourceDetailAuthor: { color: Colors.text, fontSize: 12, fontWeight: '600' },
  secondarySection: {
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  secondaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  secondaryTitle: { fontSize: 13, fontWeight: '700' },
  secondaryList: { gap: 9, paddingBottom: 12 },
  secondaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  secondaryDot: { width: 4, height: 4, marginTop: 7, borderRadius: 2, backgroundColor: Colors.textFaint },
  secondaryText: { flex: 1, color: Colors.textMuted, fontSize: 12, lineHeight: 18 },
  watchSection: { gap: 9 },
  watchHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  watchTitle: { fontSize: 14, fontWeight: '800' },
  watchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  watchNumber: { width: 18, color: Colors.warning, fontSize: 10, lineHeight: 18, fontWeight: '800' },
  watchText: { flex: 1, color: '#C6CBD3', fontSize: 12, lineHeight: 18, fontWeight: '500' },
  footer: { gap: 4, paddingTop: 3 },
  footerText: { color: Colors.textFaint, textAlign: 'center', lineHeight: 16 },
});
