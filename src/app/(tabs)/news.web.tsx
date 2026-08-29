import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useState } from 'react';

import { useNewsFeed } from '@/data/useNewsFeed';
import type { NewsItem, NewsSourceFilter } from '@/domain/news';
import { isNewsFeedConfigured } from '@/providers/news/client';

const FILTERS: { key: NewsSourceFilter; label: string }[] = [
  { key: 'all', label: 'Pulse' },
  { key: 'x', label: 'X' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'paste', label: 'Paste' },
  { key: 'digg', label: 'Digg' },
];

const sourceLabel = (source: NewsItem['source']) => {
  if (source === 'x') return 'X';
  if (source === 'telegram') return 'Telegram';
  if (source === 'paste') return 'Paste';
  return 'Digg';
};

function when(value: string) {
  const date = new Date(value);
  const delta = Date.now() - date.getTime();
  if (delta < 60_000) return 'Now';
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function FeedCard({ item }: { item: NewsItem }) {
  const body = (
    <article className="web-news-card">
      <div className="web-news-card-meta">
        <span className={`web-source-tag is-${item.source}`}>{sourceLabel(item.source)}</span>
        <span>{when(item.publishedAt)}</span>
      </div>
      <p>{item.text}</p>
      <div className="web-news-author">
        {item.author.avatarUrl ? <img src={item.author.avatarUrl} alt="" /> : <span>{item.author.name.slice(0, 1)}</span>}
        <div><strong>{item.author.name}</strong>{item.author.handle ? <small>@{item.author.handle.replace(/^@/, '')}</small> : null}</div>
        {item.url ? <Ionicons name="arrow-up-outline" size={15} color="currentColor" /> : null}
      </div>
    </article>
  );
  return item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="web-news-card-link">{body}</a> : body;
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
    <div className="web-content-stack">
      <section className="web-page-intro web-news-intro">
        <div>
          <span className="web-section-kicker">SIGNAL, NOT SCROLL</span>
          <h2>A calmer read on what moved.</h2>
          <p>Your private market pulse, raw sources, and the economic calendar in one focused view.</p>
        </div>
        <Link href="/economic-calendar" className="web-primary-button">
          <Ionicons name="calendar-outline" size={16} color="currentColor" /> Economic calendar
        </Link>
      </section>

      <div className="web-news-filter-row">
        <div className="web-segmented-control">
          {FILTERS.map((filter) => (
            <button key={filter.key} type="button" className={source === filter.key ? 'is-active' : ''} onClick={() => setSource(filter.key)}>
              {filter.label}
            </button>
          ))}
        </div>
        <button className="web-refresh-button" type="button" onClick={() => void refetch()}>
          <Ionicons name="refresh" size={15} color="currentColor" /> Refresh
        </button>
      </div>

      {!isNewsFeedConfigured ? (
        <section className="web-news-setup web-panel">
          <span className="web-setup-icon"><Ionicons name="sparkles" size={22} color="currentColor" /></span>
          <div><span className="web-section-kicker">PRIVATE PULSE</span><h3>News is ready to connect.</h3><p>Point the web build at the protected news relay to bring over the same curated sources as the iPhone app.</p></div>
          <Link href="/settings" className="web-quiet-button">Open settings <Ionicons name="arrow-forward" size={15} color="currentColor" /></Link>
        </section>
      ) : isLoading ? (
        <div className="web-news-grid">{Array.from({ length: 6 }, (_, index) => <span className="web-news-skeleton" key={index} />)}</div>
      ) : isError ? (
        <section className="web-inline-state web-panel"><p>The news relay is unavailable right now.</p><button type="button" onClick={() => void refetch()}>Try again</button></section>
      ) : source === 'all' && executiveSummary ? (
        <div className="web-pulse-layout">
          <section className="web-pulse-hero web-panel">
            <div className="web-pulse-hero-topline">
              <span className={`web-pulse-label is-${executiveSummary.pulse.label}`}>{executiveSummary.pulse.label.replace('-', ' ')}</span>
              <span>Updated {when(executiveSummary.generatedAt)}</span>
            </div>
            <h3>{executiveSummary.headline}</h3>
            <p>{executiveSummary.overview}</p>
            <div className="web-pulse-summary"><Ionicons name="pulse" size={17} color="currentColor" /><span>{executiveSummary.pulse.summary}</span></div>
          </section>
          <section className="web-pulse-bullets">
            {executiveSummary.bullets.map((bullet, index) => (
              <article className="web-pulse-bullet web-panel" key={`${bullet.headline}-${index}`}>
                <div className="web-pulse-bullet-meta"><span>0{index + 1}</span><span>{bullet.change}</span><span>{bullet.confidence}</span></div>
                <h3>{bullet.headline}</h3>
                <p>{bullet.summary}</p>
                <div className="web-market-impact"><span>MARKET IMPACT</span><p>{bullet.marketImpact}</p></div>
                <details><summary>Read the detail</summary><p>{bullet.details}</p><div className="web-source-links">{bullet.sources.map((sourceRef) => <a key={sourceRef.itemKey} href={sourceRef.url} target="_blank" rel="noreferrer">{sourceRef.title}</a>)}</div></details>
              </article>
            ))}
          </section>
          <aside className="web-watch-next web-panel">
            <span className="web-section-kicker">WATCH NEXT</span>
            {executiveSummary.watchNext.map((item, index) => <p key={`${item}-${index}`}><span>0{index + 1}</span>{item}</p>)}
            {executiveSummary.secondarySignals.length ? <><span className="web-section-kicker web-secondary-kicker">SECONDARY</span>{executiveSummary.secondarySignals.map((item) => <p key={item}>{item}</p>)}</> : null}
          </aside>
        </div>
      ) : items.length === 0 ? (
        <section className="web-inline-state web-panel"><p>No items in this source yet.</p></section>
      ) : (
        <>
          <div className="web-news-grid">{items.map((item) => <FeedCard key={`${item.source}:${item.id}`} item={item} />)}</div>
          {hasNextPage ? <button className="web-load-more" type="button" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? 'Loading…' : 'Load more'}</button> : null}
        </>
      )}
    </div>
  );
}
