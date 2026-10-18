import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import type { NewsFeedPage } from '../../../src/domain/news';
import { NEWS_SOURCE_TABS, formatNewsTime, loadNewsFeed, type NewsItem, type NewsSourceFilter } from '../lib/newsFeed';
import { usePageActive } from './PageView';
import './News.css';

const ExternalLink: Component = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7M21 3l-9 9M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></svg>;
const RefreshIcon: Component = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-2L20 8M4 16l2.4 3A7 7 0 0 0 18 17" /></svg>;

const NewsEntry: Component<{ item: NewsItem; now: number }> = (props) => {
  const sourceLabel = () => NEWS_SOURCE_TABS.find(tab => tab.key === props.item.source)!.label;
  const split = createMemo(() => {
    const text = props.item.text;
    const newline = text.indexOf('\n');
    return (props.item.source === 'digg' || props.item.source === 'paste') && newline >= 0
      ? { title: text.slice(0, newline).trim(), body: text.slice(newline + 1).trim() }
      : { title: '', body: text };
  });
  return <article class="news-item" data-source={props.item.source}>
    <span class="news-avatar" aria-hidden="true">
      {props.item.author.name.slice(0, 1).toUpperCase()}
      <Show when={props.item.author.avatarUrl}>{url => <img src={url()} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; }} />}</Show>
    </span>
    <div class="news-item-main">
      <div class="news-item-header">
        <div class="news-author">
          <div class="news-author-line"><span class="news-author-name">{props.item.author.name}</span><span class="news-source-label">{sourceLabel()}</span></div>
          <Show when={props.item.author.handle && (props.item.source === 'x' || props.item.source === 'telegram')}><span class="news-author-handle">@{props.item.author.handle?.replace(/^@/, '')}</span></Show>
        </div>
        <time class="news-item-time" dateTime={props.item.publishedAt} title={new Date(props.item.publishedAt).toLocaleString()}>{formatNewsTime(props.item.publishedAt, props.now)}</time>
        <Show when={props.item.url}>{url => <a class="news-source-link" href={url()} target="_blank" rel="noopener noreferrer" aria-label={`Open original post on ${sourceLabel()}`} title="Open original post"><ExternalLink /></a>}</Show>
      </div>
      <div class="news-item-content">
        <Show when={split().title}><h2 class="news-story-title"><Show when={props.item.url} fallback={split().title}>{url => <a href={url()} target="_blank" rel="noopener noreferrer">{split().title}</a>}</Show></h2></Show>
        <Show when={split().body}><p class="news-text">{split().body}</p></Show>
        <Show when={props.item.media?.length}>
          <div class="news-media"><For each={props.item.media?.slice(0, 4)}>{media => <a href={props.item.url ?? media.previewUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${media.type === 'video' ? 'video' : 'image'} from ${props.item.author.name}`}>
            <img src={media.previewUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={event => { event.currentTarget.parentElement!.style.display = 'none'; }} />
            <Show when={media.type === 'video'}><span class="news-video-label">Video</span></Show>
          </a>}</For></div>
        </Show>
      </div>
    </div>
  </article>;
};

const News: Component = () => {
  const active = usePageActive();
  const [feed, setFeed] = createSignal<NewsFeedPage>();
  const [source, setSource] = createSignal<NewsSourceFilter>('all');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [now, setNow] = createSignal(Date.now());
  const [visibleCount, setVisibleCount] = createSignal(40);
  let controller: AbortController | undefined;
  let scroller!: HTMLElement;
  const items = createMemo(() => (feed()?.items ?? []).filter(item => source() === 'all' || item.source === source()));
  const notices = createMemo(() => (feed()?.notices ?? []).filter(notice => source() === 'all' || notice.source === source()));

  const refresh = async () => {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    setLoading(true);
    try {
      const snapshot = await loadNewsFeed(request.signal);
      if (request.signal.aborted) return;
      setFeed(snapshot);
      setError('');
      setNow(Date.now());
    } catch {
      if (!request.signal.aborted) setError('Could not refresh news. Please try again.');
    } finally {
      if (controller === request) setLoading(false);
    }
  };

  createEffect(() => {
    if (!active()) return;
    void refresh();
    const interval = window.setInterval(() => { setNow(Date.now()); void refresh(); }, 60_000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    onCleanup(() => { window.clearInterval(interval); window.removeEventListener('focus', focus); controller?.abort(); });
  });

  const selectSource = (key: NewsSourceFilter) => { setSource(key); setVisibleCount(40); scroller.scrollTop = 0; };
  const onTabKey = (event: KeyboardEvent) => {
    const index = NEWS_SOURCE_TABS.findIndex(tab => tab.key === source());
    const next = event.key === 'ArrowRight' ? (index + 1) % NEWS_SOURCE_TABS.length
      : event.key === 'ArrowLeft' ? (index + NEWS_SOURCE_TABS.length - 1) % NEWS_SOURCE_TABS.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? NEWS_SOURCE_TABS.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    selectSource(NEWS_SOURCE_TABS[next].key);
    document.getElementById(`news-tab-${NEWS_SOURCE_TABS[next].key}`)?.focus();
  };

  return <main ref={scroller} class="news-page" aria-labelledby="news-title">
    <div class="news-frame">
      <header class="news-masthead">
        <div><h1 id="news-title">News</h1><p>Latest from your feeds</p></div>
        <button class="news-refresh" onClick={() => void refresh()} disabled={loading()} aria-label="Refresh news"><RefreshIcon /><span>{loading() ? 'Refreshing' : 'Refresh'}</span></button>
      </header>
      <div class="news-tabs" role="tablist" aria-label="News sources" onKeyDown={onTabKey}>
        <For each={NEWS_SOURCE_TABS}>{tab => <button type="button" role="tab" id={`news-tab-${tab.key}`} aria-controls="news-feed-panel" aria-selected={source() === tab.key} tabIndex={source() === tab.key ? 0 : -1} onClick={() => selectSource(tab.key)}>{tab.label}</button>}</For>
      </div>
      <section id="news-feed-panel" role="tabpanel" aria-labelledby={`news-tab-${source()}`} aria-busy={loading()}>
        <Show when={feed()}>{snapshot => <div class="news-feed-meta"><span>{items().length} {items().length === 1 ? 'story' : 'stories'}</span><span>Updated <time dateTime={snapshot().updatedAt} title={new Date(snapshot().updatedAt).toLocaleString()}>{formatNewsTime(snapshot().updatedAt, now())}</time></span></div>}</Show>
        <Show when={error()}><div class="news-notice news-error" role="status"><span>{error()}<Show when={feed()}> Showing the last loaded feed.</Show></span><button onClick={() => void refresh()} disabled={loading()}>Retry</button></div></Show>
        <For each={notices()}>{notice => <p class="news-notice" role="status">{notice.message}</p>}</For>
        <Show when={loading() && !feed()}><div class="news-loading" role="status" aria-label="Loading news"><span class="news-spinner" /></div></Show>
        <Show when={feed() && !items().length}><div class="news-empty"><h2>No stories yet</h2><p>No {source() === 'all' ? 'news' : NEWS_SOURCE_TABS.find(tab => tab.key === source())!.label} stories in the latest feed.</p></div></Show>
        <div class="news-items"><For each={items().slice(0, visibleCount())}>{item => <NewsEntry item={item} now={now()} />}</For></div>
        <Show when={items().length > visibleCount()}><button class="news-more" onClick={() => setVisibleCount(count => count + 40)}>Show more stories</button></Show>
      </section>
    </div>
  </main>;
};

export default News;
