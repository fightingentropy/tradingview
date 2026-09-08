import {
  Component,
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { fetchMetaAndAssetCtxs } from "../lib/hyperliquid";
import {
  briefSources,
  catalysts,
  crossAssetRead,
  dataCaveats,
  downsideRadar,
  marketSnapshots,
  regime,
  scenarios,
  sourceTrail,
  traderViews,
  upsideRadar,
  whatChanged,
} from "../data/marketBrief";
import type { BriefSource, BriefTone } from "../data/marketBrief";

type CryptoQuote = {
  symbol: "BTC" | "ETH" | "HYPE";
  mark: number;
  prior: number;
};

const FALLBACK_CRYPTO: CryptoQuote[] = [
  { symbol: "BTC", mark: 78_576, prior: 77_564 },
  { symbol: "ETH", mark: 2_467.7, prior: 2_435.7 },
  { symbol: "HYPE", mark: 83.531, prior: 81.184 },
];

const toneTextClass = (tone: BriefTone) => {
  if (tone === "positive") return "text-brand-accent";
  if (tone === "negative") return "text-brand-red-400";
  if (tone === "warning") return "text-amber-300";
  return "text-slate-300";
};

const toneDotClass = (tone: BriefTone) => {
  if (tone === "positive") return "bg-brand-accent";
  if (tone === "negative") return "bg-brand-red-400";
  if (tone === "warning") return "bg-amber-300";
  return "bg-slate-500";
};

const formatLondonTime = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
    timeZoneName: "short",
  }).format(date);

const formatPrice = (quote: CryptoQuote) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: quote.symbol === "BTC" ? 0 : 2,
    maximumFractionDigits: quote.symbol === "BTC" ? 0 : 2,
  }).format(quote.mark);

const quoteChange = (quote: CryptoQuote) =>
  ((quote.mark - quote.prior) / quote.prior) * 100;

