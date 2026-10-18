import webApp from './web-app.mjs';
import { handleDailyBriefRunRequest, type DailyBriefEnv } from './daily-brief';

export { DailyBriefWorkflow } from './daily-brief-workflow';

interface WebEnv extends DailyBriefEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env): Promise<Response> {
    // The daily brief runs only on demand: the iPhone app or the admin-only Convex action starts it.
    if (new URL(request.url).pathname === '/api/daily-briefs/run') return handleDailyBriefRunRequest(request, env);
    return webApp.fetch(request, env);
  },
} satisfies ExportedHandler<WebEnv>;
