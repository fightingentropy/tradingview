import webApp from './web-app.mjs';
import { handleDailyBriefRunRequest, type DailyBriefEnv } from './daily-brief';
import { runEarningsSummaries, type EarningsSummaryEnv } from './earnings-summaries';

export { DailyBriefWorkflow } from './daily-brief-workflow';

interface WebEnv extends DailyBriefEnv, EarningsSummaryEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env): Promise<Response> {
    // The daily brief runs only on demand: the iPhone app or the admin-only Convex action starts it.
    if (new URL(request.url).pathname === '/api/daily-briefs/run') return handleDailyBriefRunRequest(request, env);
    return webApp.fetch(request, env);
  },
  // Every 15 minutes: summarise newly reported $10B+ earnings with Sonnet.
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(runEarningsSummaries(env).then(
      (result) => console.log(JSON.stringify({ event: 'earnings_summaries', ...result })),
      (error) => console.error(JSON.stringify({ event: 'earnings_summaries_failed', error: error instanceof Error ? error.message : String(error) })),
    ));
  },
} satisfies ExportedHandler<WebEnv>;
