import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { NewsSourceIcon } from '@/components/NewsSourceIcon';
import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useNewsFeed } from '@/data/useNewsFeed';
import { RELATED_NEWS_FEED_LIMIT } from '@/domain/news';
import { createRelatedNewsMatcher, type RelatedNewsItem } from '@/domain/relatedNews';
import type { Instrument } from '@/domain/types';
import { isNewsFeedConfigured } from '@/providers/news/client';

const SOURCE_LABELS = { x: 'X', telegram: 'Telegram', paste: 'Paste', digg: 'Digg' };
const timestamp = (value: string) => new Date(value).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function InstrumentNewsLink({ instrument }: { instrument: Instrument }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/related-news', params: { instrumentId: instrument.id } })}
      accessibilityRole="button"
      accessibilityLabel={`News mentioning ${instrument.symbol}`}
      hitSlop={8}
      style={styles.newsLink}>
      <Ionicons name="newspaper-outline" size={18} color={Colors.textMuted} />
    </Pressable>
  );
}

function RelatedArticle({ entry }: { entry: RelatedNewsItem }) {
  const router = useRouter();
  const { item } = entry;
  return (
    <View style={styles.article}>
      <View style={styles.articleHeader}>
        <NewsSourceIcon source={item.source} size={21} />
        <View style={styles.attribution}>
          <AppText variant="label" numberOfLines={1}>{item.author.name}</AppText>
          <AppText variant="caption">{SOURCE_LABELS[item.source]} · {timestamp(item.publishedAt)}</AppText>
        </View>
        {item.url ? (
          <Pressable
            onPress={() => void Linking.openURL(item.url!)}
            accessibilityRole="link"
            accessibilityLabel={`Read original post by ${item.author.name}`}
            style={styles.openSource}>
            <Ionicons name="open-outline" size={18} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <AppText style={styles.articleBody} selectable>{item.text}</AppText>
      <View style={styles.chartLinks}>
        {entry.instruments.map((instrument) => (
          <Pressable
            key={instrument.id}
            onPress={() => router.push({ pathname: '/symbol/[id]', params: { id: instrument.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Open ${instrument.symbol} chart on ${instrument.venue}`}
            style={styles.chartLink}>
            <Ionicons name="stats-chart-outline" size={13} color={Colors.accent} />
            <AppText variant="caption" color={Colors.accent}>
              {instrument.symbol}{entry.instruments.some((other) => other.id !== instrument.id && other.symbol === instrument.symbol) ? ` · ${instrument.venue}` : ''}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** The existing private in-memory feed, filtered by explicit instrument mentions. */
export function InstrumentNews({ instruments, title }: { instruments: Instrument[]; title?: string }) {
  const {
    items, data, notices, isLoading, isError, isRefetching, refetch,
    fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError,
  } = useNewsFeed('all', RELATED_NEWS_FEED_LIMIT);
  const matcher = useMemo(() => createRelatedNewsMatcher(instruments), [instruments]);
  const related = useMemo(() => matcher(items), [matcher, items]);
  const pagesChecked = data?.pages.length ?? 0;
  const searchMore = instruments.length > 0 && items.length < RELATED_NEWS_FEED_LIMIT && related.length < 8 && pagesChecked < 5 && hasNextPage;
  const scanning = Boolean(searchMore && !isError && !isFetchNextPageError);
  const updatedAt = data?.pages[0]?.updatedAt;

  useEffect(() => {
    if (searchMore && !isLoading && !isRefetching && !isFetchingNextPage && !isError && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [searchMore, isLoading, isRefetching, isFetchingNextPage, isError, isFetchNextPageError, fetchNextPage]);

  if (!isNewsFeedConfigured) {
    return <View style={styles.empty}><AppText variant="heading">News is not connected</AppText><AppText muted>Connect your news feed to see posts mentioning these markets.</AppText></View>;
  }

  return (
    <FlashList
      data={related}
      keyExtractor={(entry) => `${entry.item.source}:${entry.item.id}`}
      renderItem={({ item }) => <RelatedArticle entry={item} />}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isRefetching && !isFetchingNextPage} onRefresh={() => void refetch()} tintColor={Colors.textMuted} />}
      ListHeaderComponent={
        <View style={styles.intro}>
          {title ? <AppText variant="heading">{title}</AppText> : null}
          <AppText muted>Posts mentioning {instruments.length === 1 ? instruments[0].symbol : 'symbols in this watchlist'}.</AppText>
          {updatedAt ? <AppText variant="caption">Feed updated {timestamp(updatedAt)} · {items.length} recent posts checked</AppText> : null}
          {notices.map((notice) => <AppText key={notice.id} variant="caption" color={Colors.warning}>{SOURCE_LABELS[notice.source]} · {notice.message}</AppText>)}
          {isError && items.length > 0 ? (
            <View style={styles.notice}>
              <AppText variant="caption" color={Colors.warning}>Couldn’t refresh. Showing previously loaded posts.</AppText>
              <Pressable onPress={() => void refetch()} accessibilityRole="button"><AppText variant="label" color={Colors.accent}>Retry</AppText></Pressable>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          {isLoading || scanning || isFetchingNextPage ? (
            <ActivityIndicator color={Colors.accent} accessibilityLabel="Loading news" />
          ) : isError ? (
            <><AppText variant="heading">News unavailable</AppText><AppText muted>Couldn’t load the feed. Try again when your connection returns.</AppText><Pressable style={styles.button} onPress={() => void refetch()} accessibilityRole="button"><AppText color={Colors.accent}>Try again</AppText></Pressable></>
          ) : (
            <><AppText variant="heading">No matching posts yet</AppText><AppText muted>There are no clear mentions in the posts checked so far.</AppText></>
          )}
        </View>
      }
      ListFooterComponent={
        <View style={styles.footer}>
          {isFetchingNextPage || scanning ? (
            related.length > 0 ? <ActivityIndicator color={Colors.accent} /> : null
          ) : hasNextPage || isFetchNextPageError ? (
            <>
              {isFetchNextPageError ? <AppText variant="caption" color={Colors.warning}>Couldn’t check older posts.</AppText> : null}
              <Pressable style={styles.button} onPress={() => void fetchNextPage()} accessibilityRole="button">
                <AppText color={Colors.accent}>{isFetchNextPageError ? 'Retry older posts' : 'Check older posts'}</AppText>
              </Pressable>
            </>
          ) : related.length > 0 ? <AppText variant="caption">You’ve reached the end of the available feed.</AppText> : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  newsLink: { minHeight: 36, minWidth: 32, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: Spacing.xxl },
  intro: { padding: Spacing.lg, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  article: { marginHorizontal: Spacing.lg, paddingVertical: 18, gap: Spacing.md, borderBottomColor: Colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  articleHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  attribution: { flex: 1, minWidth: 0, gap: 3 },
  openSource: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  articleBody: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  chartLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chartLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 10, paddingVertical: 7, borderRadius: Radius.sm, backgroundColor: Colors.accentSoft },
  empty: { padding: Spacing.xl, gap: Spacing.md, alignItems: 'center' },
  footer: { padding: Spacing.lg, gap: Spacing.sm, alignItems: 'center' },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.lg, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
  notice: { gap: 8 },
});
