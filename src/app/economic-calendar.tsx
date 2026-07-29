import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { NewsColors, Radius, Spacing } from '@/constants/theme';
import { useEconomicCalendar } from '@/data/useEconomicCalendar';
import {
  DEFAULT_ECONOMIC_CALENDAR_IMPORTANCES,
  ECONOMIC_CALENDAR_COUNTRIES,
  ECONOMIC_CALENDAR_COUNTRY_CODES,
  countryCodeToFlag,
  economicCalendarDateFromKey,
  economicCalendarDateKey,
  economicCalendarEventDescriptor,
  filterEconomicCalendarEvents,
  formatEconomicCalendarValue,
  type EconomicCalendarEvent,
  type EconomicCalendarImportance,
} from '@/domain/economicCalendar';
import { useEconomicCalendarFilters } from '@/store/economicCalendarFilters';

type CalendarListItem =
  | { type: 'event'; event: EconomicCalendarEvent }
  | { type: 'now'; id: string };

const IMPORTANCE_OPTIONS: {
  value: EconomicCalendarImportance;
  label: string;
  description: string;
}[] = [
  { value: -1, label: 'Low', description: 'Routine releases' },
  { value: 0, label: 'Medium', description: 'Market moving' },
  { value: 1, label: 'High', description: 'Major releases' },
];

function sameSelection<T extends string | number>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function dateWithOffset(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
}

