import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { NewsItemRow } from '@/components/NewsItemRow';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useNewsFeed } from '@/data/useNewsFeed';
import type { NewsItem, NewsSourceFilter } from '@/domain/news';
import { isNewsFeedConfigured, usesLocalNewsFeed } from '@/providers/news/client';

const FILTERS: { key: NewsSourceFilter; label: string; icon?: 'logo-twitter' | 'paper-plane' }[] = [
  { key: 'all', label: 'All' },
  { key: 'x', label: 'X', icon: 'logo-twitter' },
  { key: 'telegram', label: 'Telegram', icon: 'paper-plane' },
];

function SetupState() {
  return (
    <View style={styles.stateWrap}>
      <View style={styles.stateIcon}>
        <Ionicons name="newspaper-outline" size={28} color={Colors.accent} />
      </View>
      <AppText variant="heading" style={styles.stateTitle}>
        Connect your news feeds
      </AppText>
      <AppText muted style={styles.stateBody}>
        Add the feed service URL to receive posts from your X timeline or lists and messages from
        your Telegram channels. Account credentials stay on the service, not in this app.
      </AppText>
      <View style={styles.privacyRow}>
        <Ionicons name="shield-checkmark-outline" size={17} color={Colors.up} />
        <AppText variant="caption" style={styles.privacyText}>
          Private feed content is kept out of the on-device persisted cache.
        </AppText>
      </View>
    </View>
  );
}

export default function NewsScreen() {
  const [source, setSource] = useState<NewsSourceFilter>('all');
  const {
    items,
    notices,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useNewsFeed(source);

  const renderItem = useCallback(({ item }: { item: NewsItem }) => <NewsItemRow item={item} />, []);
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <Screen edges={[]}>
      <View style={styles.filters}>
        {FILTERS.map((filter) => {
          const active = source === filter.key;
          return (
            <Pressable
              key={filter.key}
              onPress={() => setSource(filter.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.chip, active && styles.chipActive]}>
              {filter.icon ? (
                <Ionicons
                  name={filter.icon}
                  size={13}
                  color={active ? Colors.text : Colors.textMuted}
                />
              ) : null}
              <AppText style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {filter.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {source === 'telegram' && notices.length > 0 ? (
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.warning} />
          <AppText variant="caption" style={styles.noticeText}>
            {notices.map((notice) => notice.message).join(' ')}
          </AppText>
        </View>
      ) : null}

      {!isNewsFeedConfigured ? (
        <SetupState />
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
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
          <Pressable onPress={() => refetch()} style={styles.retry}>
            <AppText style={styles.retryText}>Try again</AppText>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.stateWrap}>
          <Ionicons name="file-tray-outline" size={30} color={Colors.textMuted} />
          <AppText variant="heading" style={styles.stateTitle}>Nothing here yet</AppText>
          <AppText muted style={styles.stateBody}>
            New posts and channel messages will appear here automatically.
          </AppText>
        </View>
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item) => `${item.source}:${item.id}`}
          renderItem={renderItem}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && !isFetchingNextPage}
              onRefresh={refetch}
              tintColor={Colors.accent}
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={styles.footerLoader} color={Colors.accent} />
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  chip: {
    minHeight: 32,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.surfaceAlt },
  chipLabel: { color: Colors.textMuted, fontSize: 13, fontWeight: '600' },
  chipLabelActive: { color: Colors.text },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  noticeText: { flex: 1, lineHeight: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
    gap: 10,
  },
  stateIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentSoft,
    marginBottom: 4,
  },
  stateTitle: { fontSize: 20, textAlign: 'center' },
  stateBody: { maxWidth: 430, textAlign: 'center', lineHeight: 21, fontWeight: '400' },
  privacyRow: {
    maxWidth: 390,
    marginTop: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  privacyText: { flex: 1, lineHeight: 16 },
  retry: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
  },
  retryText: { color: Colors.accent, fontWeight: '700' },
  footerLoader: { paddingVertical: Spacing.lg },
});
