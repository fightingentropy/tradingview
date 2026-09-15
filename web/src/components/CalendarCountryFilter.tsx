import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from "solid-js";
import { Portal } from "solid-js/web";
import { calendarCountries, countryCodeToFlag } from "../data/economicCalendar";

const CalendarCountryFilter: Component<{
  countries: readonly string[];
  onChange: (countries: string[]) => void;
}> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal({
    top: "0px",
    left: "0px",
    width: "280px",
  });
  let trigger: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;
  const allSelected = () => props.countries.length === calendarCountries.length;
  const selected = createMemo(() =>
    calendarCountries.filter((country) =>
      props.countries.includes(country.code),
    ),
  );
  const label = createMemo(() => {
    if (allSelected()) return "All countries";
    if (!selected().length) return "Choose countries";
    if (selected().length === 1) return selected()[0].name;
    if (selected().length === 2)
      return selected()
        .map((country) => (country.code === "GB" ? "UK" : country.code))
        .join(" + ");
    return `${selected().length} countries`;
  });
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger?.focus();
  };
  const placePanel = () => {
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const height = Math.min(390, window.innerHeight - 24);
    setPosition({
      top: `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - height - 12))}px`,
      left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
      width: `${width}px`,
    });
  };
  const openPanel = () => {
    placePanel();
    setOpen(true);
    queueMicrotask(() =>
      panel?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus(),
    );
  };
  const toggleCountry = (code: string) => {
    props.onChange(
      props.countries.includes(code)
        ? props.countries.filter((country) => country !== code)
        : [...props.countries, code],
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
    <div class="calendar-country-filter">
      <button
        ref={trigger}
        type="button"
        class="calendar-country-trigger"
        classList={{
          "has-selection": !allSelected() && props.countries.length > 0,
        }}
        aria-label={`Countries: ${
          allSelected()
            ? "All countries"
            : selected()
                .map((country) => country.name)
                .join(", ") || "None selected"
        }`}
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls="calendar-country-picker"
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
            id="calendar-country-picker"
            class="calendar-country-picker"
            role="dialog"
            aria-label="Select countries"
            style={position()}
          >
            <div class="calendar-country-picker-heading">
              <strong>Countries</strong>
              <span>{props.countries.length} selected</span>
            </div>
            <div class="calendar-country-actions">
              <button
                type="button"
                aria-label="Select all countries"
                disabled={allSelected()}
                onClick={() =>
                  props.onChange(
                    calendarCountries.map((country) => country.code),
                  )
                }
              >
                Select all
              </button>
              <button
                type="button"
                aria-label="Clear countries"
                disabled={props.countries.length === 0}
                onClick={() => props.onChange([])}
              >
                Clear
              </button>
            </div>
            <div
              class="calendar-country-options"
              role="group"
              aria-label="Countries"
            >
              <For each={calendarCountries}>
                {(country) => (
                  <label>
                    <input
                      type="checkbox"
                      checked={props.countries.includes(country.code)}
                      onChange={() => toggleCountry(country.code)}
                    />
                    <span aria-hidden="true">
                      {countryCodeToFlag(country.code)}
                    </span>
                    <span>{country.name}</span>
                  </label>
                )}
              </For>
            </div>
            <div class="calendar-country-picker-footer">
              <span>Choose any combination</span>
              <button type="button" onClick={() => close(true)}>
                Done
              </button>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
};

export default CalendarCountryFilter;
