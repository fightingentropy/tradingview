import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { Portal } from "solid-js/web";

export type CalendarFilterOption<T extends string> = {
  value: T;
  label: string;
  icon?: string;
  shortLabel?: string;
};

type CalendarFilterProps<T extends string> = {
  id: string;
  label: string;
  allLabel: string;
  emptyLabel: string;
  options: readonly CalendarFilterOption<T>[];
  values: readonly T[];
  onChange: (values: T[]) => void;
  summary?: (selected: readonly CalendarFilterOption<T>[]) => string;
};

function CalendarFilter<T extends string>(props: CalendarFilterProps<T>) {
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal({
    top: "0px",
    left: "0px",
    width: "280px",
  });
  let trigger: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;
  const selected = createMemo(() =>
    props.options.filter((option) => props.values.includes(option.value)),
  );
  const allSelected = () => selected().length === props.options.length;
  const label = createMemo(() => {
    if (allSelected()) return props.allLabel;
    if (!selected().length) return props.emptyLabel;
    if (props.summary) return props.summary(selected());
    if (selected().length === 1) return selected()[0].label;
    return `${selected().length} ${props.label.toLowerCase()}`;
  });
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger?.focus();
  };
  const placePanel = () => {
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const height =
      panel?.getBoundingClientRect().height ??
      Math.min(132 + props.options.length * 34, 390, window.innerHeight - 24);
    setPosition({
      top: `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - height - 12))}px`,
      left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
      width: `${width}px`,
    });
  };
  const openPanel = () => {
    placePanel();
    setOpen(true);
    queueMicrotask(() => {
      placePanel();
      panel?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
    });
  };
  const toggle = (value: T) => {
    props.onChange(
      props.values.includes(value)
        ? props.values.filter((item) => item !== value)
        : [...props.values, value],
    );
  };

  createEffect(() => {
    if (!open()) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !panel?.contains(event.target) &&
        !trigger?.contains(event.target)
      )
        close();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", placePanel);
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", placePanel);
    });
  });

  return (
    <div class="calendar-multi-filter" data-filter={props.id}>
      <button
        ref={trigger}
        type="button"
        class="calendar-filter-trigger"
        classList={{
          "has-selection": !allSelected(),
        }}
        aria-label={`${props.label}: ${
          allSelected()
            ? props.allLabel
            : selected()
                .map((option) => option.label)
                .join(", ") || "None selected"
        }`}
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={`calendar-${props.id}-picker`}
        onClick={() => (open() ? close() : openPanel())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openPanel();
          }
        }}
      >
        <span>{label()}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={panel}
            id={`calendar-${props.id}-picker`}
            class="calendar-filter-picker"
            role="dialog"
            aria-label={`Select ${props.label.toLowerCase()}`}
            style={position()}
          >
            <div class="calendar-filter-picker-heading">
              <strong>{props.label}</strong>
              <span>{selected().length} selected</span>
            </div>
            <div class="calendar-filter-actions">
              <button
                type="button"
                aria-label={`Select all ${props.label.toLowerCase()}`}
                disabled={allSelected()}
                onClick={() =>
                  props.onChange(props.options.map((option) => option.value))
                }
              >
                Select all
              </button>
              <button
                type="button"
                aria-label={`Clear ${props.label.toLowerCase()}`}
                disabled={selected().length === 0}
                onClick={() => props.onChange([])}
              >
                Clear
              </button>
            </div>
            <div
              class="calendar-filter-options"
              role="group"
              aria-label={props.label}
            >
              <For each={props.options}>
                {(option) => (
                  <label>
                    <input
                      type="checkbox"
                      checked={props.values.includes(option.value)}
                      onChange={() => toggle(option.value)}
                    />
                    <Show when={option.icon}>
                      <span
                        class="calendar-filter-option-icon"
                        aria-hidden="true"
                      >
                        {option.icon}
                      </span>
                    </Show>
                    <span>{option.label}</span>
                  </label>
                )}
              </For>
            </div>
            <div class="calendar-filter-picker-footer">
              <button type="button" onClick={() => close(true)}>
                Done
              </button>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

export default CalendarFilter;
