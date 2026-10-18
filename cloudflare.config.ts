import { bindings, defineConfig, defineWorker, exports, triggers } from "cf/config";

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
          entrypoint: "worker/web-entry.ts",
          exports: {
            DailyBriefWorkflow: exports.workflow({ name: "tradingview-daily-brief" }),
          },
          // Hourly, so 08:00 Europe/London is hit in both GMT and BST.
          triggers: [triggers.scheduled({ schedule: "0 * * * *" })],
          // Workflow steps stream long Claude research turns.
          limits: { cpuMs: 300_000 },
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
            // Read-only here: the relay feed is the brief's CT, Telegram, Digg and Paste Trade evidence.
            NEWS_RELAY_KV: bindings.kv({
              id: "757a63280fc54505ad9c6950b37df7b6",
            }),
            DAILY_BRIEF_WORKFLOW: bindings.workflow({
              name: "tradingview-daily-brief",
              worker: "tradingview-web",
              exportName: "DailyBriefWorkflow",
            }),
            ANTHROPIC_API_KEY: bindings.secret(),
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
            NewsPulseWorkflow: exports.workflow({ name: "tradingview-news-pulse" }),
          },
          // Workflow steps stream Claude turns with web verification.
          limits: { cpuMs: 300_000 },
          // Weekday checks around the 09:35 and 16:05 New York pulse slots, in UTC
          // for both daylight-saving offsets; the Worker gates on the New York clock.
          triggers: [triggers.scheduled({ schedule: "*/5 13-21 * * 1-5" })],
          workersDev: true,
          previewUrls: false,
          observability: {
            enabled: true,
            headSamplingRate: 1,
          },
          env: {
            APP_ACCESS_TOKEN: bindings.secret(),
            BRIDGE_SECRET: bindings.secret(),
            ANTHROPIC_API_KEY: bindings.secret(),
            NEWS_RELAY_KV: bindings.kv({
              id: "757a63280fc54505ad9c6950b37df7b6",
            }),
            PRICE_ALERTS: bindings.durableObject({
              worker: "tradingview-news-relay",
              exportName: "MacMiniAlertRelay",
            }),
            NEWS_PULSE_WORKFLOW: bindings.workflow({
              name: "tradingview-news-pulse",
              worker: "tradingview-news-relay",
              exportName: "NewsPulseWorkflow",
            }),
          },
        }),
      };
});
