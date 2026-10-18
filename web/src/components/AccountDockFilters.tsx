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
  <div class="account-filters">
    <Show when={accountTabHasSideFilter(props.tab)}>
      <select
        aria-label="Filter by side"
        class="account-select"
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
        class="account-select max-w-36"
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
