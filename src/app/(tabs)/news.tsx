import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { NewsExecutiveSummaryView } from '@/components/NewsExecutiveSummary';
import { NewsItemRow } from '@/components/NewsItemRow';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, NewsColors, Radius, Spacing } from '@/constants/theme';
import { useNewsFeed } from '@/data/useNewsFeed';
import type { NewsItem, NewsSourceFilter } from '@/domain/news';
import { parseNewsNotificationItemId } from '@/domain/newsNotificationSources';
import { isNewsFeedConfigured, usesLocalNewsFeed } from '@/providers/news/client';

const FILTERS: {
  key: NewsSourceFilter;
  label: string;
  icon?: 'pulse' | 'logo-twitter' | 'paper-plane' | 'newspaper' | 'clipboard-outline';
}[] = [
  { key: 'all', label: 'Pulse', icon: 'pulse' },
  { key: 'x', label: 'X', icon: 'logo-twitter' },
  { key: 'telegram', label: 'Telegram', icon: 'paper-plane' },
  { key: 'paste', label: 'Paste', icon: 'clipboard-outline' },
  { key: 'digg', label: 'Digg', icon: 'newspaper' },
];

function SetupState() {
  return (
    <View style={styles.stateWrap}>
      <View style={styles.stateIcon}>
        <Ionicons name="newspaper-outline" size={24} color={NewsColors.text} />
      </View>
      <AppText variant="heading" style={styles.stateTitle}>
        Connect your news feeds
      </AppText>
      <AppText muted style={styles.stateBody}>
        Add the feed service URL to receive posts from your X timeline or lists, messages from
        your Telegram channels, Paste trade calls, and Digg Tech stories. Account credentials
        stay on the service, not in this app.
      </AppText>
      <View style={styles.privacyRow}>
        <Ionicons name="shield-checkmark-outline" size={17} color={NewsColors.textMuted} />
        <AppText variant="caption" style={styles.privacyText}>
          Private feed content is kept out of the on-device persisted cache.
        </AppText>
      </View>
    </View>
  );
}