function weekForDate(selectedDate: Date): Date[] {
  const start = dateWithOffset(selectedDate, -selectedDate.getDay());
  return Array.from({ length: 7 }, (_, index) => dateWithOffset(start, index));
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function ImpactIndicator({ importance }: { importance: EconomicCalendarEvent['importance'] }) {
  const activeBars = importance + 2;
  return (
    <View style={styles.impact} accessibilityLabel={`${activeBars} of 3 impact`}>
      {[0, 1, 2].map((bar) => (
        <View
          key={bar}
          style={[styles.impactBar, bar < activeBars && styles.impactBarActive]}
        />
      ))}
    </View>
  );
}

function EventValues({ event }: { event: EconomicCalendarEvent }) {
  const descriptor = economicCalendarEventDescriptor(event);
  if (descriptor) {
    return <AppText style={styles.eventDescriptor}>{descriptor}</AppText>;
  }

  const values = [
    { label: 'Actual', value: event.actual },
    { label: 'Forecast', value: event.forecast },
    { label: 'Prior', value: event.previous },
  ];
  return (
    <View style={styles.values}>
      {values.map((item) => (
        <View key={item.label} style={styles.valueColumn}>
          <AppText style={styles.valueLabel}>{item.label}</AppText>
          <AppText numeric style={styles.valueText}>
            {formatEconomicCalendarValue(item.value, event.unit)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function EventRow({ event }: { event: EconomicCalendarEvent }) {
  const title =
    event.period && !event.title.toLowerCase().includes(event.period.toLowerCase())
      ? `${event.title} (${event.period})`
      : event.title;

  return (
    <View style={styles.eventRow}>
      <View style={styles.eventMeta}>
        <AppText numeric style={styles.eventTime}>
          {formatTime(new Date(event.date))}
        </AppText>
        <AppText style={styles.flag} accessibilityLabel={event.country}>
          {countryCodeToFlag(event.country)}
        </AppText>
      </View>
      <View style={styles.eventBody}>
        <View style={styles.eventTitleRow}>
          <ImpactIndicator importance={event.importance} />
          <AppText style={styles.eventTitle}>{title}</AppText>
        </View>
        <EventValues event={event} />
      </View>
    </View>
  );
}

function NowMarker({ now }: { now: Date }) {
  return (
    <View style={styles.nowRow} accessibilityLabel={`Current time ${formatTime(now)}`}>
      <View style={styles.nowPill}>
        <AppText numeric style={styles.nowText}>
          {formatTime(now)}
        </AppText>
      </View>
      <View style={styles.nowLine} />
    </View>
  );
}

type CalendarFiltersProps = {
  bottomInset: number;
  selectedCountries: readonly string[];
  selectedImportances: readonly EconomicCalendarImportance[];
  onClose: () => void;
  onApply: (
    countries: string[],
    importances: EconomicCalendarImportance[],
  ) => void;
};

function CalendarFilters({
  bottomInset,
  selectedCountries,
  selectedImportances,
  onClose,
  onApply,
}: CalendarFiltersProps) {
  const [draftCountries, setDraftCountries] = useState<string[]>([
    ...selectedCountries,
  ]);
  const [draftImportances, setDraftImportances] = useState<
    EconomicCalendarImportance[]
  >([...selectedImportances]);

  const toggleCountry = (code: string) => {
    setDraftCountries((current) => {
      if (current.length === ECONOMIC_CALENDAR_COUNTRY_CODES.length) return [code];
      if (!current.includes(code)) return [...current, code];
      return current.length === 1 ? current : current.filter((item) => item !== code);
    });
  };

  const toggleImportance = (importance: EconomicCalendarImportance) => {
    setDraftImportances((current) => {
      if (!current.includes(importance)) {
        return [...current, importance].sort((left, right) => left - right);
      }
      return current.length === 1
        ? current
        : current.filter((item) => item !== importance);
    });
  };

  const allCountriesSelected =
    draftCountries.length === ECONOMIC_CALENDAR_COUNTRY_CODES.length;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}>
      <View style={styles.filterOverlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss calendar filters"
        />
        <View
          style={[
            styles.filterSheet,
            { paddingBottom: Math.max(bottomInset, Spacing.lg) },
          ]}>
          <View style={styles.sheetHandle} />
          <View style={styles.filterSheetHeader}>
            <View>
              <AppText style={styles.filterSheetTitle}>Calendar filters</AppText>
              <AppText style={styles.filterSheetSubtitle}>
                Choose countries and indicator severity
              </AppText>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close calendar filters"
              style={styles.sheetClose}>
              <Ionicons name="close" size={23} color={NewsColors.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.filterScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.filterForm}>
            <View style={styles.filterSectionHeader}>
              <AppText style={styles.filterSectionTitle}>Severity</AppText>
              <AppText style={styles.filterSelectionCount}>
                {draftImportances.length} selected
              </AppText>
            </View>
            <View style={styles.severityOptions}>
              {IMPORTANCE_OPTIONS.map((option) => {
                const selected = draftImportances.includes(option.value);
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => toggleImportance(option.value)}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.label} severity`}
                    accessibilityState={{ selected }}
                    style={[
                      styles.severityOption,
                      selected && styles.filterOptionSelected,
                    ]}>
                    <ImpactIndicator importance={option.value} />
                    <AppText style={styles.severityLabel}>{option.label}</AppText>
                    <AppText numberOfLines={1} style={styles.severityDescription}>
                      {option.description}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.filterSectionHeader, styles.countriesHeader]}>
              <AppText style={styles.filterSectionTitle}>Countries</AppText>
              <AppText style={styles.filterSelectionCount}>
                {draftCountries.length} selected
              </AppText>
            </View>
            <Pressable
              onPress={() => setDraftCountries([...ECONOMIC_CALENDAR_COUNTRY_CODES])}
              accessibilityRole="button"
              accessibilityState={{ selected: allCountriesSelected }}
              style={[
                styles.allCountriesOption,
                allCountriesSelected && styles.filterOptionSelected,
              ]}>
              <Ionicons
                name={allCountriesSelected ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={
                  allCountriesSelected ? '#1596DF' : NewsColors.textMuted
                }
              />
              <AppText style={styles.allCountriesText}>All countries</AppText>
            </Pressable>

            <View style={styles.countryGrid}>
              {ECONOMIC_CALENDAR_COUNTRIES.map((country) => {
                const selected = draftCountries.includes(country.code);
                return (
                  <Pressable
                    key={country.code}
                    onPress={() => toggleCountry(country.code)}
                    accessibilityRole="button"
                    accessibilityLabel={country.name}
                    accessibilityState={{ selected }}
                    style={[
                      styles.countryOption,
                      selected && styles.filterOptionSelected,
                    ]}>
                    <AppText style={styles.countryFlag}>
                      {countryCodeToFlag(country.code)}
                    </AppText>
                    <AppText numberOfLines={1} style={styles.countryName}>
                      {country.name}
                    </AppText>
                    {selected ? (
                      <Ionicons name="checkmark" size={16} color="#1596DF" />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.filterActions}>
            <Pressable
              onPress={() => {
                setDraftCountries([...ECONOMIC_CALENDAR_COUNTRY_CODES]);
                setDraftImportances([...DEFAULT_ECONOMIC_CALENDAR_IMPORTANCES]);
              }}
              accessibilityRole="button"
              style={styles.resetButton}>
              <AppText style={styles.resetButtonText}>Reset</AppText>
            </Pressable>
            <Pressable
              onPress={() => onApply(draftCountries, draftImportances)}
              accessibilityRole="button"
              style={styles.applyButton}>
              <AppText style={styles.applyButtonText}>Apply filters</AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function EconomicCalendarScreen() {
  const insets = useSafeAreaInsets();
  const [selectedDateKey, setSelectedDateKey] = useState(() =>
    economicCalendarDateKey(new Date()),
  );
  const [filtersVisible, setFiltersVisible] = useState(false);
  const selectedCountries = useEconomicCalendarFilters(
    (state) => state.selectedCountries,
  );
  const selectedImportances = useEconomicCalendarFilters(
    (state) => state.selectedImportances,
  );
  const setFilters = useEconomicCalendarFilters((state) => state.setFilters);
  const [now, setNow] = useState(() => new Date());
  const selectedDate = useMemo(
    () => economicCalendarDateFromKey(selectedDateKey),
    [selectedDateKey],
  );
  const week = useMemo(() => weekForDate(selectedDate), [selectedDate]);
  const { data = [], isLoading, isError, error, refetch, isRefetching } =
    useEconomicCalendar(selectedDateKey);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const activeFilterCount =
    Number(!sameSelection(selectedCountries, ECONOMIC_CALENDAR_COUNTRY_CODES)) +
    Number(
      !sameSelection(
        selectedImportances,
        DEFAULT_ECONOMIC_CALENDAR_IMPORTANCES,
      ),
    );

  const listItems = useMemo<CalendarListItem[]>(() => {
    const visibleEvents = filterEconomicCalendarEvents(
      data,
      selectedCountries,
      selectedImportances,
    );
    const items: CalendarListItem[] = visibleEvents.map((event) => ({
      type: 'event',
      event,
    }));
    if (
      selectedDateKey === economicCalendarDateKey(now) &&
      visibleEvents.length > 0
    ) {
      const nextIndex = visibleEvents.findIndex(
        (event) => Date.parse(event.date) > now.getTime(),
      );
      items.splice(nextIndex < 0 ? items.length : nextIndex, 0, {
        type: 'now',
        id: `now-${selectedDateKey}`,
      });
    }
    return items;
  }, [data, now, selectedCountries, selectedDateKey, selectedImportances]);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/news');
  };

  const header = (
    <>
      <View style={styles.header}>
        <View style={styles.headerTitleSlot}>
          <AppText numberOfLines={1} style={styles.headerTitle}>
            Economic Calendar
          </AppText>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setFiltersVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={
              activeFilterCount > 0
                ? `Calendar filters, ${activeFilterCount} applied`
                : 'Open calendar filters'
            }
            accessibilityState={{ selected: activeFilterCount > 0 }}
            style={[
              styles.headerButton,
              activeFilterCount > 0 && styles.headerButtonSelected,
            ]}>
            <Ionicons
              name="filter"
              size={21}
              color={activeFilterCount > 0 ? '#1596DF' : NewsColors.textMuted}
            />
            {activeFilterCount > 0 ? (
              <View style={styles.filterBadge}>
                <AppText style={styles.filterBadgeText}>{activeFilterCount}</AppText>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close economic calendar"
            style={styles.headerButton}>
            <Ionicons name="close" size={27} color={NewsColors.textMuted} />
          </Pressable>
        </View>
      </View>

      <AppText style={styles.month}>
        {selectedDate.toLocaleDateString(undefined, { month: 'long' })}
      </AppText>
      <View style={styles.week}>
        {week.map((date) => {
          const dateKey = economicCalendarDateKey(date);
          const selected = dateKey === selectedDateKey;
          const weekend = date.getDay() === 0 || date.getDay() === 6;
          return (
            <Pressable
              key={dateKey}
              onPress={() => setSelectedDateKey(dateKey)}
              disabled={weekend}
              accessibilityRole="button"
              accessibilityLabel={date.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
              accessibilityState={{ selected, disabled: weekend }}
              style={[styles.day, selected && styles.daySelected, weekend && styles.dayDisabled]}>
              <AppText numeric style={[styles.dayNumber, selected && styles.dayTextSelected]}>
                {String(date.getDate()).padStart(2, '0')}
              </AppText>
              <AppText style={[styles.dayName, selected && styles.dayTextSelected]}>
                {date.toLocaleDateString(undefined, { weekday: 'short' })}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </>
  );

  return (
    <Screen edges={['bottom']} style={styles.screen}>
      <View
        style={[
          styles.content,
          { paddingTop: Math.max(insets.top, Platform.OS === 'ios' ? 52 : 0) },
        ]}>
        {isLoading ? (
          <>
            {header}
            <View style={styles.center}>
              <ActivityIndicator color={NewsColors.text} />
            </View>
          </>
        ) : isError ? (
          <>
            {header}
            <View style={styles.center}>
              <Ionicons name="calendar-outline" size={32} color={NewsColors.textMuted} />
              <AppText style={styles.stateTitle}>Calendar unavailable</AppText>
              <AppText style={styles.stateBody}>
                {error instanceof Error ? error.message : 'Could not load economic events.'}
              </AppText>
              <Pressable onPress={() => void refetch()} style={styles.retry}>
                <AppText style={styles.retryText}>Try again</AppText>
              </Pressable>
            </View>
          </>
        ) : (
          <FlatList
            data={listItems}
            keyExtractor={(item) =>
              item.type === 'now' ? item.id : `${item.event.id}:${item.event.date}`
            }
            renderItem={({ item }) =>
              item.type === 'now' ? <NowMarker now={now} /> : <EventRow event={item.event} />
            }
            ListHeaderComponent={header}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="calendar-clear-outline" size={30} color={NewsColors.textMuted} />
                <AppText style={styles.stateTitle}>No matching events</AppText>
                <AppText style={styles.stateBody}>
                  {activeFilterCount > 0
                    ? 'Adjust the country or severity filters to see more releases.'
                    : 'Choose another weekday to see upcoming releases.'}
                </AppText>
              </View>
            }
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={refetch}
                tintColor={NewsColors.text}
              />
            }
          />
        )}
      </View>
      {filtersVisible ? (
        <CalendarFilters
          bottomInset={insets.bottom}
          selectedCountries={selectedCountries}
          selectedImportances={selectedImportances}
          onClose={() => setFiltersVisible(false)}
          onApply={(countries, importances) => {
            setFilters(countries, importances);
            setFiltersVisible(false);
          }}
        />
      ) : null}
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
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  headerTitleSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  headerTitle: {
    color: NewsColors.text,
    fontSize: 19,
    fontWeight: '600',
    textAlign: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexShrink: 0,
  },
  headerButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NewsColors.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
  },
  headerButtonSelected: {
    borderColor: '#1596DF',
    backgroundColor: '#071722',
  },
  filterBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1596DF',
  },
  filterBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
  month: {
    color: NewsColors.textMuted,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  week: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.xl,
  },
  day: {
    flex: 1,
    minWidth: 0,
    height: 66,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  daySelected: { borderColor: NewsColors.selected },
  dayDisabled: { opacity: 0.34 },
  dayNumber: {
    color: NewsColors.text,
    fontSize: 18,
    fontWeight: '500',
    lineHeight: 23,
  },
  dayName: {
    color: NewsColors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 19,
  },
  dayTextSelected: { color: NewsColors.text },
  eventRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 13,
    minHeight: 104,
  },
  eventMeta: { width: 74, paddingTop: 2 },
  eventTime: {
    color: NewsColors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  flag: { fontSize: 25, marginTop: 14 },
  eventBody: { flex: 1, minWidth: 0 },
  eventTitleRow: {
    minHeight: 27,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  impact: { flexDirection: 'row', gap: 2, paddingTop: 6 },
  impactBar: {
    width: 6,
    height: 10,
    borderRadius: 2,
    backgroundColor: '#24282E',
  },
  impactBarActive: { backgroundColor: '#1596DF' },
  eventTitle: {
    flex: 1,
    color: NewsColors.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '500',
  },
  values: { flexDirection: 'row', marginTop: 8 },
  valueColumn: { flex: 1 },
  valueLabel: { color: NewsColors.textFaint, fontSize: 12, fontWeight: '500' },
  valueText: {
    color: NewsColors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  eventDescriptor: {
    color: NewsColors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
    marginLeft: 28,
  },
  nowRow: {
    minHeight: 35,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.lg,
  },
  nowPill: {
    minWidth: 61,
    height: 25,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NewsColors.selected,
  },
  nowText: {
    color: NewsColors.onSelected,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  nowLine: {
    flex: 1,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: NewsColors.selected,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 10,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingTop: 70,
    gap: 10,
  },
  stateTitle: {
    color: NewsColors.text,
    fontSize: 19,
    fontWeight: '600',
    textAlign: 'center',
  },
  stateBody: {
    color: NewsColors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  retry: {
    minHeight: 42,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NewsColors.selected,
  },
  retryText: { color: NewsColors.onSelected, fontSize: 14, fontWeight: '700' },
  filterOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  filterSheet: {
    maxHeight: '88%',
    paddingTop: 8,
    backgroundColor: NewsColors.surfaceRaised,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: NewsColors.border,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    alignSelf: 'center',
    borderRadius: Radius.pill,
    backgroundColor: NewsColors.textFaint,
    marginBottom: 12,
  },
  filterSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  filterSheetTitle: {
    color: NewsColors.text,
    fontSize: 21,
    fontWeight: '700',
  },
  filterSheetSubtitle: {
    color: NewsColors.textMuted,
    fontSize: 13,
    fontWeight: '400',
    marginTop: 3,
  },
  sheetClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NewsColors.chip,
  },
  filterForm: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  filterScroll: { flexShrink: 1 },
  filterSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  filterSectionTitle: {
    color: NewsColors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  filterSelectionCount: {
    color: NewsColors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  allCountriesOption: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    backgroundColor: NewsColors.chip,
  },
  allCountriesText: {
    flex: 1,
    color: NewsColors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  countryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  countryOption: {
    width: '48.5%',
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    backgroundColor: NewsColors.chip,
  },
  filterOptionSelected: {
    borderColor: 'rgba(21, 150, 223, 0.72)',
    backgroundColor: '#071722',
  },
  countryFlag: { fontSize: 18 },
  countryName: {
    flex: 1,
    color: NewsColors.text,
    fontSize: 12,
    fontWeight: '500',
  },
  severityOptions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  countriesHeader: { marginTop: Spacing.xl },
  severityOption: {
    flex: 1,
    minWidth: 0,
    minHeight: 82,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    backgroundColor: NewsColors.chip,
  },
  severityLabel: {
    color: NewsColors.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 7,
  },
  severityDescription: {
    color: NewsColors.textMuted,
    fontSize: 10,
    fontWeight: '400',
    marginTop: 2,
  },
  filterActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: NewsColors.border,
  },
  resetButton: {
    minHeight: 48,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.controlBorder,
  },
  resetButtonText: {
    color: NewsColors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  applyButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: NewsColors.selected,
  },
  applyButtonText: {
    color: NewsColors.onSelected,
    fontSize: 14,
    fontWeight: '800',
  },
});
