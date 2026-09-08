import { Component, For, Show } from "solid-js";
import {
  hyperliquidAccountTransfers,
  hyperliquidInterestPayments,
  hyperliquidPortfolioRefreshError,
  hyperliquidPortfolioRefreshPending,
  isHyperliquidExecution,
} from "../stores/hyperliquidExecution";
import {
  downloadAccountCsv,
  formatAccountSize,
  formatAccountTime,
} from "./accountDock";

const emptyMessage = (label: string) => {
  if (!isHyperliquidExecution()) return `No ${label.toLowerCase()} in paper mode`;
  if (hyperliquidPortfolioRefreshPending()) {
    return `Loading ${label.toLowerCase()}…`;
  }
  return hyperliquidPortfolioRefreshError() ?? `No ${label.toLowerCase()}`;
};

const PortfolioNotice: Component = () => (
  <Show when={hyperliquidPortfolioRefreshError()}>
    {(message) => (
      <div class="border-t border-brand-border px-3 py-2 text-xs text-brand-red-400">
        {message()}
      </div>
    )}
  </Show>
);

const formatTokenAmount = (amount: number, asset: string, signed = false) => {
  const sign = signed ? (amount > 0 ? "+" : amount < 0 ? "-" : "") : "";
  return `${sign}${formatAccountSize(Math.abs(amount))} ${asset}`;
};

export const InterestHistoryTable: Component = () => {
  const rows = hyperliquidInterestPayments;
  const columns = ["Time", "Asset", "Paid", "Earned"];
  const exportCsv = () =>
    downloadAccountCsv(
      `trade-xyz-interest-${new Date().toISOString().slice(0, 10)}.csv`,
      columns,
      rows().map((payment) => [
        formatAccountTime(payment.time),
        payment.asset,
        payment.paid,
        payment.earned,
      ]),
    );

  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[680px]">
        <thead>
          <tr class="border-b border-brand-border">
            <For each={columns}>
              {(column) => (
                <th class="whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium text-brand-slate-400">
                  {column}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <Show
            when={rows().length > 0}
            fallback={
              <tr>
                <td class="px-3 py-3 text-sm text-brand-slate-400" colSpan={4}>
                  {emptyMessage("Interest history")}
                </td>
              </tr>
            }
          >
            <For each={rows()}>
              {(payment) => (
                <tr class="border-b border-brand-border/40">
                  <td class="whitespace-nowrap px-3 py-2 font-mono text-sm text-brand-slate-400">
                    {formatAccountTime(payment.time)}
                  </td>
                  <td class="px-3 py-2 text-sm font-semibold">
                    {payment.asset}
                  </td>
                  <td class="px-3 py-2 font-mono text-sm text-brand-red-400">
                    {payment.paid > 0
                      ? formatTokenAmount(payment.paid, payment.asset)
                      : "--"}
                  </td>
                  <td class="px-3 py-2 font-mono text-sm text-brand-green-400">
                    {payment.earned > 0
                      ? formatTokenAmount(payment.earned, payment.asset)
                      : "--"}
                  </td>
                </tr>
              )}
            </For>
          </Show>
        </tbody>
      </table>
      <div class="flex justify-end border-t border-brand-border px-3 py-2">
        <button
          type="button"
          class="text-xs font-medium text-brand-slate-300 hover:text-slate-100 disabled:opacity-50"
          disabled={rows().length === 0}
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>
      <Show when={rows().length > 0}>
        <PortfolioNotice />
      </Show>
    </div>
  );
};

export const TransfersHistoryTable: Component = () => {
  const rows = hyperliquidAccountTransfers;
  const columns = [
    "Time",
    "Status",
    "Action",
    "Source",
    "Destination",
    "Account Value Change",
    "Fee",
  ];
  const exportCsv = () =>
    downloadAccountCsv(
      `trade-xyz-transfers-${new Date().toISOString().slice(0, 10)}.csv`,
      columns,
      rows().map((transfer) => [
        formatAccountTime(transfer.time),
        transfer.status,
        transfer.action,
        transfer.source,
        transfer.destination,
        transfer.amount,
        transfer.fee ?? 0,
      ]),
    );

  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[1120px]">
        <thead>
          <tr class="border-b border-brand-border">
            <For each={columns}>
              {(column) => (
                <th class="whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium text-brand-slate-400">
                  {column}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <Show
            when={rows().length > 0}
            fallback={
              <tr>
                <td class="px-3 py-3 text-sm text-brand-slate-400" colSpan={7}>
                  {emptyMessage("Deposits and withdrawals")}
                </td>
              </tr>
            }
          >
            <For each={rows()}>
              {(transfer) => (
                <tr class="border-b border-brand-border/40">
                  <td class="whitespace-nowrap px-3 py-2 font-mono text-sm text-brand-slate-400">
                    {formatAccountTime(transfer.time)}
                  </td>
                  <td class="px-3 py-2 text-sm text-brand-green-400">
                    {transfer.status}
                  </td>
                  <td class="px-3 py-2 text-sm font-medium">
                    {transfer.action}
                  </td>
                  <td class="px-3 py-2 font-mono text-sm text-brand-slate-300">
                    {transfer.source}
                  </td>
                  <td class="px-3 py-2 font-mono text-sm text-brand-slate-300">
                    {transfer.destination}
                  </td>
                  <td
                    class={`px-3 py-2 font-mono text-sm ${
                      transfer.amount >= 0
                        ? "text-brand-green-400"
                        : "text-brand-red-400"
                    }`}
                  >
                    {formatTokenAmount(
                      transfer.amount,
                      transfer.asset,
                      true,
                    )}
                  </td>
                  <td class="px-3 py-2 font-mono text-sm text-brand-slate-300">
                    {transfer.fee && transfer.fee > 0
                      ? formatTokenAmount(
                          transfer.fee,
                          transfer.feeAsset ?? transfer.asset,
                        )
                      : "--"}
                  </td>
                </tr>
              )}
            </For>
          </Show>
        </tbody>
      </table>
      <div class="flex justify-end border-t border-brand-border px-3 py-2">
        <button
          type="button"
          class="text-xs font-medium text-brand-slate-300 hover:text-slate-100 disabled:opacity-50"
          disabled={rows().length === 0}
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>
      <Show when={rows().length > 0}>
        <PortfolioNotice />
      </Show>
    </div>
  );
};
