import webApp from './web-app.mjs';
import { scheduleDailyBrief, type DailyBriefEnv } from './daily-brief';

export { DailyBriefWorkflow } from './daily-brief-workflow';

interface WebEnv extends DailyBriefEnv {
  ASSETS: Fetcher;
}

export default {
  fetch: webApp.fetch,
  async scheduled(controller, env): Promise<void> {
    const result = await scheduleDailyBrief(env, new Date(controller.scheduledTime));
    console.log(JSON.stringify({ event: 'daily_brief_schedule', result }));
  },
} satisfies ExportedHandler<WebEnv>;
