import { For, Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { dailyBriefs } from '../data/marketBrief';
import { editionStatus, formatBriefDate, type DailyBrief } from '../lib/dailyBrief';
import { briefEntry, parseBriefIndex, parseBriefPayload } from '../lib/dailyBriefFeed';
import BriefContent from './BriefContent';
import './Brief.css';

const Arrow: Component<{ direction: 'left' | 'right' | 'down' }> = (props) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d={props.direction === 'left' ? 'm14 6-6 6 6 6' : props.direction === 'right' ? 'm10 6 6 6-6 6' : 'm6 9 6 6 6-6'} />
  </svg>
);

const Brief: Component = () => {
  let scroller!: HTMLElement;
  const headings = new Map<string, HTMLHeadingElement>();
  const [editions, setEditions] = createSignal(dailyBriefs.map(briefEntry));
  const [edition, setEdition] = createSignal(dailyBriefs[0]!);
  const selected = createMemo(() => editions().findIndex((item) => item.id === edition().id));
  const cache = new Map<string, DailyBrief>(dailyBriefs.map((item) => [item.id, item]));
  const [feedError, setFeedError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  let userSelected = false;
  let initialRefresh = true;
  let failedEdition: string | undefined;
  let selectionRequest = 0;
  let feedBusy = false;
  const requests = new Set<AbortController>();
  let disposed = false;
  const [activeSection, setActiveSection] = createSignal('brief-section-1');
  const [progress, setProgress] = createSignal(0);
  const [now, setNow] = createSignal(new Date());
  const [sourcesOpen, setSourcesOpen] = createSignal(false);
  const status = createMemo(() => editionStatus(edition(), editions()[0]!.id, now()));

  const fetchJson = async (path: string): Promise<unknown> => {
    const controller = new AbortController();
    requests.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(path, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Brief request failed: ${response.status}`);
      return await response.json();
    } finally {
      requests.delete(controller);
      window.clearTimeout(timeout);
    }
  };

  const refreshEditions = async () => {
    if (feedBusy || disposed) return;
    feedBusy = true;
    try {
      const index = parseBriefIndex(await fetchJson('/api/daily-briefs'));
      if (disposed) return;
      // Keep bundled archives available even if the service has a temporary partial index.
      const merged = new Map([...dailyBriefs.map(briefEntry), ...index.editions].map((item) => [item.id, item]));
      setEditions([...merged.values()].sort((a, b) => b.generated.localeCompare(a.generated)));
      setFeedError('');
      if (initialRefresh && !userSelected && edition().id !== editions()[0]!.id) await chooseEdition(0, false);
      initialRefresh = false;
    } catch {
      if (!disposed) setFeedError('Unable to check for a newer edition. The last available brief is shown.');
    } finally { feedBusy = false; }
  };

  onMount(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    const refresh = () => { if (document.visibilityState === 'visible') void refreshEditions(); };
    const feedTimer = window.setInterval(refresh, 5 * 60_000);
    document.addEventListener('visibilitychange', refresh);
    void refreshEditions();
    onCleanup(() => {
      disposed = true;
      window.clearInterval(timer);
      window.clearInterval(feedTimer);
      document.removeEventListener('visibilitychange', refresh);
      for (const request of requests) request.abort();
    });
  });

  const chooseEdition = async (index: number, manual = true) => {
    if (manual) userSelected = true;
    const entry = editions()[index];
    if (!entry || entry.id === edition().id) return;
    const request = ++selectionRequest;
    setLoading(true);
    try {
      const cached = cache.get(entry.id);
      const next = cached && cached.title === entry.title && cached.generated === entry.generated ? cached : parseBriefPayload(await fetchJson(`/api/daily-briefs/${entry.id}`), entry);
      if (disposed || request !== selectionRequest) return;
      cache.set(next.id, next);
      failedEdition = undefined;
      headings.clear();
      setEdition(next);
      setActiveSection('brief-section-1');
      setProgress(0);
      setSourcesOpen(false);
      setFeedError('');
      scroller.scrollTo({ top: 0, behavior: 'instant' });
    } catch {
      if (!disposed && request === selectionRequest) {
        failedEdition = entry.id;
        setFeedError('This edition could not be loaded. Please try again.');
      }
    } finally {
      if (!disposed && request === selectionRequest) setLoading(false);
    }
  };

  const updateReadingPosition = () => {
    const maximum = scroller.scrollHeight - scroller.clientHeight;
    setProgress(maximum > 0 ? Math.min(100, scroller.scrollTop / maximum * 100) : 100);
    let current = edition().sections[0]?.id ?? '';
    const top = scroller.getBoundingClientRect().top;
    for (const section of edition().sections) {
      const heading = headings.get(section.id);
      if (heading && heading.getBoundingClientRect().top - top <= 150) current = section.id;
    }
    setActiveSection(current);
  };

  const jumpTo = (id: string) => {
    const heading = headings.get(id);
    if (!heading) return;
    heading.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    heading.focus({ preventScroll: true });
    setActiveSection(id);
  };

  return (
    <main ref={scroller} class="daily-brief-page" aria-label="Daily market brief" onScroll={updateReadingPosition}>
      <div class="brief-reading-progress" aria-hidden="true"><span style={{ width: `${progress()}%` }} /></div>
      <div class="brief-frame">
        <header class="brief-masthead">
          <div>
            <div class="brief-eyebrow">Markets & perspective</div>
            <h1>Daily brief<span aria-hidden="true">.</span></h1>
            <p>What changed. Why it matters. What comes next.</p>
          </div>
          <a class="brief-download" download={`market-overview-${edition().id}.md`} href={`data:text/markdown;charset=utf-8,${encodeURIComponent(edition().raw)}`}>
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" /></svg>
            Save brief
          </a>
        </header>

        <div class="brief-edition-bar">
          <div class="brief-edition-picker">
            <button type="button" class="brief-icon-button" aria-label="Previous edition" disabled={loading() || selected() === editions().length - 1} onClick={() => void chooseEdition(selected() + 1)}><Arrow direction="left" /></button>
            <div class="brief-date-select">
              <select aria-label="Brief edition" value={edition().id} disabled={loading()} onChange={(event) => { const index = editions().findIndex((entry) => entry.id === event.currentTarget.value); event.currentTarget.value = edition().id; void chooseEdition(index); }}>
                <For each={editions()}>{(brief, index) => <option value={brief.id}>{formatBriefDate(brief.id, 'short')}{index() === 0 ? ' · Latest' : ''}</option>}</For>
              </select>
              <Arrow direction="down" />
            </div>
            <button type="button" class="brief-icon-button" aria-label="Next edition" disabled={loading() || selected() === 0} onClick={() => void chooseEdition(selected() - 1)}><Arrow direction="right" /></button>
            <Show when={selected() !== 0}><button type="button" class="brief-latest-button" disabled={loading()} onClick={() => void chooseEdition(0)}>Latest</button></Show>
          </div>
          <div class="brief-edition-details"><span>{edition().readingMinutes} min read</span><span aria-hidden="true">·</span><span>{edition().sources.length} sources</span></div>
        </div>

        <Show when={feedError() || loading()}><div class="brief-feed-status" role="status">{loading() ? 'Loading edition…' : feedError()}<Show when={feedError() && !loading()}><button type="button" onClick={() => { if (failedEdition) void chooseEdition(editions().findIndex((entry) => entry.id === failedEdition)); else void refreshEditions(); }}>Retry</button></Show></div></Show>

        <div class="brief-layout">
          <aside class="brief-sidebar">
            <div class="brief-sidebar-label">In this brief</div>
            <nav aria-label="Brief sections">
              <For each={edition().sections}>{(section, index) => (
                <a href={`#${section.id}`} aria-current={activeSection() === section.id ? 'location' : undefined} onClick={(event) => { event.preventDefault(); jumpTo(section.id); }}>
                  <span class="brief-section-number">{String(index() + 1).padStart(2, '0')}</span><span>{section.title}</span>
                </a>
              )}</For>
            </nav>
            <div class="brief-sidebar-note"><span>Global macro</span><p>Facts, interpretation, and conditional market views.</p></div>
          </aside>

          <article class="brief-article" aria-labelledby="brief-title" aria-busy={loading()}>
            <div class="brief-article-header">
              <div class="brief-publication-line"><span classList={{ 'brief-status': true, 'brief-status-today': status() === 'today' }}>{status() === 'today' ? "Today's edition" : status() === 'latest' ? 'Latest available edition' : 'Archive edition'}</span><time dateTime={edition().id}>{formatBriefDate(edition().id)}</time></div>
              <h2 id="brief-title">{edition().title}</h2>
              <Show when={status() !== 'today'}><p class="brief-archive-note">{status() === 'latest' ? 'A newer brief has not been published yet. ' : ''}Analysis and market figures reflect this edition’s original cutoff.</p></Show>
              <dl class="brief-metadata">
                <div><dt>Generated</dt><dd>{edition().generated.slice(11)} <span>Europe/London</span></dd></div>
                <div><dt>Market state</dt><dd>{edition().marketState}</dd></div>
                <div class="brief-cutoff"><dt>Data cutoff</dt><dd>{edition().cutoff}</dd></div>
              </dl>
            </div>

            <div class="brief-mobile-contents">
              <label for="brief-jump">In this brief</label>
              <select id="brief-jump" value={activeSection()} onChange={(event) => jumpTo(event.currentTarget.value)}><For each={edition().sections}>{(section) => <option value={section.id}>{section.title}</option>}</For></select>
            </div>

            <For each={edition().sections}>{(section, index) => (
              <section classList={{ 'brief-section': true, 'brief-verdict': index() === 0, 'brief-caveats': section.title.toLowerCase() === 'data caveats' }} aria-labelledby={section.id}>
                <h3 ref={(element) => headings.set(section.id, element)} id={section.id} tabIndex={-1}><span aria-hidden="true">{String(index() + 1).padStart(2, '0')}</span>{section.title}</h3>
                <div class="brief-prose"><BriefContent blocks={section.blocks} /></div>
              </section>
            )}</For>

            <details class="brief-source-notes" open={sourcesOpen()} onToggle={(event) => setSourcesOpen(event.currentTarget.open)}>
              <summary><span>Sources for this edition</span><span>{edition().sources.length}<Arrow direction="down" /></span></summary>
              <p>Claims link directly to their sources in the brief. This index collects those references.</p>
              <ul><For each={edition().sources}>{(source) => <li><a href={source.href} target="_blank" rel="noopener noreferrer"><span>{source.label}</span><span>{new URL(source.href).hostname.replace(/^www\./, '')}</span></a></li>}</For></ul>
            </details>

            <footer class="brief-footer"><span>End of brief <span aria-hidden="true">—</span> {formatBriefDate(edition().id, 'short')}</span><Show when={selected() < editions().length - 1}><button type="button" disabled={loading()} onClick={() => void chooseEdition(selected() + 1)}>Read previous edition <Arrow direction="right" /></button></Show></footer>
          </article>
        </div>
      </div>
    </main>
  );
};

export default Brief;
