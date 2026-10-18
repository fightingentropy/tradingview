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
      <div class="border-t border-brand-hairline px-5 py-3 text-[13px] text-brand-red-400">
        {message()}
      </div>
    )}
  </Show>
);

const formatTokenAmount = (amount: number, asset: string, signed = false) => {
  const sign = signed ? (amount > 0 ? "+" : amount < 0 ? "-" : "") : "";
  return `${sign}${formatAccountSize(Math.abs(amount))} ${asset}`;
};

const ExportFooter: Component<{ disabled: boolean; onExport: () => void }> = (
  props,
) => (
  <div class="flex justify-end border-t border-brand-hairline px-3 py-1.5">
    <button
      type="button"
      class="pf-ghost"
      disabled={props.disabled}
      onClick={props.onExport}
    >
      Export CSV
    </button>
  </div>
);

export const InterestHistoryTable: Component = () => {
  const rows = hyperliquidInterestPayments;
  const columns = ["Time", "Asset", "Paid", "Earned"];
  const numeric = new Set(["Paid", "Earned"]);
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
      <table class="pf-table min-w-[560px]">
        <thead>
          <tr>
            <For each={columns}>
              {(column) => (
                <th classList={{ "pf-num": numeric.has(column) }}>{column}</th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <Show
            when={rows().length > 0}
            fallback={
              <tr>
                <td class="pf-empty" colSpan={4}>
                  {emptyMessage("Interest history")}
                </td>
              </tr>
            }
          >
            <For each={rows()}>
              {(payment) => (
                <tr>
                  <td class="whitespace-nowrap font-mono text-brand-slate-400">
                    {formatAccountTime(payment.time)}
                  </td>
                  <td class="font-medium text-brand-slate-100">
                    {payment.asset}
                  </td>
                  <td class="pf-num font-mono text-brand-red-400">
                    {payment.paid > 0
                      ? formatTokenAmount(payment.paid, payment.asset)
                      : "--"}
                  </td>
                  <td class="pf-num font-mono text-brand-green-400">
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
      <ExportFooter disabled={rows().length === 0} onExport={exportCsv} />
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
  const numeric = new Set(["Account Value Change", "Fee"]);
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
      <table class="pf-table min-w-[1040px]">
        <thead>
          <tr>
            <For each={columns}>
              {(column) => (
                <th classList={{ "pf-num": numeric.has(column) }}>{column}</th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <Show
            when={rows().length > 0}
            fallback={
              <tr>
                <td class="pf-empty" colSpan={7}>
                  {emptyMessage("Deposits and withdrawals")}
                </td>
              </tr>
            }
          >
            <For each={rows()}>
              {(transfer) => (
                <tr>
                  <td class="whitespace-nowrap font-mono text-brand-slate-400">
                    {formatAccountTime(transfer.time)}
                  </td>
                  <td class="text-brand-green-400">{transfer.status}</td>
                  <td class="font-medium text-brand-slate-100">
                    {transfer.action}
                  </td>
                  <td class="font-mono text-brand-slate-400">
                    {transfer.source}
                  </td>
                  <td class="font-mono text-brand-slate-400">
                    {transfer.destination}
                  </td>
                  <td
                    class={`pf-num font-mono ${
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
                  <td class="pf-num font-mono text-brand-slate-400">
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
      <ExportFooter disabled={rows().length === 0} onExport={exportCsv} />
      <Show when={rows().length > 0}>
        <PortfolioNotice />
      </Show>
    </div>
  );
};
