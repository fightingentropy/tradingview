import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { NewsSourceIcon } from '@/components/NewsSourceIcon';
import { AppText } from '@/components/ui/AppText';
import { Colors, NewsColors, Spacing } from '@/constants/theme';
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
  mixed: 'Mixed signals',
  calm: 'Calm',
  'event-driven': 'Event risk elevated',
};

type Bullet = NewsExecutiveSummary['bullets'][number];

/** Only states worth a glance get a tag; routine ones (reported, unchanged) stay unlabelled. */
function bulletTags(bullet: Bullet): { label: string; color: string }[] {
  const tags: { label: string; color: string }[] = bullet.change === 'new' ? [{ label: 'New', color: Colors.accent }] : [];
  if (bullet.confidence === 'disputed') tags.push({ label: 'Disputed', color: Colors.down });
  if (bullet.confidence === 'speculative') tags.push({ label: 'Unconfirmed', color: Colors.warning });
  return tags;
}

/** The twice-daily Claude read of the feed: a take, three developments, what to watch. */
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
  const [showMore, setShowMore] = useState(false);
  const signalCount = summary.analyzedItems || Object.values(summary.sourceCounts).reduce((sum, count) => sum + count, 0);
  const extraCount = summary.secondarySignals.length + (summary.noiseSummary ? 1 : 0);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={NewsColors.text} />
      }>
      <View style={styles.hero}>
        <View style={styles.topline}>
          <View style={styles.kickerBadge}>
            <View style={[styles.liveDot, { backgroundColor: pulseColor[summary.pulse.label] }]} />
            <AppText style={styles.kicker}>{pulseLabel[summary.pulse.label]}</AppText>
          </View>
          <AppText variant="caption" style={styles.updatedAt}>
            Updated {relativeTime(summary.generatedAt)}
          </AppText>
        </View>
        <AppText variant="heading" style={styles.headline}>{summary.headline}</AppText>
        <AppText style={styles.overview}>{summary.overview}</AppText>
      </View>

      {summary.bullets.map((bullet, index) => {
        const isExpanded = expanded === index;
        const tags = bulletTags(bullet);
        return (
          <View key={`${summary.id}:${index}`} style={styles.bulletItem}>
            <AppText style={styles.bulletNumber}>{index + 1}</AppText>
            <View style={styles.bulletBody}>
              {tags.length > 0 ? (
                <View style={styles.tagRow}>
                  {tags.map((tag) => (
                    <AppText key={tag.label} style={[styles.tag, { color: tag.color }]}>{tag.label}</AppText>
                  ))}
                </View>
              ) : null}
              <AppText style={styles.bulletHeadline}>{bullet.headline}</AppText>
              <AppText style={styles.bulletSummary}>{bullet.summary}</AppText>
              <Pressable
                onPress={() => setExpanded(isExpanded ? null : index)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isExpanded }}
                accessibilityLabel={`${isExpanded ? 'Hide' : 'Show'} sources for ${bullet.headline}`}
                hitSlop={8}
                style={({ pressed }) => [styles.sourcesToggle, pressed && styles.pressed]}>
                <AppText style={[styles.sourcesToggleText, isExpanded && styles.sourcesToggleOpen]}>
                  Sources · {bullet.sources.length}
                </AppText>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={12}
                  color={isExpanded ? Colors.accent : NewsColors.textFaint}
                />
              </Pressable>
              {isExpanded ? (
                <View style={styles.expandedBody}>
                  <AppText style={styles.details}>{bullet.details}</AppText>
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
              ) : null}
            </View>
          </View>
        );
      })}

      {summary.watchNext.length > 0 ? (
        <View style={styles.watchSection}>
          <AppText style={styles.watchLabel}>WATCH</AppText>
          {summary.watchNext.map((item, index) => (
            <AppText key={`${index}:${item}`} style={styles.watchText}>{item}</AppText>
          ))}
        </View>
      ) : null}

      {extraCount > 0 ? (
        <View style={styles.moreSection}>
          <Pressable
            onPress={() => setShowMore((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showMore }}
            style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
            <View style={styles.moreTitleRow}>
              <AppText style={styles.moreTitle}>More</AppText>
              <AppText variant="caption">{extraCount}</AppText>
            </View>
            <Ionicons name={showMore ? 'chevron-up' : 'chevron-down'} size={15} color={NewsColors.textMuted} />
          </Pressable>
          {showMore ? (
            <View style={styles.moreList}>
              {summary.secondarySignals.map((item, index) => (
                <View key={`${index}:${item}`} style={styles.moreRow}>
                  <View style={styles.moreDot} />
                  <AppText style={styles.moreText}>{item}</AppText>
                </View>
              ))}
              {summary.noiseSummary ? (
                <View style={styles.noise}>
                  <AppText style={styles.noiseLabel}>RUMOUR CHECK</AppText>
                  <AppText style={styles.moreText}>{summary.noiseSummary}</AppText>
                </View>
              ) : null}
              <AppText variant="caption" style={styles.footerText}>
                {signalCount} source items scanned · weekdays at 09:35 & 16:05 ET
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}
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
  hero: { gap: 10, paddingTop: 20, paddingBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: NewsColors.border },
  headline: { color: NewsColors.text, fontSize: 25, lineHeight: 31, fontWeight: '600', letterSpacing: -0.5 },
  overview: { color: NewsColors.text, fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bulletItem: { flexDirection: 'row', gap: 8, paddingTop: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: NewsColors.border },
  bulletNumber: { width: 16, color: NewsColors.textFaint, fontSize: 12, lineHeight: 22, fontWeight: '500', fontVariant: ['tabular-nums'] },
  bulletBody: { flex: 1, minWidth: 0, gap: 4 },
  tagRow: { flexDirection: 'row', gap: 10 },
  tag: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
  bulletHeadline: { color: NewsColors.text, fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  bulletSummary: { color: NewsColors.textMuted, fontSize: 14, lineHeight: 21, fontWeight: '400' },
  sourcesToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, minHeight: 28 },
  sourcesToggleText: { color: NewsColors.textFaint, fontSize: 12, fontWeight: '500' },
  sourcesToggleOpen: { color: Colors.accent },
  pressed: { opacity: 0.7 },
  expandedBody: { gap: 6, marginBottom: 8, paddingLeft: 12, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: NewsColors.border },
  details: { color: NewsColors.textMuted, fontSize: 13, lineHeight: 20, fontWeight: '400' },
  sourceDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 7 },
  sourceDetailCopy: { flex: 1, gap: 2 },
  sourceDetailAuthor: { color: NewsColors.text, fontSize: 12, fontWeight: '500' },
  watchSection: { gap: 6, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: NewsColors.border },
  watchLabel: { color: Colors.warning, fontSize: 10, lineHeight: 14, fontWeight: '600', letterSpacing: 0.7 },
  watchText: { color: NewsColors.text, fontSize: 14, lineHeight: 20, fontWeight: '400' },
  moreSection: { marginTop: 2 },
  moreButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  moreTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moreTitle: { color: NewsColors.textMuted, fontSize: 13, fontWeight: '500' },
  moreList: { gap: 10, paddingBottom: 16 },
  moreRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  moreDot: { width: 3, height: 3, marginTop: 8, backgroundColor: NewsColors.textFaint },
  moreText: { flex: 1, color: NewsColors.textMuted, fontSize: 13, lineHeight: 20 },
  noise: { gap: 4, marginTop: 2 },
  noiseLabel: { color: NewsColors.textFaint, fontSize: 10, lineHeight: 14, fontWeight: '600', letterSpacing: 0.7 },
  footerText: { color: NewsColors.textFaint, lineHeight: 17, fontSize: 11 },
});