export default function NewsScreen() {
  const { itemId } = useLocalSearchParams<{ itemId?: string | string[] }>();
  const notificationTarget = useMemo(() => parseNewsNotificationItemId(itemId), [itemId]);
  const [selectedSource, setSelectedSource] = useState<NewsSourceFilter>('all');
  const source = notificationTarget?.source ?? selectedSource;
  const listRef = useRef<FlashListRef<NewsItem>>(null);
  const focusedItemRef = useRef<string | undefined>(undefined);
  const paginationAttemptsRef = useRef(0);
  const [loadedListSource, setLoadedListSource] = useState<NewsSourceFilter | undefined>();
  const {
    items,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    executiveSummary,
  } = useNewsFeed(source);

  const targetIndex = useMemo(() => {
    if (!notificationTarget || source !== notificationTarget.source) return -1;
    return items.findIndex(
      (item) => `${item.source}:${item.id}` === notificationTarget.itemId,
    );
  }, [items, notificationTarget, source]);

  useEffect(() => {
    focusedItemRef.current = undefined;
    paginationAttemptsRef.current = 0;
  }, [notificationTarget?.itemId]);

  useEffect(() => {
    if (
      !notificationTarget ||
      source !== notificationTarget.source ||
      isLoading ||
      isError ||
      targetIndex >= 0 ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError ||
      paginationAttemptsRef.current >= 5
    ) {
      return;
    }

    paginationAttemptsRef.current += 1;
    void fetchNextPage();
  }, [
    fetchNextPage,
    hasNextPage,
    isError,
    isFetchNextPageError,
    isFetchingNextPage,
    isLoading,
    notificationTarget,
    source,
    targetIndex,
  ]);

  useEffect(() => {
    if (
      !notificationTarget ||
      targetIndex < 0 ||
      loadedListSource !== source ||
      focusedItemRef.current === notificationTarget.itemId ||
      !listRef.current
    ) {
      return;
    }

    focusedItemRef.current = notificationTarget.itemId;
    const frame = requestAnimationFrame(() => {
      void listRef.current?.scrollToIndex({
        index: targetIndex,
        animated: true,
        viewPosition: 0.16,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [loadedListSource, notificationTarget, source, targetIndex]);

  const renderItem = useCallback(
    ({ item }: { item: NewsItem }) => (
      <NewsItemRow
        item={item}
        highlighted={`${item.source}:${item.id}` === notificationTarget?.itemId}
      />
    ),
    [notificationTarget?.itemId],
  );
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <Screen edges={[]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroller}
        contentContainerStyle={styles.filters}>
          <Pressable
            onPress={() => router.push('/economic-calendar' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open economic calendar"
            style={styles.calendarButton}>
            <Ionicons name="calendar" size={20} color={NewsColors.textMuted} />
          </Pressable>
          {FILTERS.map((filter) => {
            const active = source === filter.key;
            return (
              <Pressable
                key={filter.key}
                onPress={() => {
                  setSelectedSource(filter.key);
                  if (notificationTarget) router.setParams({ itemId: undefined });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && styles.chipActive]}>
                {filter.icon ? (
                  <Ionicons
                    name={filter.icon}
                    size={13}
                    color={active ? NewsColors.onSelected : NewsColors.textMuted}
                  />
                ) : null}
                <AppText style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {filter.label}
                </AppText>
              </Pressable>
            );
          })}
      </ScrollView>

      {!isNewsFeedConfigured ? (
        <SetupState />
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={NewsColors.text} />
        </View>
      ) : isError ? (
        <View style={styles.stateWrap}>
          <Ionicons name="cloud-offline-outline" size={30} color={Colors.textMuted} />
          <AppText variant="heading" style={styles.stateTitle}>Feed unavailable</AppText>
          <AppText muted style={styles.stateBody}>
            {usesLocalNewsFeed
              ? 'Start the local feed bridge with “npm run news:server”, then try again.'
              : error instanceof Error
                ? error.message
                : 'Could not load the latest messages.'}
          </AppText>
          <Pressable
            onPress={() => refetch()}
            style={styles.retry}
            disabled={isRefetching}
            accessibilityState={{ disabled: isRefetching, busy: isRefetching }}>
            {isRefetching ? (
              <ActivityIndicator size="small" color={NewsColors.onSelected} />
            ) : (
              <AppText style={styles.retryText}>Try again</AppText>
            )}
          </Pressable>
        </View>
      ) : source === 'all' && executiveSummary ? (
        <NewsExecutiveSummaryView
          summary={executiveSummary}
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
        />
      ) : source === 'all' ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateIcon}>
            <Ionicons name="sparkles" size={28} color={Colors.accent} />
          </View>
          <AppText variant="heading" style={styles.stateTitle}>Building the first pulse</AppText>
          <AppText muted style={styles.stateBody}>
            The Mac mini is filtering the latest sources into a concise executive summary. Raw feeds remain available above.
          </AppText>
          <Pressable
            onPress={() => refetch()}
            style={styles.retry}
            disabled={isRefetching}
            accessibilityState={{ disabled: isRefetching, busy: isRefetching }}>
            {isRefetching ? (
              <ActivityIndicator size="small" color={NewsColors.onSelected} />
            ) : (
              <AppText style={styles.retryText}>Check again</AppText>
            )}
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.stateWrap}>
          <Ionicons name="file-tray-outline" size={30} color={Colors.textMuted} />
          <AppText variant="heading" style={styles.stateTitle}>Nothing here yet</AppText>
          <AppText muted style={styles.stateBody}>
            New posts, channel messages, trade calls, and tech stories will appear here automatically.
          </AppText>
        </View>
      ) : (
        <FlashList
          key={source}
          ref={listRef}
          data={items}
          keyExtractor={(item) => `${item.source}:${item.id}`}
          renderItem={renderItem}
          onLoad={() => setLoadedListSource(source)}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && !isFetchingNextPage}
              onRefresh={refetch}
              tintColor={NewsColors.text}
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={styles.footerLoader} color={NewsColors.text} />
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterScroller: {
    flexGrow: 0,
    backgroundColor: NewsColors.background,
  },
  filters: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: 10,
    paddingBottom: 14,
    minWidth: '100%',
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    backgroundColor: NewsColors.chip,
  },
  chipActive: {
    borderColor: NewsColors.selected,
    backgroundColor: NewsColors.selected,
  },
  chipLabel: { color: NewsColors.textMuted, fontSize: 13, fontWeight: '600' },
  chipLabelActive: { color: NewsColors.onSelected },
  calendarButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    backgroundColor: NewsColors.chip,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
    gap: 10,
  },
  stateIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: NewsColors.controlBorder,
    marginBottom: 4,
  },
  stateTitle: { color: NewsColors.text, fontSize: 20, textAlign: 'center' },
  stateBody: {
    maxWidth: 430,
    color: NewsColors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    fontWeight: '400',
  },
  privacyRow: {
    maxWidth: 390,
    marginTop: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    backgroundColor: NewsColors.surface,
  },
  privacyText: { flex: 1, color: NewsColors.textMuted, lineHeight: 16 },
  retry: {
    marginTop: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: NewsColors.selected,
  },
  retryText: { color: NewsColors.onSelected, fontWeight: '700' },
  footerLoader: { paddingVertical: Spacing.lg },
});
