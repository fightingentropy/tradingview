import { For, Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { editionStatus, formatBriefDate, type DailyBrief } from '../lib/dailyBrief';
import { parseBriefIndex, parseBriefPayload } from '../lib/dailyBriefFeed';
import BriefContent from './BriefContent';
import './Brief.css';

const ChevronDown: Component = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const Brief: Component = () => {
  let scroller!: HTMLElement;
  const headings = new Map<string, HTMLHeadingElement>();
  const [edition, setEdition] = createSignal<DailyBrief>();
  const [feedError, setFeedError] = createSignal('');
  const [loading, setLoading] = createSignal(true);
  let feedBusy = false;
  const requests = new Set<AbortController>();
  let disposed = false;
  const [activeSection, setActiveSection] = createSignal('brief-section-1');
  const [progress, setProgress] = createSignal(0);
  const [now, setNow] = createSignal(new Date());
  const [sourcesOpen, setSourcesOpen] = createSignal(false);
  const status = createMemo(() => { const brief = edition(); return brief ? editionStatus(brief, brief.id, now()) : undefined; });

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

  const refreshEdition = async () => {
    if (feedBusy || disposed) return;
    feedBusy = true;
    setLoading(true);
    try {
      const index = parseBriefIndex(await fetchJson('/api/daily-briefs'));
      if (disposed) return;
      const latest = index.editions[0]!;
      const current = edition();
      if (!current || current.id !== latest.id || current.title !== latest.title || current.generated !== latest.generated) {
        // Never substitute a bundled or older edition when the latest cannot load.
        setEdition(undefined);
        const next = parseBriefPayload(await fetchJson(`/api/daily-briefs/${latest.id}`), latest);
        if (disposed) return;
        headings.clear();
        setEdition(next);
        setActiveSection('brief-section-1');
        setProgress(0);
        setSourcesOpen(false);
        scroller.scrollTo({ top: 0, behavior: 'instant' });
      }
      setFeedError('');
    } catch {
      if (!disposed) setFeedError(edition() ? 'Couldn’t refresh this brief.' : 'Brief unavailable. Please try again.');
    } finally {
      feedBusy = false;
      if (!disposed) setLoading(false);
    }
  };

  onMount(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    const refresh = () => { if (document.visibilityState === 'visible') void refreshEdition(); };
    const feedTimer = window.setInterval(refresh, 5 * 60_000);
    document.addEventListener('visibilitychange', refresh);
    void refreshEdition();
    onCleanup(() => {
      disposed = true;
      window.clearInterval(timer);
      window.clearInterval(feedTimer);
      document.removeEventListener('visibilitychange', refresh);
      for (const request of requests) request.abort();
    });
  });

  const updateReadingPosition = () => {
    const currentBrief = edition();
    if (!currentBrief) return;
    const maximum = scroller.scrollHeight - scroller.clientHeight;
    setProgress(maximum > 0 ? Math.min(100, scroller.scrollTop / maximum * 100) : 100);
    let current = currentBrief.sections[0]?.id ?? '';
    const top = scroller.getBoundingClientRect().top;
    for (const section of currentBrief.sections) {
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
    <main ref={scroller} class="daily-brief-page" aria-label="Daily market brief" aria-busy={loading()} onScroll={updateReadingPosition}>
      <div class="brief-reading-progress" aria-hidden="true"><span style={{ width: `${progress()}%` }} /></div>
      <div class="brief-frame">
        <header class="brief-masthead">
          <div>
            <div class="brief-eyebrow">Markets & perspective</div>
            <h1>Daily brief<span aria-hidden="true">.</span></h1>
            <p>What changed. Why it matters. What comes next.</p>
          </div>
          <Show when={edition()}>{(brief) => <a class="brief-download" download={`market-overview-${brief().id}.md`} href={`data:text/markdown;charset=utf-8,${encodeURIComponent(brief().raw)}`}>
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" /></svg>
            Save brief
          </a>}</Show>
        </header>

        <Show when={feedError() && !loading()}><div class="brief-feed-status" role="status">{feedError()}<button type="button" onClick={() => void refreshEdition()}>Retry</button></div></Show>
        <Show when={loading() && !edition()}><div class="brief-loading" role="status" aria-label="Loading daily brief"><span class="brief-spinner" aria-hidden="true" /></div></Show>

        <Show when={edition()}>{(brief) => <>
        <div class="brief-edition-bar">
          <time class="brief-edition-date" dateTime={brief().id}>{formatBriefDate(brief().id, 'short')}</time>
          <div class="brief-edition-details"><span>{brief().readingMinutes} min read</span><span aria-hidden="true">·</span><span>{brief().sources.length} sources</span></div>
        </div>

        <div class="brief-layout">
          <aside class="brief-sidebar">
            <div class="brief-sidebar-label">In this brief</div>
            <nav aria-label="Brief sections">
              <For each={brief().sections}>{(section, index) => (
                <a href={`#${section.id}`} aria-current={activeSection() === section.id ? 'location' : undefined} onClick={(event) => { event.preventDefault(); jumpTo(section.id); }}>
                  <span class="brief-section-number">{String(index() + 1).padStart(2, '0')}</span><span>{section.title}</span>
                </a>
              )}</For>
            </nav>
            <div class="brief-sidebar-note"><span>Global macro</span><p>Facts, interpretation, and conditional market views.</p></div>
          </aside>

          <article class="brief-article" aria-labelledby="brief-title" aria-busy={loading()}>
            <div class="brief-article-header">
              <div class="brief-publication-line"><span classList={{ 'brief-status': true, 'brief-status-today': status() === 'today' }}>{status() === 'today' ? "Today's edition" : 'Latest available edition'}</span><time dateTime={brief().id}>{formatBriefDate(brief().id)}</time></div>
              <h2 id="brief-title">{brief().title}</h2>
              <Show when={status() !== 'today'}><p class="brief-cutoff-note">A newer brief has not been published yet. Figures reflect the cutoff below.</p></Show>
              <dl class="brief-metadata">
                <div><dt>Generated</dt><dd>{brief().generated.slice(11)} <span>Europe/London</span></dd></div>
                <div><dt>Market state</dt><dd>{brief().marketState}</dd></div>
                <div class="brief-cutoff"><dt>Data cutoff</dt><dd>{brief().cutoff}</dd></div>
              </dl>
            </div>

            <div class="brief-mobile-contents">
              <label for="brief-jump">In this brief</label>
              <select id="brief-jump" value={activeSection()} onChange={(event) => jumpTo(event.currentTarget.value)}><For each={brief().sections}>{(section) => <option value={section.id}>{section.title}</option>}</For></select>
            </div>

            <For each={brief().sections}>{(section, index) => (
              <section classList={{ 'brief-section': true, 'brief-verdict': index() === 0, 'brief-caveats': section.title.toLowerCase() === 'data caveats' }} aria-labelledby={section.id}>
                <h3 ref={(element) => headings.set(section.id, element)} id={section.id} tabIndex={-1}><span aria-hidden="true">{String(index() + 1).padStart(2, '0')}</span>{section.title}</h3>
                <div class="brief-prose"><BriefContent blocks={section.blocks} /></div>
              </section>
            )}</For>

            <details class="brief-source-notes" open={sourcesOpen()} onToggle={(event) => setSourcesOpen(event.currentTarget.open)}>
              <summary><span>Sources for this edition</span><span>{brief().sources.length}<ChevronDown /></span></summary>
              <p>Claims link directly to their sources in the brief. This index collects those references.</p>
              <ul><For each={brief().sources}>{(source) => <li><a href={source.href} target="_blank" rel="noopener noreferrer"><span>{source.label}</span><span>{new URL(source.href).hostname.replace(/^www\./, '')}</span></a></li>}</For></ul>
            </details>

            <footer class="brief-footer"><span>End of brief <span aria-hidden="true">—</span> {formatBriefDate(brief().id, 'short')}</span></footer>
          </article>
        </div>
        </>}</Show>
      </div>
    </main>
  );
};

export default Brief;
