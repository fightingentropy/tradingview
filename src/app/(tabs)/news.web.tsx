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
    <article className="web-xyz-news-feed-item">
      <div className="web-xyz-news-feed-meta">
        <span className={`web-source-tag is-${item.source}`}>{sourceLabel(item.source)}</span>
        <span>{when(item.publishedAt)}</span>
      </div>
      <div className="web-xyz-news-feed-copy">
        <p>{item.text}</p>
        <div className="web-xyz-news-feed-author">
          {item.author.avatarUrl ? <img src={item.author.avatarUrl} alt="" /> : <span>{item.author.name.slice(0, 1)}</span>}
          <strong>{item.author.name}</strong>
          {item.author.handle ? <small>@{item.author.handle.replace(/^@/, '')}</small> : null}
        </div>
      </div>
      {item.url ? <Ionicons name="arrow-up-outline" size={16} color="currentColor" /> : null}
    </article>
  );
  return item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="web-xyz-news-feed-link">{body}</a> : body;
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
    <div className="web-xyz-news-page">
      <header className="web-xyz-news-header">
        <div>
          <span className="web-xyz-news-live"><i /> Live intelligence</span>
          <h2>Market pulse</h2>
          <p>Signal over noise across markets, policy and the sources you follow.</p>
        </div>
        <div className="web-xyz-news-actions">
          <button type="button" onClick={() => void refetch()} aria-label="Refresh news feed">
            <Ionicons name="refresh" size={16} color="currentColor" /> Refresh
          </button>
          <Link href="/economic-calendar">
            <Ionicons name="calendar-outline" size={16} color="currentColor" /> Calendar
          </Link>
        </div>
      </header>

      <nav className="web-xyz-news-filters" aria-label="News sources">
        <div>
          {FILTERS.map((filter) => (
            <button key={filter.key} type="button" className={source === filter.key ? 'is-active' : ''} onClick={() => setSource(filter.key)}>
              {filter.label}
            </button>
          ))}
        </div>
        <span>{executiveSummary ? `${executiveSummary.analyzedItems} signals analysed` : 'Curated sources'}</span>
      </nav>

      {!isNewsFeedConfigured ? (
        <section className="web-news-setup web-panel">
          <span className="web-setup-icon"><Ionicons name="sparkles" size={22} color="currentColor" /></span>
          <div><span className="web-section-kicker">NEWS RELAY</span><h3>News relay offline</h3><p>Connect the protected relay to load the same curated sources as the iPhone app.</p></div>
          <Link href="/settings" className="web-quiet-button">Open settings <Ionicons name="arrow-forward" size={15} color="currentColor" /></Link>
        </section>
      ) : isLoading ? (
        <div className="web-xyz-news-feed web-panel">{Array.from({ length: 6 }, (_, index) => <span className="web-xyz-news-feed-skeleton" key={index} />)}</div>
      ) : isError ? (
        <section className="web-inline-state web-panel"><p>The news relay is unavailable right now.</p><button type="button" onClick={() => void refetch()}>Try again</button></section>
      ) : source === 'all' && executiveSummary ? (
        <div className="web-xyz-pulse-layout">
          <section className="web-pulse-hero web-panel">
            <div className="web-pulse-hero-topline">
              <span className={`web-pulse-label is-${executiveSummary.pulse.label}`}>{executiveSummary.pulse.label.replace('-', ' ')}</span>
              <span>Updated {when(executiveSummary.generatedAt)}</span>
            </div>
            <h3>{executiveSummary.headline}</h3>
            <p>{executiveSummary.overview}</p>
            <div className="web-pulse-summary"><Ionicons name="pulse" size={17} color="currentColor" /><span>{executiveSummary.pulse.summary}</span></div>
            <div className="web-xyz-pulse-metrics">
              <span><strong>{executiveSummary.analyzedItems}</strong><small>Signals analysed</small></span>
              <span><strong>{executiveSummary.bullets.length}</strong><small>Key developments</small></span>
              <span><strong>{Object.values(executiveSummary.sourceCounts).filter((count) => count > 0).length}</strong><small>Active sources</small></span>
            </div>
          </section>

          <div className="web-xyz-news-body">
            <section className="web-xyz-briefing-stream web-panel">
              <header>
                <div><span className="web-section-kicker">THE BRIEF</span><h3>Key developments</h3></div>
                <small>{executiveSummary.bullets.length} items</small>
              </header>
              {executiveSummary.bullets.map((bullet, index) => (
                <article className="web-xyz-briefing-item" key={`${bullet.headline}-${index}`}>
                  <div className="web-xyz-briefing-rank">{String(index + 1).padStart(2, '0')}</div>
                  <div className="web-xyz-briefing-copy">
                    <div className="web-xyz-briefing-meta"><span>{bullet.change}</span><span>{bullet.confidence}</span></div>
                    <h3>{bullet.headline}</h3>
                    <p>{bullet.summary}</p>
                    <div className="web-xyz-market-impact">
                      <Ionicons name="pulse-outline" size={16} color="currentColor" />
                      <div><span>Market impact</span><p>{bullet.marketImpact}</p></div>
                    </div>
                    <details>
                      <summary>Evidence and context <Ionicons name="chevron-down" size={13} color="currentColor" /></summary>
                      <p>{bullet.details}</p>
                      <div className="web-source-links">{bullet.sources.map((sourceRef) => <a key={sourceRef.itemKey} href={sourceRef.url} target="_blank" rel="noreferrer">{sourceRef.title}</a>)}</div>
                    </details>
                  </div>
                </article>
              ))}
            </section>

            <aside className="web-xyz-news-rail">
              <section className="web-xyz-watch-panel web-panel">
                <header><span><Ionicons name="eye-outline" size={15} color="currentColor" /> Watch next</span><small>{executiveSummary.watchNext.length}</small></header>
                <ol>{executiveSummary.watchNext.map((item, index) => <li key={`${item}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p></li>)}</ol>
              </section>
              {executiveSummary.secondarySignals.length ? (
                <section className="web-xyz-secondary-panel web-panel">
                  <header><span><Ionicons name="radio-outline" size={15} color="currentColor" /> Secondary</span><small>{executiveSummary.secondarySignals.length}</small></header>
                  <ul>{executiveSummary.secondarySignals.map((item) => <li key={item}>{item}</li>)}</ul>
                  {executiveSummary.noiseSummary ? <p className="web-xyz-noise-note"><span>Filtered</span>{executiveSummary.noiseSummary}</p> : null}
                </section>
              ) : null}
            </aside>
          </div>
        </div>
      ) : items.length === 0 ? (
        <section className="web-inline-state web-panel"><p>No items in this source yet.</p></section>
      ) : (
        <>
          <div className="web-xyz-news-feed web-panel">{items.map((item) => <FeedCard key={`${item.source}:${item.id}`} item={item} />)}</div>
          {hasNextPage ? <button className="web-xyz-news-load-more" type="button" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? 'Loading…' : 'Load more'}</button> : null}
        </>
      )}
    </div>
  );
}
