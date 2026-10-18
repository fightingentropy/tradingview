import { bindings, defineConfig, defineWorker, exports } from "cf/config";

// --mode web selects the web app; the default is the existing news relay.
export default defineConfig((ctx) => {
  if (ctx.mode && !["web", "relay"].includes(ctx.mode))
    throw new Error("Use --mode web or --mode relay");
  return ctx.mode === "web"
    ? {
        worker: defineWorker({
          name: "tradingview-web",
          compatibilityDate: "2026-08-06",
          compatibilityFlags: ["nodejs_compat"],
          entrypoint: "worker/web-app.mjs",
          workersDev: true,
          previewUrls: false,
          observability: {
            enabled: true,
          },
          assets: {
            htmlHandling: "none",
            notFoundHandling: "single-page-application",
            runWorkerFirst: [
              "/api/*",
              "/account",
              "/account/",
              "/economic-calendar",
              "/economic-calendar/",
              "/news",
              "/news/",
              "/markets",
              "/markets/",
              "/symbol/*",
            ],
          },
          domains: ["trade.erlin.org"],
          env: {
            DAILY_BRIEFS: bindings.kv({
              id: "a61b65da42314097857d47cc813a6d82",
            }),
            ASSETS: bindings.assets(),
          },
        }),
      }
    : {
        worker: defineWorker({
          name: "tradingview-news-relay",
          compatibilityDate: "2026-07-10",
          compatibilityFlags: ["nodejs_compat"],
          entrypoint: "worker/index.ts",
          exports: {
            MacMiniAlertRelay: exports.durableObject({ storage: "sqlite" }),
          },
          workersDev: true,
          previewUrls: false,
          observability: {
            enabled: true,
            headSamplingRate: 1,
          },
          env: {
            APP_ACCESS_TOKEN: bindings.secret(),
            BRIDGE_SECRET: bindings.secret(),
            NEWS_RELAY_KV: bindings.kv({
              id: "757a63280fc54505ad9c6950b37df7b6",
            }),
            PRICE_ALERTS: bindings.durableObject({
              worker: "tradingview-news-relay",
              exportName: "MacMiniAlertRelay",
            }),
          },
        }),
      };
});
