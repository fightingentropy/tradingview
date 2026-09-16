import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { DEFAULT_NEWS_FEED_LIMIT, type NewsFeedNotice, type NewsItem, type NewsSourceFilter } from '@/domain/news';
import { queryKeys } from '@/lib/queryKeys';
import { isNewsFeedConfigured, loadNewsFeed } from '@/providers/news/client';

export function useNewsFeed(source: NewsSourceFilter, limit = DEFAULT_NEWS_FEED_LIMIT, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.newsFeed(source, limit),
    queryFn: ({ pageParam }) => loadNewsFeed(source, pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: enabled && isNewsFeedConfigured,
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const items = useMemo<NewsItem[]>(() => {
    const seen = new Set<string>();
    return (query.data?.pages ?? []).flatMap((page) =>
      page.items.filter((item) => {
        const key = `${item.source}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    );
  }, [query.data?.pages]);

  const notices = useMemo<NewsFeedNotice[]>(() => {
    const seen = new Set<string>();
    return (query.data?.pages ?? []).flatMap((page) =>
      (page.notices ?? []).filter((notice) => {
        if (seen.has(notice.id)) return false;
        seen.add(notice.id);
        return true;
      }),
    );
  }, [query.data?.pages]);

  const executiveSummary = query.data?.pages[0]?.executiveSummary;

  return { ...query, items, notices, executiveSummary };
}
