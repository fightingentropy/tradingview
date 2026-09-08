import {
  type Component,
  Show,
  Suspense,
  createSignal,
  lazy,
  onCleanup,
  onMount,
} from "solid-js";

const TradingViewChart = lazy(() => import("./TradingViewChart"));

const ChartPlaceholder: Component = () => (
  <div
    class="chart-container trade-chart relative flex min-h-0 flex-1 flex-col bg-brand-screen"
    aria-label="Loading chart"
    aria-busy="true"
  >
    <div class="h-9 shrink-0 border-b border-brand-border bg-brand-surface/50" />
    <div class="flex flex-1 items-center justify-center text-xs text-brand-slate-500">
      Loading chart…
    </div>
  </div>
);

const DeferredTradingViewChart: Component = () => {
  const [ready, setReady] = createSignal(false);
  let firstFrame: number | undefined;
  let secondFrame: number | undefined;

  onMount(() => {
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setReady(true));
    });
  });

  onCleanup(() => {
    if (firstFrame !== undefined) cancelAnimationFrame(firstFrame);
    if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
  });

  return (
    <Show when={ready()} fallback={<ChartPlaceholder />}>
      <Suspense fallback={<ChartPlaceholder />}>
        <TradingViewChart />
      </Suspense>
    </Show>
  );
};

export default DeferredTradingViewChart;
