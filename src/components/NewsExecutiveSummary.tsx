import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { NewsSourceIcon } from '@/components/NewsSourceIcon';
import { AppText } from '@/components/ui/AppText';
import { Colors, NewsColors, Radius, Spacing } from '@/constants/theme';
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
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={NewsColors.text} />
      }>
      <View style={styles.hero}>
        <View style={styles.topline}>
          <View style={[
            styles.kickerBadge,
            { borderColor: `${pulseColor[summary.pulse.label]}80` },
          ]}>
            <View style={[styles.liveDot, { backgroundColor: pulseColor[summary.pulse.label] }]} />
            <AppText style={[styles.kicker, { color: pulseColor[summary.pulse.label] }]}>
              {pulseLabel[summary.pulse.label].toUpperCase()}
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
        <View style={styles.sectionMarker} />
        <AppText style={styles.sectionTitle}>Top developments</AppText>
        <AppText style={styles.sectionCount}>
          {summary.bullets.length} {summary.bullets.length === 1 ? 'story' : 'stories'}
        </AppText>
      </View>

      <View style={styles.bulletList}>
        {summary.bullets.map((bullet, index) => {
          const isExpanded = expanded === index;
          const uniqueSources = bullet.sources.filter(
            (source, sourceIndex, sources) =>
              sources.findIndex((candidate) => candidate.source === source.source) === sourceIndex,
          );
          return (
            <View key={`${summary.id}:${index}`} style={styles.bulletItem}>
              <View style={styles.bulletRail}>
                <AppText style={styles.cardNumber}>{String(index + 1).padStart(2, '0')}</AppText>
                <View style={[styles.railNode, { backgroundColor: changeColor[bullet.change] }]} />
                {index < summary.bullets.length - 1 ? <View style={styles.railLine} /> : null}
              </View>

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
                    <View style={styles.statusGroup}>
                      <StatusBadge label={changeLabel[bullet.change]} color={changeColor[bullet.change]} />
                      <View style={styles.metaDivider} />
                      <StatusBadge label={confidenceLabel[bullet.confidence]} color={confidenceColor[bullet.confidence]} />
                    </View>
                    <View style={styles.sourceMeta}>
                      <View style={styles.sourceIcons}>
                        {uniqueSources.slice(0, 3).map((source, sourceIndex) => (
                          <View
                            key={source.source}
                            style={[
                              styles.sourceIconShell,
                              sourceIndex > 0 && styles.sourceIconOverlap,
                              { zIndex: uniqueSources.length - sourceIndex },
                            ]}>
                            <NewsSourceIcon source={source.source} size={16} />
                          </View>
                        ))}
                      </View>
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
                        <Ionicons name="trending-up-outline" size={15} color={Colors.accent} />
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
  content: { padding: Spacing.lg, paddingBottom: 56, gap: 24 },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kickerBadge: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: Radius.pill,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 0.85 },
  updatedAt: { color: NewsColors.textFaint },
  hero: {
    gap: 13,
    padding: 22,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    borderRadius: Radius.lg,
    backgroundColor: NewsColors.surface,
  },
  headline: {
    color: NewsColors.text,
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '700',
    letterSpacing: -0.65,
  },
  overview: { color: NewsColors.textMuted, fontSize: 15, lineHeight: 22, fontWeight: '400' },
  marketRead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 2,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: NewsColors.border,
  },
  marketReadLabel: {
    width: 72,
    color: NewsColors.textFaint,
    fontSize: 9,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  marketReadText: {
    flex: 1,
    color: NewsColors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionMarker: { width: 3, height: 22, borderRadius: 2, backgroundColor: Colors.accent },
  sectionTitle: { color: NewsColors.text, fontSize: 20, lineHeight: 24, fontWeight: '700' },
  sectionCount: {
    marginLeft: 'auto',
    color: NewsColors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  bulletList: { gap: 0 },
  bulletItem: { flexDirection: 'row', gap: 14 },
  bulletRail: { width: 25, alignItems: 'center', paddingTop: 19 },
  railNode: {
    width: 6,
    height: 6,
    marginTop: 9,
    borderRadius: 3,
  },
  railLine: {
    width: StyleSheet.hairlineWidth,
    flex: 1,
    marginTop: 6,
    backgroundColor: 'rgba(120, 144, 255, 0.22)',
  },
  bulletColumn: {
    flex: 1,
    minWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: NewsColors.border,
  },
  bulletColumnLast: { borderBottomWidth: 0 },
  bulletButton: { gap: 11, paddingTop: 18, paddingBottom: 20, paddingRight: 2 },
  pressed: { opacity: 0.7 },
  cardMeta: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardNumber: {
    color: NewsColors.textFaint,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  statusGroup: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: { width: 4, height: 4, borderRadius: 2 },
  statusText: { fontSize: 10, lineHeight: 13, fontWeight: '700', letterSpacing: 0.2 },
  metaDivider: { width: 1, height: 10, backgroundColor: NewsColors.border },
  sourceMeta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sourceIcons: { flexDirection: 'row', alignItems: 'center' },
  sourceIconShell: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: NewsColors.background,
    backgroundColor: NewsColors.surfaceRaised,
  },
  sourceIconOverlap: { marginLeft: -7 },
  sourceCount: { color: NewsColors.textFaint, fontSize: 10, lineHeight: 13, fontWeight: '600' },
  bulletHeadline: {
    color: NewsColors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
    letterSpacing: -0.28,
  },
  bulletSummary: { color: NewsColors.textMuted, fontSize: 14, lineHeight: 21, fontWeight: '400' },
  impactRow: {
    marginTop: 2,
    paddingLeft: 14,
    paddingVertical: 3,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(120, 144, 255, 0.52)',
  },
  impactCopy: { gap: 5 },
  impactHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  impactLabel: { color: Colors.accent, fontSize: 9, lineHeight: 12, fontWeight: '800', letterSpacing: 0.65 },
  impactText: {
    color: NewsColors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  expandHint: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, marginTop: 1 },
  expandHintText: { color: NewsColors.textFaint, fontSize: 10, fontWeight: '600' },
  expandedBody: {
    gap: 10,
    marginBottom: 18,
    padding: 14,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  evidenceLabel: {
    color: Colors.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.75,
  },
  details: { color: NewsColors.textMuted, fontSize: 13, lineHeight: 19, fontWeight: '400' },
  sourceDetails: { gap: 1 },
  sourceDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  sourceDetailCopy: { flex: 1, gap: 1 },
  sourceDetailAuthor: { color: NewsColors.text, fontSize: 12, fontWeight: '600' },
  secondarySection: {
    overflow: 'hidden',
    paddingHorizontal: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    borderRadius: 18,
    backgroundColor: NewsColors.surface,
  },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  secondaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  secondaryTitle: { color: NewsColors.text, fontSize: 13, fontWeight: '700' },
  secondaryList: { gap: 9, paddingBottom: 12 },
  secondaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  secondaryDot: {
    width: 4,
    height: 4,
    marginTop: 7,
    borderRadius: 2,
    backgroundColor: NewsColors.textFaint,
  },
  secondaryText: { flex: 1, color: NewsColors.textMuted, fontSize: 12, lineHeight: 18 },
  watchSection: {
    gap: 10,
    padding: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    borderRadius: 18,
    backgroundColor: NewsColors.surface,
  },
  watchHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  watchTitle: { color: NewsColors.text, fontSize: 14, fontWeight: '800' },
  watchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  watchNumber: { width: 18, color: Colors.warning, fontSize: 10, lineHeight: 18, fontWeight: '800' },
  watchText: {
    flex: 1,
    color: NewsColors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  footer: { gap: 4, paddingTop: 3 },
  footerText: { color: NewsColors.textFaint, textAlign: 'center', lineHeight: 16 },
});