const ExternalLinkIcon: Component = () => (
  <svg
    aria-hidden="true"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

const SourceLink: Component<{ source: BriefSource; compact?: boolean }> = (
  props,
) => (
  <a
    href={props.source.href}
    target="_blank"
    rel="noreferrer"
    class={`inline-flex items-center gap-1 text-brand-slate-400 transition-colors hover:text-brand-accent ${
      props.compact ? "text-[10px]" : "text-xs"
    }`}
  >
    <span>{props.source.label}</span>
    <ExternalLinkIcon />
  </a>
);

const SectionHeading: Component<{
  index: string;
  title: string;
  subtitle?: string;
}> = (props) => (
  <div class="mb-4 flex items-start gap-3">
    <span class="mt-0.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-brand-accent">
      {props.index}
    </span>
    <div>
      <h2 class="text-base font-semibold tracking-tight text-slate-100">
        {props.title}
      </h2>
      <Show when={props.subtitle}>
        <p class="mt-1 text-xs leading-5 text-brand-slate-400">
          {props.subtitle}
        </p>
      </Show>
    </div>
  </div>
);

const Brief: Component = () => {
  const [cryptoQuotes, setCryptoQuotes] =
    createSignal<CryptoQuote[]>(FALLBACK_CRYPTO);
  const [cryptoUpdatedAt, setCryptoUpdatedAt] = createSignal("13:16 BST");
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  const [usingLiveCrypto, setUsingLiveCrypto] = createSignal(false);

  const refreshCrypto = async (signal?: AbortSignal) => {
    setIsRefreshing(true);
    try {
      const response = await fetchMetaAndAssetCtxs(signal);
      if (!response) return;

      const wanted = new Set(["BTC", "ETH", "HYPE"]);
      const next = response.universe.flatMap((asset, index) => {
        if (!wanted.has(asset.name)) return [];
        const context = response.ctx[index];
        const mark = Number(context?.markPx);
        const prior = Number(context?.prevDayPx);
        if (!Number.isFinite(mark) || !Number.isFinite(prior) || prior <= 0) {
          return [];
        }
        return [
          {
            symbol: asset.name as CryptoQuote["symbol"],
            mark,
            prior,
          },
        ];
      });

      if (next.length === 3) {
        const order = { BTC: 0, ETH: 1, HYPE: 2 } as const;
        next.sort((a, b) => order[a.symbol] - order[b.symbol]);
        setCryptoQuotes(next);
        setCryptoUpdatedAt(formatLondonTime(new Date()));
        setUsingLiveCrypto(true);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  onMount(() => {
    const controller = new AbortController();
    void refreshCrypto(controller.signal);
    const refreshInterval = window.setInterval(
      () => void refreshCrypto(controller.signal),
      60_000,
    );
    onCleanup(() => {
      controller.abort();
      clearInterval(refreshInterval);
    });
  });

  return (
    <main class="h-full overflow-y-auto bg-brand-screen text-slate-200 select-text">
      <div class="mx-auto w-full max-w-[1540px] px-4 pb-14 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        <section class="relative overflow-hidden rounded-2xl border border-brand-border bg-brand-surface/70 px-5 py-6 sm:px-7 sm:py-7 lg:px-9 lg:py-8">
          <div class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/70 to-transparent" />
          <div class="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-brand-accent/[0.035] blur-3xl" />

          <div class="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div class="max-w-4xl">
              <div class="mb-4 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                <span class="rounded-full border border-brand-accent/30 bg-brand-accent/10 px-2.5 py-1 text-brand-accent">
                  Global macro PM brief
                </span>
                <span class="rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-1 text-amber-200">
                  Weekend · next-session setup
                </span>
                <span class="text-brand-slate-500">Medium confidence</span>
              </div>

              <p class="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-brand-slate-400">
                Market verdict
              </p>
              <h1 class="max-w-5xl text-2xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-3xl lg:text-[38px] lg:leading-[1.15]">
                Hawkish rate repricing is the dominant impulse, but equities,
                credit and volatility have not confirmed a full risk-off break.
              </h1>
              <p class="mt-4 max-w-4xl text-sm leading-6 text-slate-300 sm:text-[15px]">
                The tape is rotational and unstable: front-end yields and the
                dollar tightened, small caps and precious metals sold off, while
                mega-cap AI strength kept the weekly index complex positive. The
                next move belongs to labor data, services inflation and Hormuz—not
                another speech.
              </p>
            </div>

            <div class="shrink-0 border-l border-brand-border pl-4 font-mono text-[10px] leading-5 text-brand-slate-400 lg:w-72">
              <p>
                <span class="text-slate-200">Generated:</span> 30 Aug 2026 ·
                13:20 BST
              </p>
              <p>
                <span class="text-slate-200">Cash cutoff:</span> 28 Aug close
              </p>
              <p>
                <span class="text-slate-200">News cutoff:</span> 30 Aug · 13:20
                BST
              </p>
              <p>
                <span class="text-slate-200">Crypto:</span> live marks ·
                Hyperliquid
              </p>
            </div>
          </div>
        </section>

        <section class="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <For each={marketSnapshots}>
            {(snapshot) => (
              <a
                href={snapshot.source.href}
                target="_blank"
                rel="noreferrer"
                class="group rounded-xl border border-brand-border bg-brand-surface/55 px-3.5 py-3 transition-colors hover:border-brand-slate-600"
              >
                <div class="flex items-center justify-between gap-2">
                  <p class="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-brand-slate-500">
                    {snapshot.label}
                  </p>
                  <ExternalLinkIcon />
                </div>
                <p class="mt-2 font-mono text-sm font-semibold text-slate-100">
                  {snapshot.value}
                </p>
                <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px]">
                  <span class={toneTextClass(snapshot.tone)}>
                    {snapshot.change}
                  </span>
                  <span class="text-brand-slate-500">{snapshot.note}</span>
                </div>
              </a>
            )}
          </For>
        </section>

        <div class="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
          <div class="space-y-3">
            <section class="rounded-2xl border border-brand-border bg-brand-surface/50 p-5 sm:p-6">
              <SectionHeading
                index="01"
                title="What changed"
                subtitle="Only material deltas from the latest session and weekend evidence."
              />

              <div class="divide-y divide-brand-border/80">
                <For each={whatChanged}>
                  {(item, index) => (
                    <article class="grid gap-3 py-4 first:pt-1 sm:grid-cols-[70px_minmax(0,1fr)]">
                      <div>
                        <span class="font-mono text-[10px] font-semibold tracking-[0.14em] text-brand-accent">
                          {item.tag}
                        </span>
                        <p class="mt-1 font-mono text-[10px] text-brand-slate-600">
                          0{index() + 1}
                        </p>
                      </div>
                      <div>
                        <h3 class="text-sm font-semibold leading-5 text-slate-100">
                          {item.headline}
                        </h3>
                        <p class="mt-1.5 text-xs leading-5 text-brand-slate-400">
                          {item.detail}
                        </p>
                        <p class="mt-2 border-l border-brand-border pl-3 text-xs leading-5 text-slate-300">
                          <span class="font-medium text-slate-100">PM read: </span>
                          {item.implication}
                        </p>
                        <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                          <For each={item.sources}>
                            {(source) => (
                              <SourceLink source={source} compact />
                            )}
                          </For>
                        </div>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </section>

            <section class="rounded-2xl border border-brand-border bg-brand-surface/50 p-5 sm:p-6">
              <SectionHeading
                index="02"
                title="Cross-asset read"
                subtitle="One policy shock, different levels of confirmation."
              />
              <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <For each={crossAssetRead}>
                  {(item) => (
                    <div class="rounded-xl border border-brand-border bg-brand-screen/45 p-4">
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-xs font-semibold uppercase tracking-[0.12em] text-brand-slate-400">
                          {item.asset}
                        </span>
                        <span
                          class={`h-1.5 w-1.5 rounded-full ${toneDotClass(item.tone)}`}
                        />
                      </div>
                      <p class={`mt-3 text-sm font-semibold ${toneTextClass(item.tone)}`}>
                        {item.read}
                      </p>
                      <p class="mt-1.5 text-xs leading-5 text-brand-slate-400">
                        {item.signal}
                      </p>
                      <div class="mt-2.5 flex flex-wrap gap-x-2 gap-y-1">
                        <For each={item.sources}>
                          {(source) => (
                            <SourceLink source={source} compact />
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <section class="rounded-2xl border border-brand-border bg-brand-surface/50 p-5 sm:p-6">
              <SectionHeading
                index="03"
                title="Risk & opportunity radar"
                subtitle="Observable paths that can change the current read."
              />
              <div class="grid gap-3 md:grid-cols-2">
                <div class="rounded-xl border border-brand-accent/15 bg-brand-accent/[0.035] p-4">
                  <p class="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-brand-accent">
                    Upside developments
                  </p>
                  <div class="space-y-3">
                    <For each={upsideRadar}>
                      {(item) => (
                        <div class="flex gap-3 text-xs leading-5 text-slate-300">
                          <span class="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-accent" />
                          <p>{item}</p>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
                <div class="rounded-xl border border-brand-red-400/15 bg-brand-red-400/[0.035] p-4">
                  <p class="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-brand-red-400">
                    Downside risks
                  </p>
                  <div class="space-y-3">
                    <For each={downsideRadar}>
                      {(item) => (
                        <div class="flex gap-3 text-xs leading-5 text-slate-300">
                          <span class="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-red-400" />
                          <p>{item}</p>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </section>

            <section class="rounded-2xl border border-brand-border bg-brand-surface/50 p-5 sm:p-6">
              <SectionHeading
                index="04"
                title="PM bottom line"
                subtitle="Probabilities sum to 100%; implications are relative, not position-size advice."
              />
              <div class="space-y-2">
                <For each={scenarios}>
                  {(scenario) => (
                    <article class="rounded-xl border border-brand-border bg-brand-screen/45 p-4 sm:p-5">
                      <div class="flex items-center gap-4">
                        <div class={`font-mono text-2xl font-semibold ${toneTextClass(scenario.tone)}`}>
                          {scenario.probability}%
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="mb-2 flex items-center justify-between gap-3">
                            <h3 class="text-sm font-semibold text-slate-100">
                              {scenario.name}
                            </h3>
                            <div class="h-1 w-24 overflow-hidden rounded-full bg-brand-border sm:w-40">
                              <div
                                class={toneDotClass(scenario.tone)}
                                style={{ width: `${scenario.probability}%`, height: "100%" }}
                              />
                            </div>
                          </div>
                          <p class="text-xs leading-5 text-slate-300">
                            {scenario.path}
                          </p>
                        </div>
                      </div>
                      <div class="mt-3 grid gap-2 border-t border-brand-border/80 pt-3 text-[11px] leading-5 text-brand-slate-400 md:grid-cols-2">
                        <p>
                          <span class="text-slate-200">Expression: </span>
                          {scenario.implication}
                        </p>
                        <p>
                          <span class="text-slate-200">Confirm: </span>
                          {scenario.confirmation}
                        </p>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </section>
          </div>

          <aside class="space-y-3">
            <section class="rounded-2xl border border-brand-border bg-brand-surface/50 p-5">
              <SectionHeading index="A" title="Regime assessment" />
              <div class="space-y-4">
                <For each={regime}>
                  {(item) => (
                    <div class="border-b border-brand-border/80 pb-4 last:border-0 last:pb-0">
                      <div class="flex items-center justify-between gap-3">
                        <p class="text-xs font-medium text-brand-slate-400">
                          {item.label}
                        </p>
                        <p class={`text-xs font-semibold ${toneTextClass(item.tone)}`}>
                          {item.value}
                        </p>
                      </div>
                      <p class="mt-1.5 text-[11px] leading-5 text-brand-slate-500">
                        {item.detail}
                      </p>
                    </div>
                  )}
                </For>
              </div>
              <div class="mt-5 rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-4">
                <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
                  Overall regime · medium confidence
                </p>
                <p class="mt-2 text-xs leading-5 text-slate-300">
                  Inflation-constrained nominal resilience: strong AI investment
                  sits beside soft labor and consumption. Invalidated if activity
                  data roll over while Friday's front-end yield move fully reverses.
                </p>
              </div>
            </section>

            <section class="rounded-2xl border border-brand-border bg-brand-surface/50 p-5">
              <div class="flex items-start justify-between gap-3">
                <SectionHeading
                  index="B"
                  title="Live crypto marks"
                  subtitle="Direct Hyperliquid perps marks; 24-hour comparison."
                />
                <button
                  type="button"
                  aria-label="Refresh crypto prices"
                  class="mt-0.5 rounded-lg border border-brand-border p-2 text-brand-slate-400 transition-colors hover:border-brand-accent/40 hover:text-brand-accent disabled:opacity-50"
                  disabled={isRefreshing()}
                  onClick={() => void refreshCrypto()}
                >
                  <svg
                    aria-hidden="true"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class={isRefreshing() ? "animate-spin" : ""}
                  >
                    <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
                    <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
                  </svg>
                </button>
              </div>
              <div class="grid grid-cols-3 gap-2">
                <For each={cryptoQuotes()}>
                  {(quote) => {
                    const change = () => quoteChange(quote);
                    return (
                      <div class="rounded-xl border border-brand-border bg-brand-screen/45 p-3">
                        <p class="font-mono text-[10px] font-semibold text-brand-slate-400">
                          {quote.symbol}
                        </p>
                        <p class="mt-2 truncate font-mono text-sm font-semibold text-slate-100">
                          {formatPrice(quote)}
                        </p>
                        <p
                          class={`mt-1 font-mono text-[10px] ${
                            change() >= 0
                              ? "text-brand-accent"
                              : "text-brand-red-400"
                          }`}
                        >
                          {change() >= 0 ? "+" : ""}
                          {change().toFixed(2)}%
                        </p>
                      </div>
                    );
                  }}
                </For>
              </div>
              <div class="mt-3 flex items-center justify-between gap-3 font-mono text-[9px] text-brand-slate-500">
                <span>
                  {usingLiveCrypto() ? "LIVE" : "SNAPSHOT"} · {cryptoUpdatedAt()}
                </span>
                <SourceLink source={briefSources.hyperliquid} compact />
              </div>
            </section>

            <section class="rounded-2xl border border-brand-border bg-brand-surface/50 p-5">
              <SectionHeading
                index="C"
                title="What matters next"
                subtitle="Highest-sensitivity events in Europe/London time."
              />
              <div class="space-y-4">
                <For each={catalysts}>
                  {(item) => (
                    <article class="relative border-l border-brand-border pl-4">
                      <span class="absolute -left-[3px] top-1 h-[5px] w-[5px] rounded-full bg-brand-accent" />
                      <div class="flex flex-wrap items-center gap-x-2 font-mono text-[9px] uppercase tracking-[0.12em]">
                        <span class="text-brand-accent">{item.date}</span>
                        <span class="text-brand-slate-500">{item.time}</span>
                      </div>
                      <h3 class="mt-1.5 text-xs font-semibold text-slate-100">
                        {item.event}
                      </h3>
                      <p class="mt-1 text-[11px] leading-5 text-brand-slate-400">
                        {item.setup}
                      </p>
                      <p class="mt-1 text-[11px] leading-5 text-slate-300">
                        {item.reaction}
                      </p>
                      <div class="mt-1.5">
                        <SourceLink source={item.source} compact />
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </section>

            <section class="rounded-2xl border border-brand-border bg-brand-surface/50 p-5">
              <SectionHeading
                index="D"
                title="Trader pulse"
                subtitle="Named views, not verified facts or consensus positioning."
              />
              <div class="space-y-3">
                <For each={traderViews}>
                  {(view) => (
                    <a
                      href={view.href}
                      target="_blank"
                      rel="noreferrer"
                      class="block rounded-xl border border-brand-border bg-brand-screen/45 p-3.5 transition-colors hover:border-brand-slate-600"
                    >
                      <div class="flex items-center justify-between gap-3">
                        <span class="font-mono text-[10px] font-semibold text-brand-accent">
                          {view.handle}
                        </span>
                        <ExternalLinkIcon />
                      </div>
                      <p class="mt-1.5 text-[10px] uppercase tracking-[0.1em] text-brand-slate-500">
                        {view.stance}
                      </p>
                      <p class="mt-2 text-[11px] leading-5 text-slate-300">
                        {view.view}
                      </p>
                    </a>
                  )}
                </For>
              </div>
              <p class="mt-4 border-t border-brand-border pt-4 text-[11px] leading-5 text-brand-slate-400">
                <span class="font-semibold text-slate-200">My read: </span>
                the feed confirms disagreement—macro caution beside secular AI
                and crypto optimism—not a durable directional consensus. For You
                skewed toward unrelated tech and crypto attention, so it adds no
                independent macro confirmation.
              </p>
            </section>

            <section class="rounded-2xl border border-brand-border bg-brand-surface/50 p-5">
              <SectionHeading index="E" title="Data caveats" />
              <div class="space-y-2.5">
                <For each={dataCaveats}>
                  {(item) => (
                    <div class="flex gap-2.5 text-[11px] leading-5 text-brand-slate-400">
                      <span class="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-slate-600" />
                      <p>{item}</p>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <section class="rounded-2xl border border-brand-border bg-brand-surface/50 p-5">
              <SectionHeading index="F" title="Source trail" />
              <div class="flex flex-col items-start gap-2.5">
                <For each={sourceTrail}>
                  {(source) => <SourceLink source={source} />}
                </For>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
};

export default Brief;
