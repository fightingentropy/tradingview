import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { NewsFeedNotice, NewsItem, NewsSourceFilter } from '@/domain/news';
import { queryKeys } from '@/lib/queryKeys';
import { isNewsFeedConfigured, loadNewsFeed } from '@/providers/news/client';

export function useNewsFeed(source: NewsSourceFilter) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.newsFeed(source),
    queryFn: ({ pageParam }) => loadNewsFeed(source, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: isNewsFeedConfigured,
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

  return { ...query, items, notices };
}
