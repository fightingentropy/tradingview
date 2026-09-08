import { Component, Show } from "solid-js";
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

const AdminDashboard: Component = () => {
  const statsQuery = createConvexQuery(statsRef, () => (isAdmin() ? {} : null));

  const stats = () => statsQuery();

  return (
    <div class="h-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <Show
        when={authReady() && adminReady()}
        fallback={
          <div class="rounded-xl border border-brand-border bg-brand-surface p-6 text-sm text-brand-slate-400">
            Checking admin access...
          </div>
        }
      >
        <Show
          when={isAuthenticated()}
          fallback={
            <div class="rounded-xl border border-brand-border bg-brand-surface p-6 text-sm text-brand-slate-400">
              <div class="text-base font-semibold text-slate-100">
                Admin dashboard locked
              </div>
              <p class="mt-2 text-sm text-brand-slate-500">
                Sign in with an admin account to view platform metrics.
              </p>
              <button
                class="mt-4 inline-flex items-center rounded-lg bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-screen"
                onClick={() => login()}
              >
                Sign in
              </button>
            </div>
          }
        >
          <Show
            when={isAdmin()}
            fallback={
              <div class="rounded-xl border border-brand-border bg-brand-surface p-6 text-sm text-brand-slate-400">
                <div class="text-base font-semibold text-slate-100">
                  Admin access required
                </div>
                <p class="mt-2 text-sm text-brand-slate-500">
                  Your account ({authUser()?.email ?? "unknown"}) does not have
                  access to admin controls.
                </p>
              </div>
            }
          >
            <div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 class="text-2xl font-semibold text-slate-100">
                    Platform Overview
                  </h1>
                  <p class="mt-1 text-sm text-brand-slate-500">
                    Real-time platform health and performance signals.
                  </p>
                </div>
                <div class="rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-xs text-brand-slate-400">
                  Admin: {authUser()?.email ?? "--"}
                </div>
              </div>

              <Show
                when={stats()}
                fallback={
                  <div class="rounded-xl border border-brand-border bg-brand-surface p-6 text-sm text-brand-slate-400">
                    Loading admin metrics...
                  </div>
                }
              >
                {(data) => (
                  <div class="flex flex-col gap-6">
                    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <div class="rounded-xl border border-brand-border bg-brand-surface p-4">
                        <p class="text-xs uppercase tracking-wide text-brand-slate-500">
                          Total Volume
                        </p>
                        <p class="mt-2 text-2xl font-semibold text-slate-100">
                          {formatCompactUsd(data().totalVolume)}
                        </p>
                        <p class="mt-1 text-xs text-brand-slate-500">
                          All-time notional traded
                        </p>
                      </div>
                      <div class="rounded-xl border border-brand-border bg-brand-surface p-4">
                        <p class="text-xs uppercase tracking-wide text-brand-slate-500">
                          Total Equity
                        </p>
                        <p class="mt-2 text-2xl font-semibold text-slate-100">
                          {formatCompactUsd(data().totalEquity)}
                        </p>
                        <p class="mt-1 text-xs text-brand-slate-500">
                          Across all portfolios
                        </p>
                      </div>
                      <div class="rounded-xl border border-brand-border bg-brand-surface p-4">
                        <p class="text-xs uppercase tracking-wide text-brand-slate-500">
                          Total Users
                        </p>
                        <p class="mt-2 text-2xl font-semibold text-slate-100">
                          {formatCount(data().totalUsers)}
                        </p>
                        <p class="mt-1 text-xs text-brand-slate-500">
                          Registered accounts
                        </p>
                      </div>
                      <div class="rounded-xl border border-brand-border bg-brand-surface p-4">
                        <p class="text-xs uppercase tracking-wide text-brand-slate-500">
                          Active Users
                        </p>
                        <p class="mt-2 text-2xl font-semibold text-slate-100">
                          {formatCount(data().activeUsers24h)}
                        </p>
                        <p class="mt-1 text-xs text-brand-slate-500">
                          Seen in last 24 hours
                        </p>
                      </div>
                    </div>

                    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <div class="rounded-xl border border-brand-border bg-brand-surface p-4">
                        <p class="text-xs uppercase tracking-wide text-brand-slate-500">
                          Total Trades
                        </p>
                        <p class="mt-2 text-2xl font-semibold text-slate-100">
                          {formatCount(data().totalTrades)}
                        </p>
                        <p class="mt-1 text-xs text-brand-slate-500">
                          Executed orders
                        </p>
                      </div>
                      <div class="rounded-xl border border-brand-border bg-brand-surface p-4">
                        <p class="text-xs uppercase tracking-wide text-brand-slate-500">
                          Open Orders
                        </p>
                        <p class="mt-2 text-2xl font-semibold text-slate-100">
                          {formatCount(data().openOrders)}
                        </p>
                        <p class="mt-1 text-xs text-brand-slate-500">
                          Live limit orders
                        </p>
                      </div>
                      <div class="rounded-xl border border-brand-border bg-brand-surface p-4">
                        <p class="text-xs uppercase tracking-wide text-brand-slate-500">
                          Open Positions
                        </p>
                        <p class="mt-2 text-2xl font-semibold text-slate-100">
                          {formatCount(data().openPositions)}
                        </p>
                        <p class="mt-1 text-xs text-brand-slate-500">
                          Active positions
                        </p>
                      </div>
                      <div class="rounded-xl border border-brand-border bg-brand-surface p-4">
                        <p class="text-xs uppercase tracking-wide text-brand-slate-500">
                          Total Fees
                        </p>
                        <p class="mt-2 text-2xl font-semibold text-slate-100">
                          {formatCompactUsd(data().totalFees)}
                        </p>
                        <p class="mt-1 text-xs text-brand-slate-500">
                          Lifetime fees collected
                        </p>
                      </div>
                    </div>

                    <div class="rounded-xl border border-brand-border bg-brand-surface p-4">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p class="text-xs uppercase tracking-wide text-brand-slate-500">
                            Aggregate PnL
                          </p>
                          <p
                            class={`mt-2 text-2xl font-semibold ${
                              data().totalPnl >= 0
                                ? "text-brand-green-400"
                                : "text-brand-red-400"
                            }`}
                          >
                            {formatCompactUsd(data().totalPnl)}
                          </p>
                        </div>
                        <div class="text-xs text-brand-slate-500">
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
