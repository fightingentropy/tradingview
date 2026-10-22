import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, NewsColors, Radius, Spacing } from '@/constants/theme';
import { useEarningsCalendar } from '@/data/useEarningsCalendar';
import {
  DEFAULT_EARNINGS_CAP_TIER,
  EARNINGS_CAP_TIERS,
  earningsLines,
  earningsLogoUrl,
  earningsStatus,
  earningsTimingLabel,
  formatMarketCap,
  meetsEarningsCapTier,
  type EarningsCapTier,
  type EarningsReport,
  type EarningsTiming,
} from '@/domain/earningsCalendar';
import { economicCalendarDateKey } from '@/domain/economicCalendar';

const TIMINGS: EarningsTiming[] = ['before_open', 'after_close', 'unknown'];

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Earnings weeks run Sunday to Saturday, like US market calendars. */
function weekStartOf(key: string): string {
  return addDays(key, -new Date(`${key}T12:00:00.000Z`).getUTCDay());
}

function formatDay(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${key}T12:00:00.000Z`).toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(iso));
}

const reportCount = (count: number) =>
  count === 0 ? 'No reports' : `${count} ${count === 1 ? 'report' : 'reports'}`;

const EarningsLogo = memo(function EarningsLogo({ report }: { report: EarningsReport }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.logo}>
      <AppText style={styles.logoInitials} allowFontScaling={false}>
        {report.ticker.slice(0, 3)}
      </AppText>
      {report.logo && !failed ? (
        <Image
          source={earningsLogoUrl(report.logo)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
});

function StatusPill({ report, now }: { report: EarningsReport; now: number }) {
  const status = earningsStatus(report, now);
  if (status !== 'scheduled') {
    const color = status === 'reported' ? Colors.accent : Colors.warning;
    return (
      <View style={[styles.status, { backgroundColor: status === 'reported' ? Colors.accentSoft : 'rgba(221, 187, 114, 0.12)' }]}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <AppText style={[styles.statusText, { color }]}>
          {status === 'reported' ? 'Reported' : 'Awaiting'}
        </AppText>
      </View>
    );
  }
  return (
    <View style={styles.status} accessibilityLabel={earningsTimingLabel(report.timing)}>
      {report.time && report.timing !== 'unknown' ? (
        <Ionicons
          name={report.timing === 'before_open' ? 'sunny-outline' : 'moon-outline'}
          size={12}
          color={NewsColors.textFaint}
        />
      ) : null}
      <AppText numeric style={styles.statusText}>
        {report.time ? formatTime(report.time) : 'TBC'}
      </AppText>
    </View>
  );
}

const EarningsRow = memo(function EarningsRow({ report, now }: { report: EarningsReport; now: number }) {
  const lines = earningsLines(report);
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <EarningsLogo report={report} />
        <View style={styles.company}>
          <AppText numberOfLines={1} style={styles.companyName}>
            {report.name}
          </AppText>
          <AppText numberOfLines={1} style={styles.companyMeta}>
            <AppText style={styles.ticker}>{report.ticker}</AppText>
            {report.marketCap ? `  ${formatMarketCap(report.marketCap, report.currency)}` : ''}
          </AppText>
        </View>
        <View style={styles.when}>
          {report.period ? <AppText style={styles.period}>{report.period}</AppText> : null}
          <StatusPill report={report} now={now} />
        </View>
      </View>
      <View style={styles.lines}>
        {lines.length === 0 ? (
          <AppText style={[styles.lineText, styles.lineMuted]}>No consensus estimates yet.</AppText>
        ) : (
          lines.map((line) => (
            <View key={line.text} style={styles.line}>
              <View style={styles.bullet} />
              <AppText numeric style={styles.lineText}>
                {line.text}
                {line.surprise ? (
                  <AppText
                    style={[
                      styles.surprise,
                      line.surprise.tone === 'beat' && { color: Colors.up },
                      line.surprise.tone === 'miss' && { color: Colors.down },
                    ]}>
                    {` · ${line.surprise.label}`}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))
        )}
      </View>
    </View>
  );
});

export default function EarningsCalendarScreen() {
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => Date.now());
  const today = economicCalendarDateKey(new Date(now));
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  // Until a day is picked, the strip settles on the next day with reports.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [capTier, setCapTier] = useState<EarningsCapTier>(DEFAULT_EARNINGS_CAP_TIER);
  const weekEnd = addDays(weekStart, 6);
  const query = useEarningsCalendar(weekStart, weekEnd, weekStart <= today && today <= weekEnd);
  const { data, isPending, isError, error, refetch, isRefetching } = query;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const byDay = useMemo(() => {
    const map = new Map<string, EarningsReport[]>();
    for (const report of data?.reports ?? []) {
      if (!meetsEarningsCapTier(report, capTier)) continue;
      map.set(report.date, [...(map.get(report.date) ?? []), report]);
    }
    return map;
  }, [capTier, data]);
  const day = useMemo(() => {
    if (pickedDay) return pickedDay;
    const has = (key: string) => (byDay.get(key)?.length ?? 0) > 0;
    const start = days.includes(today) ? today : days[0];
    return days.find((key) => key >= start && has(key)) ?? days.find(has) ?? (days.includes(today) ? today : days[1]);
  }, [byDay, days, pickedDay, today]);
  const sections = useMemo(
    () =>
      TIMINGS.map((timing) => ({
        title: earningsTimingLabel(timing),
        data: (byDay.get(day) ?? []).filter((report) => report.timing === timing),
      })).filter((section) => section.data.length > 0),
    [byDay, day],
  );

  const showWeek = (start: string) => {
    setWeekStart(start);
    setPickedDay(null);
  };
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/news');
  };

  const header = (
    <>
      <View style={styles.header}>
        <View style={styles.headerTitleSlot}>
          <AppText numberOfLines={1} style={styles.headerTitle}>
            Earnings Calendar
          </AppText>
        </View>
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close earnings calendar"
          style={styles.headerButton}>
          <Ionicons name="close" size={27} color={NewsColors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.weekNav}>
        <Pressable
          onPress={() => showWeek(addDays(weekStart, -7))}
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          style={styles.navButton}>
          <Ionicons name="chevron-back" size={20} color={NewsColors.textMuted} />
        </Pressable>
        <AppText style={styles.weekLabel}>
          {formatDay(weekStart, { day: 'numeric', month: 'short' })} –{' '}
          {formatDay(weekEnd, { day: 'numeric', month: 'short', year: 'numeric' })}
        </AppText>
        <Pressable
          onPress={() => showWeek(addDays(weekStart, 7))}
          accessibilityRole="button"
          accessibilityLabel="Next week"
          style={styles.navButton}>
          <Ionicons name="chevron-forward" size={20} color={NewsColors.textMuted} />
        </Pressable>
        <Pressable
          onPress={() => {
            setWeekStart(weekStartOf(today));
            setPickedDay(today);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: day === today }}
          style={[styles.todayButton, day === today && styles.todayButtonSelected]}>
          <AppText style={[styles.todayText, day === today && styles.todayTextSelected]}>Today</AppText>
        </Pressable>
      </View>

      <View style={styles.week}>
        {days.map((key) => {
          const selected = key === day;
          const count = byDay.get(key)?.length ?? 0;
          return (
            <Pressable
              key={key}
              onPress={() => setPickedDay(key)}
              accessibilityRole="button"
              accessibilityLabel={`${formatDay(key, { weekday: 'long', day: 'numeric', month: 'long' })}${data ? `, ${reportCount(count)}` : ''}`}
              accessibilityState={{ selected }}
              style={[styles.day, selected && styles.daySelected]}>
              <AppText style={[styles.dayName, key === today && styles.dayToday]}>
                {formatDay(key, { weekday: 'short' })}
              </AppText>
              <AppText numeric style={styles.dayNumber}>
                {formatDay(key, { day: 'numeric' })}
              </AppText>
              <AppText numeric style={[styles.dayCount, count === 0 && styles.dayCountEmpty]}>
                {data ? count || '–' : ' '}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}>
        {EARNINGS_CAP_TIERS.map((tier) => {
          const selected = tier.value === capTier;
          return (
            <Pressable
              key={tier.value}
              onPress={() => setCapTier(tier.value)}
              accessibilityRole="button"
              accessibilityLabel={`Market cap ${tier.label}`}
              accessibilityState={{ selected }}
              style={[styles.chip, selected && styles.chipSelected]}>
              <AppText style={[styles.chipText, selected && styles.chipTextSelected]}>{tier.label}</AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.dayHeading}>
        <AppText style={styles.dayHeadingText}>
          {formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}
        </AppText>
        {data ? <AppText style={styles.dayHeadingCount}>{reportCount(byDay.get(day)?.length ?? 0)}</AppText> : null}
      </View>
      {isError && data !== undefined ? (
        <Pressable onPress={() => void refetch()} style={styles.retry}>
          <AppText style={styles.retryText}>Couldn’t refresh · Showing saved reports · Retry</AppText>
        </Pressable>
      ) : null}
    </>
  );

  return (
    <Screen edges={['bottom']} style={styles.screen}>
      <View style={[styles.content, { paddingTop: Math.max(insets.top, Platform.OS === 'ios' ? 52 : 0) }]}>
        <SectionList
          sections={sections}
          keyExtractor={(report) => report.symbol}
          renderItem={({ item }) => <EarningsRow report={item} now={now} />}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <AppText style={styles.sectionTitle}>{section.title.toUpperCase()}</AppText>
              <AppText style={styles.sectionCount}>{reportCount(section.data.length)}</AppText>
            </View>
          )}
          stickySectionHeadersEnabled
          ListHeaderComponent={header}
          ListEmptyComponent={
            isPending ? (
              <View style={styles.center}>
                <ActivityIndicator color={NewsColors.text} accessibilityLabel="Loading earnings" />
              </View>
            ) : isError && data === undefined ? (
              <View style={styles.center}>
                <Ionicons name="bar-chart-outline" size={32} color={NewsColors.textMuted} />
                <AppText style={styles.stateTitle}>Earnings unavailable</AppText>
                <AppText style={styles.stateBody}>
                  {error instanceof Error ? error.message : 'Could not load earnings reports.'}
                </AppText>
                <Pressable onPress={() => void refetch()} style={styles.retry}>
                  <AppText style={styles.retryText}>Try again</AppText>
                </Pressable>
              </View>
            ) : (
              <View style={styles.center}>
                <Ionicons name="calendar-clear-outline" size={30} color={NewsColors.textMuted} />
                <AppText style={styles.stateTitle}>
                  {(data?.reports.length ?? 0) === 0 ? 'No earnings listed this week' : 'No reports on this day'}
                </AppText>
                <AppText style={styles.stateBody}>
                  {(data?.reports.length ?? 0) === 0
                    ? 'TradingView lists each company’s latest and next report, so weeks far from today are incomplete.'
                    : capTier !== 'all'
                      ? 'Choose another day or a wider market-cap range.'
                      : 'Choose another day.'}
                </AppText>
              </View>
            )
          }
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={NewsColors.text} />
          }
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: NewsColors.background },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    backgroundColor: NewsColors.background,
  },
  listContent: { paddingBottom: Spacing.xxl },
  header: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  headerTitleSlot: { flex: 1, minWidth: 0 },
  headerTitle: { color: NewsColors.text, fontSize: 21, lineHeight: 27, fontWeight: '600' },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NewsColors.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
  },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  navButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  weekLabel: { color: NewsColors.text, fontSize: 14, fontWeight: '500', textAlign: 'center', minWidth: 150 },
  todayButton: {
    marginLeft: 'auto',
    marginRight: Spacing.sm,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.controlBorder,
  },
  todayButtonSelected: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  todayText: { color: NewsColors.textMuted, fontSize: 13, fontWeight: '600' },
  todayTextSelected: { color: Colors.accent },
  week: { flexDirection: 'row', paddingHorizontal: Spacing.md, gap: 4 },
  day: {
    flex: 1,
    minWidth: 0,
    height: 66,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    backgroundColor: NewsColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  daySelected: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  dayName: { color: NewsColors.textMuted, fontSize: 11, fontWeight: '500' },
  dayToday: { color: Colors.accent },
  dayNumber: { color: NewsColors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  dayCount: { color: NewsColors.textMuted, fontSize: 11, fontWeight: '500' },
  dayCountEmpty: { color: NewsColors.textFaint },
  chips: { gap: 6, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  chip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.controlBorder,
  },
  chipSelected: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  chipText: { color: NewsColors.textMuted, fontSize: 13, fontWeight: '500' },
  chipTextSelected: { color: Colors.accent },
  dayHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  dayHeadingText: { color: NewsColors.text, fontSize: 17, fontWeight: '600' },
  dayHeadingCount: { color: NewsColors.textFaint, fontSize: 13 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    backgroundColor: NewsColors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: NewsColors.border,
  },
  sectionTitle: { color: NewsColors.textFaint, fontSize: 11, fontWeight: '600', letterSpacing: 0.8 },
  sectionCount: { color: NewsColors.textFaint, fontSize: 12 },
  row: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: NewsColors.border,
    gap: 10,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
  },
  logoInitials: { color: NewsColors.textMuted, fontSize: 11, fontWeight: '700' },
  company: { flex: 1, minWidth: 0 },
  companyName: { color: NewsColors.text, fontSize: 15, lineHeight: 20, fontWeight: '500' },
  companyMeta: { color: NewsColors.textFaint, fontSize: 13, lineHeight: 18 },
  ticker: { color: NewsColors.textMuted, fontSize: 13, fontWeight: '600' },
  when: { alignItems: 'flex-end', gap: 4 },
  period: { color: NewsColors.textMuted, fontSize: 12, fontWeight: '500' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    backgroundColor: NewsColors.chip,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { color: NewsColors.textMuted, fontSize: 12, fontWeight: '600' },
  lines: { gap: 5 },
  line: { flexDirection: 'row', gap: 9 },
  bullet: { width: 4, height: 4, borderRadius: 2, marginTop: 8, backgroundColor: NewsColors.textFaint },
  lineText: { flex: 1, color: NewsColors.textMuted, fontSize: 14, lineHeight: 20 },
  lineMuted: { color: NewsColors.textFaint },
  surprise: { fontWeight: '600', color: NewsColors.textMuted },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingTop: 56,
    gap: 10,
  },
  stateTitle: { color: NewsColors.text, fontSize: 19, fontWeight: '600', textAlign: 'center' },
  stateBody: { color: NewsColors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: {
    alignSelf: 'center',
    marginVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: NewsColors.chip,
  },
  retryText: { color: NewsColors.text, fontSize: 13, fontWeight: '500' },
});
