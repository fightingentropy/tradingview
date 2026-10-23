import { usePageActive } from "./PageView";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { formatBriefDate, isTodaysEdition, type DailyBrief } from '../lib/dailyBrief';
import { parseBriefIndex, parseBriefPayload } from '../lib/dailyBriefFeed';
import { convex } from '../lib/convex';
import { isAdmin } from '../stores/auth';
import { api } from '../../convex/_generated/api';
import './Brief.css';

type RunState = { status: string; startedAt?: string; error?: string };
const ACTIVE_RUN = new Set(['queued', 'running', 'waiting', 'paused', 'waitingForPause', 'rollingBack']);
const runClock = (iso?: string) => iso
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
  : '';
import BriefContent from './BriefContent';

const generationTime = (generated: string) => {
  const hour = Number(generated.slice(11, 13));
  return `${hour % 12 || 12}:${generated.slice(14, 16)} ${hour < 12 ? 'am' : 'pm'}`;
};

const ChevronDown: Component = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const Brief: Component = () => {
  const pageActive = usePageActive();
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
  // Briefs run only on demand, so an edition from an earlier London day is never shown.
  const current = createMemo(() => { const brief = edition(); return brief && isTodaysEdition(brief, now()) ? brief : undefined; });
  const [run, setRun] = createSignal<RunState>();
  const [runError, setRunError] = createSignal('');
  const [starting, setStarting] = createSignal(false);
  const running = createMemo(() => starting() || ACTIVE_RUN.has(run()?.status ?? ''));
  let runTimer: number | undefined;

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
        // Replace the displayed edition only after its successor validates.
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
      if (!disposed) setFeedError(current() ? 'Couldn’t refresh · Showing saved edition.' : 'Brief unavailable. Please try again.');
    } finally {
      feedBusy = false;
      if (!disposed) setLoading(false);
    }
  };

  // On-demand runs: poll the Worker's run status until the new edition lands.
  const checkRun = async () => {
    try {
      const response = await fetch('/api/daily-briefs/run', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return;
      const next = await response.json() as RunState;
      const wasActive = ACTIVE_RUN.has(run()?.status ?? '');
      setRun(next);
      if (wasActive && next.status === 'complete') void refreshEdition();
      if (!ACTIVE_RUN.has(next.status) && runTimer) { window.clearInterval(runTimer); runTimer = undefined; }
    } catch { /* The next poll retries. */ }
  };
  const watchRun = () => {
    if (!runTimer) runTimer = window.setInterval(() => void checkRun(), 15_000);
    void checkRun();
  };
  const startRun = async () => {
    if (running()) return;
    setStarting(true);
    setRunError('');
    try {
      setRun(await convex.action(api.brief.runDailyBrief, {}));
      watchRun();
    } catch (error) {
      setRunError(error instanceof Error ? error.message.replace(/^.*ConvexError:\s*/, '') : 'The brief could not start.');
    } finally {
      setStarting(false);
    }
  };

  onMount(() => {
    void checkRun().then(() => { if (ACTIVE_RUN.has(run()?.status ?? '')) watchRun(); });
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    const refresh = () => { if (pageActive() && document.visibilityState === 'visible') void refreshEdition(); };
    const feedTimer = window.setInterval(refresh, 5 * 60_000);
    document.addEventListener('visibilitychange', refresh);
    onCleanup(() => {
      disposed = true;
      window.clearInterval(timer);
      window.clearInterval(feedTimer);
      if (runTimer) window.clearInterval(runTimer);
      document.removeEventListener('visibilitychange', refresh);
      for (const request of requests) request.abort();
    });
  });

  createEffect(() => { if (pageActive()) void refreshEdition(); });

  const updateReadingPosition = () => {
    const currentBrief = current();
    if (!currentBrief) return;
    const maximum = scroller.scrollHeight - scroller.clientHeight;
    setProgress(maximum > 0 ? Math.min(100, scroller.scrollTop / maximum * 100) : 100);
    let active = currentBrief.sections[0]?.id ?? '';
    const top = scroller.getBoundingClientRect().top;
    for (const section of currentBrief.sections) {
      const heading = headings.get(section.id);
      if (heading && heading.getBoundingClientRect().top - top <= 150) active = section.id;
    }
    setActiveSection(active);
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
      <div class="brief-reading-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress() / 100})` }} /></div>
      <div class="brief-frame">
        <header class="brief-masthead">
          <div>
            <h1>Daily brief<span aria-hidden="true">.</span></h1>
          </div>
          <div class="brief-actions">
          <Show when={isAdmin()}>
            <button type="button" class="brief-download brief-run" disabled={running()} onClick={() => void startRun()}
              title="Research and publish a fresh brief now (about 10–20 minutes)">
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" /></svg>
              {running() ? 'Researching…' : 'Run brief now'}
            </button>
          </Show>
          <Show when={current()}>{(brief) => <a class="brief-download" download={`market-overview-${brief().id}.md`} href={`data:text/markdown;charset=utf-8,${encodeURIComponent(brief().raw)}`}>
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" /></svg>
            Save brief
          </a>}</Show>
          </div>
        </header>
        <Show when={isAdmin() && (runError() || running() || run()?.status === 'errored')}>
          <div class="brief-feed-status" classList={{ 'is-running': !runError() && running() }} role="status">
            {runError() || (running()
              ? `Researching a fresh brief since ${runClock(run()?.startedAt) || 'now'} (London). It replaces today's edition when done.`
              : `The last run failed${run()?.error ? `: ${run()?.error}` : '.'} Run it again to retry.`)}
          </div>
        </Show>

        <Show when={feedError() && !loading()}><div class="brief-feed-status" role="status">{feedError()}<button type="button" onClick={() => void refreshEdition()}>Retry</button></div></Show>
        <Show when={loading() && !current()}><div class="brief-loading" role="status" aria-label="Loading daily brief"><span class="brief-spinner" aria-hidden="true" /></div></Show>
        <Show when={!loading() && !feedError() && !current() && !running()}>
          <div class="brief-empty" role="status">
            <p class="brief-empty-title">No brief today</p>
            <p>{isAdmin() ? 'Press Run brief now to research and publish one.' : 'A brief appears here once one is generated today.'}</p>
          </div>
        </Show>

        <Show when={current()}>{(brief) => <>
        <div class="brief-edition-bar">
          <div class="brief-edition-stamp">
            <time class="brief-edition-date" dateTime={brief().id}>{formatBriefDate(brief().id, 'short')}</time>
            <span aria-hidden="true">·</span>
            <span class="brief-edition-time">Generated at {generationTime(brief().generated)} (London)</span>
          </div>
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
            <div class="brief-sidebar-note"><span>US markets</span><p>Facts, interpretation, and conditional market views.</p></div>
          </aside>

          <article class="brief-article" aria-labelledby="brief-title" aria-busy={loading()}>
            <div class="brief-article-header">
              <div class="brief-publication-line"><span class="brief-status brief-status-today">Today's edition</span></div>
              <h2 id="brief-title">{brief().title}</h2>
              <details class="brief-about">
                <summary><span>About this brief</span><ChevronDown /></summary>
                <dl class="brief-metadata">
                <div><dt>Generated</dt><dd>{generationTime(brief().generated)} <span>Europe/London</span></dd></div>
                <div><dt>Market state</dt><dd>{brief().marketState}</dd></div>
                <div class="brief-cutoff"><dt>Data cutoff</dt><dd>{brief().cutoff}</dd></div>
                </dl>
              </details>
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
