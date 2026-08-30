import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useState } from 'react';

import { useNewsFeed } from '@/data/useNewsFeed';
import type { NewsItem, NewsSourceFilter } from '@/domain/news';
import { isNewsFeedConfigured } from '@/providers/news/client';

const FILTERS: { key: NewsSourceFilter; label: string }[] = [
  { key: 'all', label: 'Major news' },
  { key: 'x', label: 'X' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'paste', label: 'Paste' },
  { key: 'digg', label: 'Digg' },
];

const sourceLabel = (source: NewsItem['source']) => source === 'x' ? 'X' : source === 'telegram' ? 'Telegram' : source === 'paste' ? 'Paste' : 'Digg';

function when(value: string) {
  const date = new Date(value);
  const delta = Date.now() - date.getTime();
  if (delta < 60_000) return 'Now';
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))} minutes ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hours ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function SourceRow({ item }: { item: NewsItem }) {
  const content = (
    <article className="web-capital-source-row">
      <span className={`web-source-tag is-${item.source}`}>{sourceLabel(item.source)}</span>
      <p>{item.text}</p>
      <small>{when(item.publishedAt)} · {item.author.name}</small>
      {item.url ? <Ionicons name="open-outline" size={16} color="currentColor" /> : null}
    </article>
  );
  return item.url ? <a href={item.url} target="_blank" rel="noreferrer">{content}</a> : content;
}

export default function WebNewsScreen() {
  const [source, setSource] = useState<NewsSourceFilter>('all');
  const {
    items,
    executiveSummary,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useNewsFeed(source);

  return (
    <div className="web-capital-news-page">
      <nav className="web-capital-news-tabs" aria-label="News sources">
        <div>{FILTERS.map((filter) => <button key={filter.key} type="button" className={source === filter.key ? 'is-active' : ''} onClick={() => setSource(filter.key)}>{filter.label}</button>)}</div>
        <Link href="/economic-calendar"><Ionicons name="calendar-outline" size={16} color="currentColor" /> Calendar</Link>
        <button type="button" onClick={() => void refetch()} aria-label="Refresh news"><Ionicons name="refresh" size={16} color="currentColor" /></button>
      </nav>

      {!isNewsFeedConfigured ? (
        <section className="web-capital-empty-state"><Ionicons name="newspaper-outline" size={52} color="currentColor" /><h2>News relay offline</h2><p>Connect the protected relay to load curated sources.</p><Link href="/settings">Open settings</Link></section>
      ) : isLoading ? (
        <div className="web-capital-news-loading">{Array.from({ length: 10 }, (_, index) => <span key={index} />)}</div>
      ) : isError ? (
        <section className="web-capital-empty-state"><Ionicons name="cloud-offline-outline" size={48} color="currentColor" /><h2>News unavailable</h2><p>The live relay did not answer.</p><button type="button" onClick={() => void refetch()}>Try again</button></section>
      ) : source === 'all' && executiveSummary ? (
        <div className="web-capital-news-layout">
          <main className="web-capital-news-main">
            <section className="web-capital-news-lead">
              <header><h2>Major news</h2><span>{when(executiveSummary.generatedAt)}</span></header>
              <article>
                <span className={`web-pulse-label is-${executiveSummary.pulse.label}`}>{executiveSummary.pulse.label.replace('-', ' ')}</span>
                <h1>{executiveSummary.headline}</h1>
                <p>{executiveSummary.overview}</p>
                <small><Ionicons name="flash" size={14} color="currentColor" /> {executiveSummary.pulse.summary}</small>
              </article>
            </section>

            <section className="web-capital-news-list">
              <header><h2>Latest analysis</h2><span>{executiveSummary.bullets.length} stories</span></header>
              {executiveSummary.bullets.map((bullet, index) => (
                <article key={`${bullet.headline}-${index}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><h3>{bullet.headline}</h3><p>{bullet.summary}</p><small><Ionicons name="flash" size={13} color="currentColor" /> {bullet.marketImpact}</small></div>
                  <em>{bullet.change}</em>
                </article>
              ))}
            </section>
          </main>

          <aside className="web-capital-news-side">
            <section><header><h2>Watch next</h2><span>{executiveSummary.watchNext.length}</span></header>{executiveSummary.watchNext.map((item, index) => <article key={`${item}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p></article>)}</section>
            <section><header><h2>Market signals</h2><span>{executiveSummary.secondarySignals.length}</span></header>{executiveSummary.secondarySignals.map((item) => <article key={item}><Ionicons name="flash" size={13} color="currentColor" /><p>{item}</p></article>)}</section>
            <section className="web-capital-news-sources"><header><h2>Sources</h2></header>{Object.entries(executiveSummary.sourceCounts).map(([key, count]) => <div key={key}><span>{sourceLabel(key as NewsItem['source'])}</span><strong>{count}</strong></div>)}</section>
          </aside>
        </div>
      ) : (
        <div className="web-capital-source-feed">
          <header><h2>{FILTERS.find((filter) => filter.key === source)?.label}</h2><span>{items.length} items</span></header>
          {items.length ? items.map((item) => <SourceRow key={`${item.source}:${item.id}`} item={item} />) : <section className="web-capital-empty-state"><h2>Nothing to show...yet</h2><p>No items are available for this source.</p></section>}
          {hasNextPage ? <button type="button" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? 'Loading…' : 'Show more'}</button> : null}
        </div>
      )}
    </div>
  );
}
