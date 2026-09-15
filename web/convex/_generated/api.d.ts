/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as authData from "../authData.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as jwks from "../jwks.js";
import type * as lib_accounting from "../lib/accounting.js";
import type * as lib_admin from "../lib/admin.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_oracle from "../lib/oracle.js";
import type * as lib_portfolio from "../lib/portfolio.js";
import type * as lib_prices from "../lib/prices.js";
import type * as lib_stats from "../lib/stats.js";
import type * as migrations from "../migrations.js";
import type * as orders from "../orders.js";
import type * as portfolio from "../portfolio.js";
import type * as portfolioMargin from "../portfolioMargin.js";
import type * as prices from "../prices.js";
import type * as spot from "../spot.js";
import type * as trades from "../trades.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  authData: typeof authData;
  crons: typeof crons;
  http: typeof http;
  jwks: typeof jwks;
  "lib/accounting": typeof lib_accounting;
  "lib/admin": typeof lib_admin;
  "lib/auth": typeof lib_auth;
  "lib/idempotency": typeof lib_idempotency;
  "lib/oracle": typeof lib_oracle;
  "lib/portfolio": typeof lib_portfolio;
  "lib/prices": typeof lib_prices;
  "lib/stats": typeof lib_stats;
  migrations: typeof migrations;
  orders: typeof orders;
  portfolio: typeof portfolio;
  portfolioMargin: typeof portfolioMargin;
  prices: typeof prices;
  spot: typeof spot;
  trades: typeof trades;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
