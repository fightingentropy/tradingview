import { For, Show, createEffect, type JSX } from "solid-js";

type CalendarFilterOption<T extends string> = {
  value: T;
  label: string;
  icon?: JSX.Element;
};

type CalendarFilterProps<T extends string> = {
  id: string;
  label: string;
  options: readonly CalendarFilterOption<T>[];
  values: readonly T[];
  onChange: (values: T[]) => void;
};

function CalendarFilter<T extends string>(props: CalendarFilterProps<T>) {
  let allCheckbox: HTMLInputElement | undefined;
  const allSelected = () =>
    props.options.every((option) => props.values.includes(option.value));
  const hasSelection = () => props.values.length > 0;

  createEffect(() => {
    if (allCheckbox)
      allCheckbox.indeterminate = hasSelection() && !allSelected();
  });

  const toggle = (value: T) => {
    props.onChange(
      props.values.includes(value)
        ? props.values.filter((item) => item !== value)
        : [...props.values, value],
    );
  };

  return (
    <section class="calendar-filter-group" data-filter={props.id}>
      <div class="calendar-filter-group-heading">
        <h3 id={`calendar-filter-${props.id}`}>{props.label}</h3>
        <button
          type="button"
          aria-label={`Clear ${props.label.toLowerCase()}`}
          disabled={!hasSelection()}
          onClick={() => props.onChange([])}
        >
          Clear
        </button>
      </div>
      <div
        class="calendar-filter-options"
        role="group"
        aria-labelledby={`calendar-filter-${props.id}`}
      >
        <label class="calendar-filter-all">
          <span>All</span>
          <input
            ref={allCheckbox}
            type="checkbox"
            aria-label={`Select all ${props.label.toLowerCase()}`}
            checked={allSelected()}
            onChange={(event) =>
              props.onChange(
                event.currentTarget.checked
                  ? props.options.map((option) => option.value)
                  : [],
              )
            }
          />
        </label>
        <For each={props.options}>
          {(option) => (
            <label>
              <Show when={option.icon}>
                <span class="calendar-filter-option-icon" aria-hidden="true">
                  {option.icon}
                </span>
              </Show>
              <span>{option.label}</span>
              <input
                type="checkbox"
                checked={props.values.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
            </label>
          )}
        </For>
      </div>
    </section>
  );
}

export default CalendarFilter;
