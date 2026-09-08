import { Component, For, Show } from "solid-js";
import {
  type AccountSideFilter,
  type AccountTab,
  accountSideOptions,
  accountTabHasMarketFilter,
  accountTabHasSideFilter,
} from "./accountDock";

const AccountDockFilters: Component<{
  tab: AccountTab;
  side: AccountSideFilter;
  market: string;
  markets: string[];
  onSideChange: (side: AccountSideFilter) => void;
  onMarketChange: (market: string) => void;
}> = (props) => (
  <div class="flex shrink-0 items-center gap-1.5 border-l border-brand-border px-2">
    <Show when={accountTabHasSideFilter(props.tab)}>
      <select
        aria-label="Filter by side"
        class="h-8 rounded border border-transparent bg-transparent px-2 text-xs font-medium text-brand-slate-300 outline-none hover:border-brand-border hover:text-slate-100 focus:border-brand-slate-500"
        value={props.side}
        onInput={(event) =>
          props.onSideChange(event.currentTarget.value as AccountSideFilter)
        }
      >
        <For each={accountSideOptions(props.tab)}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </select>
    </Show>
    <Show when={accountTabHasMarketFilter(props.tab)}>
      <select
        aria-label="Filter by market"
        class="h-8 max-w-36 rounded border border-transparent bg-transparent px-2 text-xs font-medium text-brand-slate-300 outline-none hover:border-brand-border hover:text-slate-100 focus:border-brand-slate-500"
        value={props.market}
        onInput={(event) => props.onMarketChange(event.currentTarget.value)}
      >
        <option value="all">Market</option>
        <For each={props.markets}>
          {(market) => <option value={market}>{market}</option>}
        </For>
      </select>
    </Show>
  </div>
);

export default AccountDockFilters;
