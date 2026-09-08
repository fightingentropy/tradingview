import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { NewsSourceIcon } from '@/components/NewsSourceIcon';
import { AppText } from '@/components/ui/AppText';
import { Colors, NewsColors, Spacing } from '@/constants/theme';
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
  new: NewsColors.text,
  changed: Colors.warning,
  unchanged: NewsColors.textFaint,
};

const confidenceLabel: Record<NewsConfidence, string> = {
  confirmed: 'Confirmed',
  reported: 'Reported',
  disputed: 'Disputed',
  speculative: 'Speculative',
};

const confidenceColor: Record<NewsConfidence, string> = {
  confirmed: Colors.up,
  reported: NewsColors.textMuted,
  disputed: Colors.down,
  speculative: Colors.warning,
};

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.statusBadge}>
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
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={NewsColors.text} />
      }>
      <View style={styles.hero}>
        <View style={styles.topline}>
          <View style={styles.kickerBadge}>
            <View
              style={[
                styles.liveDot,
                { backgroundColor: pulseColor[summary.pulse.label] },
              ]}
            />
            <AppText style={styles.kicker}>
              {pulseLabel[summary.pulse.label]}
            </AppText>
          </View>
          <AppText variant="caption" style={styles.updatedAt}>
            Updated {relativeTime(summary.generatedAt)}
          </AppText>
        </View>
        <AppText variant="heading" style={styles.headline}>{summary.headline}</AppText>
        <AppText style={styles.overview}>{summary.overview}</AppText>
        <View style={styles.marketRead}>
          <AppText style={styles.marketReadLabel}>MARKET READ</AppText>
          <AppText style={styles.marketReadText}>{summary.pulse.summary}</AppText>
        </View>
      </View>

      <View style={styles.sectionHeading}>
        <AppText style={styles.sectionTitle}>Top developments</AppText>
        <AppText style={styles.sectionCount}>
          {summary.bullets.length} {summary.bullets.length === 1 ? 'story' : 'stories'}
        </AppText>
      </View>

      <View style={styles.bulletList}>
        {summary.bullets.map((bullet, index) => {
          const isExpanded = expanded === index;
          return (
            <View key={`${summary.id}:${index}`} style={styles.bulletItem}>
              <View
                style={[
                  styles.bulletColumn,
                  index === summary.bullets.length - 1 && styles.bulletColumnLast,
                ]}>
                <Pressable
                  onPress={() => setExpanded(isExpanded ? null : index)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                  accessibilityLabel={`${bullet.headline}. ${isExpanded ? 'Collapse' : 'Expand'} evidence`}
                  style={({ pressed }) => [styles.bulletButton, pressed && styles.pressed]}>
                  <View style={styles.cardMeta}>
                    <AppText style={styles.cardNumber}>{String(index + 1).padStart(2, '0')}</AppText>
                    <View style={styles.statusGroup}>
                      <StatusBadge label={changeLabel[bullet.change]} color={changeColor[bullet.change]} />
                      <View style={styles.metaDivider} />
                      <StatusBadge label={confidenceLabel[bullet.confidence]} color={confidenceColor[bullet.confidence]} />
                    </View>
                    <View style={styles.sourceMeta}>
                      <AppText style={styles.sourceCount}>
                        {bullet.sources.length} {bullet.sources.length === 1 ? 'ref' : 'refs'}
                      </AppText>
                    </View>
                  </View>

                  <AppText style={styles.bulletHeadline}>{bullet.headline}</AppText>
                  <AppText style={styles.bulletSummary}>{bullet.summary}</AppText>
                  <View style={styles.impactRow}>
                    <View style={styles.impactCopy}>
                      <View style={styles.impactHeading}>
                        <AppText style={styles.impactLabel}>MARKET EFFECT</AppText>
                      </View>
                      <AppText style={styles.impactText}>{bullet.marketImpact}</AppText>
                    </View>
                  </View>

                  <View style={styles.expandHint}>
                    <AppText style={styles.expandHintText}>Evidence</AppText>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={NewsColors.textFaint}
                    />
                  </View>
                </Pressable>

                {isExpanded ? (
                  <View style={styles.expandedBody}>
                    <AppText style={styles.evidenceLabel}>EVIDENCE NOTE</AppText>
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
                          <Ionicons name="open-outline" size={13} color={NewsColors.textMuted} />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
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
              <Ionicons name="layers-outline" size={15} color={NewsColors.textMuted} />
              <AppText style={styles.secondaryTitle}>More signals</AppText>
              <AppText variant="caption">{summary.secondarySignals.length}</AppText>
            </View>
            <Ionicons name={showSecondary ? 'chevron-up' : 'chevron-down'} size={15} color={NewsColors.textMuted} />
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
          {signalCount} source items scanned · weekdays at 09:35 & 16:05 ET
        </AppText>
        <AppText variant="caption" style={styles.footerText}>{summary.noiseSummary}</AppText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, paddingBottom: 40 },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  kickerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 5, height: 5, borderRadius: 2 },
  kicker: { color: NewsColors.textMuted, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  updatedAt: { color: NewsColors.textFaint, fontSize: 11 },
  hero: { gap: 12, paddingTop: 20, paddingBottom: 22, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: NewsColors.border },
  headline: { color: NewsColors.text, fontSize: 25, lineHeight: 31, fontWeight: '600', letterSpacing: -0.5 },
  overview: { color: NewsColors.textMuted, fontSize: 14, lineHeight: 21, fontWeight: '400' },
  marketRead: { gap: 6, paddingLeft: 12, marginTop: 2, borderLeftWidth: 2, borderLeftColor: Colors.accent },
  marketReadLabel: { color: Colors.accent, fontSize: 10, lineHeight: 14, fontWeight: '600', letterSpacing: 0.7 },
  marketReadText: { color: NewsColors.text, fontSize: 13, lineHeight: 20, fontWeight: '400' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 22, paddingBottom: 2 },
  sectionTitle: { color: NewsColors.text, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  sectionCount: { marginLeft: 'auto', color: NewsColors.textFaint, fontSize: 11, fontVariant: ['tabular-nums'] },
  bulletList: { gap: 0 },
  bulletItem: { flexDirection: 'row' },
  bulletColumn: { flex: 1, minWidth: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: NewsColors.border },
  bulletColumnLast: { borderBottomWidth: 0 },
  bulletButton: { gap: 10, paddingVertical: 18 },
  pressed: { opacity: 0.7 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 20 },
  cardNumber: { color: NewsColors.textFaint, fontSize: 11, fontWeight: '500', fontVariant: ['tabular-nums'] },
  statusGroup: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center' },
  statusText: { fontSize: 11, lineHeight: 15, fontWeight: '500' },
  metaDivider: { width: StyleSheet.hairlineWidth, height: 10, backgroundColor: NewsColors.border },
  sourceMeta: { flexDirection: 'row', alignItems: 'center' },
  sourceCount: { color: NewsColors.textFaint, fontSize: 11, lineHeight: 15 },
  bulletHeadline: { color: NewsColors.text, fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.2 },
  bulletSummary: { color: NewsColors.textMuted, fontSize: 14, lineHeight: 21, fontWeight: '400' },
  impactRow: { marginTop: 2 },
  impactCopy: { gap: 4 },
  impactHeading: { flexDirection: 'row', alignItems: 'center' },
  impactLabel: { color: NewsColors.textFaint, fontSize: 10, lineHeight: 14, fontWeight: '600', letterSpacing: 0.7 },
  impactText: { color: NewsColors.text, fontSize: 13, lineHeight: 20, fontWeight: '400' },
  expandHint: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: 26 },
  expandHintText: { color: Colors.accent, fontSize: 12, fontWeight: '500' },
  expandedBody: { gap: 10, marginBottom: 18, paddingLeft: 12, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: NewsColors.border },
  evidenceLabel: { color: NewsColors.textFaint, fontSize: 10, fontWeight: '600', letterSpacing: 0.7 },
  details: { color: NewsColors.textMuted, fontSize: 13, lineHeight: 20, fontWeight: '400' },
  sourceDetails: { gap: 2 },
  sourceDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 7 },
  sourceDetailCopy: { flex: 1, gap: 2 },
  sourceDetailAuthor: { color: NewsColors.text, fontSize: 12, fontWeight: '500' },
  secondarySection: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: NewsColors.border },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  secondaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondaryTitle: { color: NewsColors.text, fontSize: 14, fontWeight: '600' },
  secondaryList: { gap: 10, paddingBottom: 16 },
  secondaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  secondaryDot: { width: 3, height: 3, marginTop: 8, backgroundColor: NewsColors.textFaint },
  secondaryText: { flex: 1, color: NewsColors.textMuted, fontSize: 13, lineHeight: 20 },
  watchSection: { gap: 12, paddingVertical: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: NewsColors.border },
  watchHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  watchTitle: { color: NewsColors.text, fontSize: 14, fontWeight: '600' },
  watchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  watchNumber: { width: 20, color: NewsColors.textFaint, fontSize: 11, lineHeight: 20, fontVariant: ['tabular-nums'] },
  watchText: { flex: 1, color: NewsColors.textMuted, fontSize: 13, lineHeight: 20, fontWeight: '400' },
  footer: { gap: 6, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: NewsColors.border },
  footerText: { color: NewsColors.textFaint, lineHeight: 17, fontSize: 11 },
});
