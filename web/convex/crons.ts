import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Poll Hyperliquid for authoritative server-side prices so the marketPrices
// oracle (convex/lib/prices.ts) stays within FRESHNESS_MS.
//
// The interval is deliberately a fraction of FRESHNESS_MS (currently 20s vs a
// 45s window) so a single missed/failed poll still leaves a fresh row rather
// rather than blocking settlement due to a stale price. Combined with the scoping in
// pollHyperliquidPrices (only symbols that are actually held/open get written),
// this is what keeps the poller under the Convex free-tier Database I/O limit.
// Dial it down only if you also widen FRESHNESS_MS to keep ~2 polls per window.
crons.interval(
  "poll-prices",
  { seconds: 20 },
  internal.prices.pollHyperliquidPrices,
  {},
);

// Housekeeping: drop marketPrices rows that are no longer being refreshed (i.e.
// symbols nobody holds or has open orders for anymore) so the table doesn't
// keep hundreds of stale rows from Hyperliquid's full universe. Infrequent and
// cheap; the oracle already ignores stale rows so this is purely lean-keeping.
crons.interval(
  "prune-stale-prices",
  { hours: 1 },
  internal.prices.pruneStalePrices,
  {},
);

crons.interval(
  "prune-expired-auth-state",
  { minutes: 5 },
  internal.authData.pruneExpiredAuthState,
  {},
);

export default crons;
