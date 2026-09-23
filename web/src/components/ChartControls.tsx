import { type Component, For, Show, createMemo, createSignal, createUniqueId, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { CHART_RESOLUTIONS, RESOLUTION_LABELS, type ChartResolution } from "../lib/candles";
import { MA_COLORS, MA_PERIODS } from "../lib/movingAverages";
import { maEnabled, toggleMa } from "../stores/chartIndicators";
import "./ChartControls.css";

interface ChartControlsProps {
  resolution: ChartResolution;
  onResolutionChange: (resolution: ChartResolution) => void;
}

const ChartControls: Component<ChartControlsProps> = props => {
  const [menu, setMenu] = createSignal<"interval" | "ma" | null>(null);
  const [hoveringIntervals, setHoveringIntervals] = createSignal(false);
  const [focusingIntervals, setFocusingIntervals] = createSignal(false);
  const inlineIntervalsOpen = () => hoveringIntervals() || focusingIntervals();
  const inactiveResolutions = createMemo(() => CHART_RESOLUTIONS.filter(resolution => resolution !== props.resolution));
  const [position, setPosition] = createSignal({ left: 0, top: 0 });
  const menuId = createUniqueId();
  let controls: HTMLDivElement | undefined;
  let popover: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let intervalButton: HTMLButtonElement | undefined;
  const close = (restoreFocus = false) => {
    setMenu(null);
    if (restoreFocus) trigger?.focus({ preventScroll: true });
  };
  const open = (next: "interval" | "ma", button: HTMLButtonElement) => {
    if (menu() === next) { close(); return; }
    trigger = button;
    const rect = controls!.getBoundingClientRect();
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 224)),
      top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 204)) });
    setMenu(next);
    queueMicrotask(() => popover?.querySelector<HTMLElement>(next === "interval" ? '[aria-pressed="true"]' : "input")?.focus({ preventScroll: true }));
  };
  onMount(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!controls?.contains(target) && !popover?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!menu() && !inlineIntervalsOpen())) return;
      event.preventDefault();
      if (menu()) close(true);
      else intervalButton?.focus({ preventScroll: true });
      setHoveringIntervals(false);
      setFocusingIntervals(false);
    };
    const resize = () => close();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", resize);
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", resize);
    });
  });

  return <>
    <div class="chart-tools-slot">
    <div ref={controls} class="chart-tools" role="group" aria-label="Chart controls"
      onPointerDown={event => event.stopPropagation()} onFocusIn={event => event.stopPropagation()}
      onPointerLeave={() => setHoveringIntervals(false)}>
      <div class="chart-tools-timeframes" data-expanded={inlineIntervalsOpen()}
        onPointerEnter={event => { if (event.pointerType === "mouse" && window.matchMedia("(hover: hover)").matches) setHoveringIntervals(true); }}
        onPointerLeave={event => { if (!controls?.contains(event.relatedTarget as Node | null)) setHoveringIntervals(false); }}
        onFocusIn={event => { if ((event.target as HTMLElement).matches(":focus-visible")) setFocusingIntervals(true); }}
        onFocusOut={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusingIntervals(false); }}>
        <button ref={intervalButton} class="chart-tools-interval" aria-label={`Chart interval: ${RESOLUTION_LABELS[props.resolution]}`}
          aria-expanded={inlineIntervalsOpen() || menu() === "interval"} aria-controls={menu() === "interval" ? menuId : `${menuId}-intervals`}
          onClick={event => { if (!inlineIntervalsOpen()) open("interval", event.currentTarget); }}>
          {RESOLUTION_LABELS[props.resolution]}
        </button>
        <div id={`${menuId}-intervals`} class="chart-tools-inline-intervals" inert={!inlineIntervalsOpen()} aria-hidden={!inlineIntervalsOpen()}>
          <For each={inactiveResolutions()}>{resolution => <button onClick={() => {
            props.onResolutionChange(resolution);
            intervalButton?.focus({ preventScroll: true });
          }}>{RESOLUTION_LABELS[resolution]}</button>}</For>
        </div>
      </div>
      <span class="chart-tools-divider" />
      <button classList={{ "has-indicators": MA_PERIODS.some(period => maEnabled()[period]) }}
        aria-label="Moving averages" title="Moving averages" aria-haspopup="dialog" aria-expanded={menu() === "ma"}
        aria-controls={menu() === "ma" ? menuId : undefined} onClick={event => open("ma", event.currentTarget)}>MA</button>
    </div>
    </div>
    <Show when={menu()}>
      <Portal>
        <div ref={popover} id={menuId} class="chart-tools-popover" role="dialog" aria-label={menu() === "interval" ? "Chart interval" : "Moving averages"}
          onPointerDown={event => event.stopPropagation()} onFocusIn={event => event.stopPropagation()}
          style={{ left: `${position().left}px`, top: `${position().top}px` }}>
          <Show when={menu() === "interval"} fallback={<>
            <div class="chart-tools-title">Moving averages</div>
            <For each={MA_PERIODS}>{period => <label class="chart-tools-ma">
              <span><i style={{ "background-color": MA_COLORS[period] }} />{period} MA</span>
              <input type="checkbox" checked={maEnabled()[period]} onChange={() => toggleMa(period)} />
            </label>}</For>
          </>}>
            <div class="chart-tools-title">Interval</div>
            <div class="chart-tools-intervals"><For each={CHART_RESOLUTIONS}>{resolution =>
              <button aria-pressed={props.resolution === resolution} onClick={() => { props.onResolutionChange(resolution); close(true); }}>
                {RESOLUTION_LABELS[resolution]}
              </button>
            }</For></div>
          </Show>
        </div>
      </Portal>
    </Show>
  </>;
};
export default ChartControls;
