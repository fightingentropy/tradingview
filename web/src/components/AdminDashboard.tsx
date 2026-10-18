import { Component, type JSX, Show } from "solid-js";
import { createConvexQuery } from "../lib/convex";
import { api } from "../../convex/_generated/api";
import {
  authReady,
  authUser,
  adminReady,
  isAdmin,
  isAuthenticated,
  login,
} from "../stores/auth";

const statsRef = api.admin.getDashboardStats;

const formatCount = (value?: number) => {
  if (!Number.isFinite(value ?? NaN)) return "--";
  return Number(value).toLocaleString("en-US");
};

const formatCompactUsd = (value?: number) => {
  if (!Number.isFinite(value ?? NaN)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(Number(value));
};

const formatTimestamp = (value?: number) => {
  if (!Number.isFinite(value ?? NaN)) return "--";
  return new Date(Number(value)).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const Notice: Component<{ title?: string; children: JSX.Element }> = (props) => (
  <div class="mx-auto mt-10 max-w-md rounded-xl border border-brand-hairline bg-brand-surface px-6 py-8 text-center sm:mt-20">
    <Show when={props.title}>
      <h1 class="text-lg font-semibold tracking-[-0.015em] text-brand-slate-100">
        {props.title}
      </h1>
    </Show>
    {props.children}
  </div>
);

const MetricCard: Component<{
  label: string;
  value: string;
  note: string;
}> = (props) => (
  <div class="rounded-xl border border-brand-hairline bg-brand-surface p-5">
    <p class="text-[13px] font-medium text-brand-slate-400">{props.label}</p>
    <p class="mt-2.5 text-[28px] font-semibold leading-none tracking-[-0.02em] text-brand-slate-100">
      {props.value}
    </p>
    <p class="mt-2.5 text-[13px] text-brand-slate-500">{props.note}</p>
  </div>
);

const AdminDashboard: Component = () => {
  const statsQuery = createConvexQuery(statsRef, () => (isAdmin() ? {} : null));

  const stats = () => statsQuery();

  return (
    <div class="h-full overflow-y-auto px-4 pb-10 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <Show
        when={authReady() && adminReady()}
        fallback={
          <p class="mt-10 text-center text-[15px] text-brand-slate-400 sm:mt-20">
            Checking admin access...
          </p>
        }
      >
        <Show
          when={isAuthenticated()}
          fallback={
            <Notice title="Admin dashboard locked">
              <p class="mt-2 text-[15px] text-brand-slate-400">
                Sign in with an admin account to view platform metrics.
              </p>
              <button
                class="mt-6 inline-flex h-11 items-center rounded-full bg-brand-accent px-6 text-sm font-semibold text-brand-screen transition duration-150 ease-[var(--ease-out)] hover:brightness-110 active:scale-[0.98] motion-reduce:transition-none sm:h-10"
                onClick={() => login()}
              >
                Sign in
              </button>
            </Notice>
          }
        >
          <Show
            when={isAdmin()}
            fallback={
              <Notice title="Admin access required">
                <p class="mt-2 text-[15px] text-brand-slate-400">
                  Your account ({authUser()?.email ?? "unknown"}) does not have
                  access to admin controls.
                </p>
              </Notice>
            }
          >
            <div class="mx-auto flex w-full max-w-6xl flex-col gap-8">
              <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
                <div>
                  <h1 class="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-brand-slate-100 sm:text-[32px]">
                    Platform Overview
                  </h1>
                  <p class="mt-1 text-[15px] text-brand-slate-400">
                    Real-time platform health and performance signals.
                  </p>
                </div>
                <div class="inline-flex h-9 items-center rounded-full bg-brand-raised px-4 text-[13px] text-brand-slate-400">
                  Admin: {authUser()?.email ?? "--"}
                </div>
              </div>

              <Show
                when={stats()}
                fallback={
                  <p class="py-10 text-center text-[15px] text-brand-slate-400">
                    Loading admin metrics...
                  </p>
                }
              >
                {(data) => (
                  <div class="flex flex-col gap-3">
                    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <MetricCard
                        label="Total Volume"
                        value={formatCompactUsd(data().totalVolume)}
                        note="All-time notional traded"
                      />
                      <MetricCard
                        label="Total Equity"
                        value={formatCompactUsd(data().totalEquity)}
                        note="Across all portfolios"
                      />
                      <MetricCard
                        label="Total Users"
                        value={formatCount(data().totalUsers)}
                        note="Registered accounts"
                      />
                      <MetricCard
                        label="Active Users"
                        value={formatCount(data().activeUsers24h)}
                        note="Seen in last 24 hours"
                      />
                    </div>

                    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <MetricCard
                        label="Total Trades"
                        value={formatCount(data().totalTrades)}
                        note="Executed orders"
                      />
                      <MetricCard
                        label="Open Orders"
                        value={formatCount(data().openOrders)}
                        note="Live limit orders"
                      />
                      <MetricCard
                        label="Open Positions"
                        value={formatCount(data().openPositions)}
                        note="Active positions"
                      />
                      <MetricCard
                        label="Total Fees"
                        value={formatCompactUsd(data().totalFees)}
                        note="Lifetime fees collected"
                      />
                    </div>

                    <div class="rounded-xl border border-brand-hairline bg-brand-surface p-5">
                      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                        <div>
                          <p class="text-[13px] font-medium text-brand-slate-400">
                            Aggregate PnL
                          </p>
                          <p
                            class={`mt-2.5 text-[32px] font-semibold leading-none tracking-[-0.02em] ${
                              data().totalPnl >= 0
                                ? "text-brand-green-400"
                                : "text-brand-red-400"
                            }`}
                          >
                            {formatCompactUsd(data().totalPnl)}
                          </p>
                        </div>
                        <div class="text-[13px] text-brand-slate-500">
                          Updated {formatTimestamp(data().updatedAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </Show>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default AdminDashboard;
