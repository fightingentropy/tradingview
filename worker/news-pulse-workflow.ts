import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

import {
  EXECUTIVE_SUMMARY_KEY,
  NEWS_FEED_KEY,
  executiveSummaryScheduleSlot,
  generateExecutiveSummary,
  selectExecutiveSummaryItems,
  shouldGenerateExecutiveSummary,
  type NewsExecutiveSummary,
  type NewsFeedSnapshot,
  type NewsPulseEnv,
  type NewsPulseParams,
} from './news-pulse';

/**
 * One instance per New York slot. Generation may take several minutes with
 * web verification, which a cron invocation's 15-minute limit cannot cover.
 */
export class NewsPulseWorkflow extends WorkflowEntrypoint<NewsPulseEnv, NewsPulseParams> {
  async run(event: WorkflowEvent<NewsPulseParams>, step: WorkflowStep) {
    const { slot } = event.payload;
    // Three attempts, five minutes apart, all inside the slot.
    const summary = await step.do(
      'generate pulse',
      { retries: { limit: 2, delay: '5 minutes', backoff: 'constant' }, timeout: '30 minutes' },
      async (): Promise<NewsExecutiveSummary | null> => {
        const now = Date.now();
        if (executiveSummaryScheduleSlot(now) !== slot) throw new NonRetryableError(`The pulse slot ${slot} has ended.`);
        const [snapshot, stored] = await Promise.all([
          this.env.NEWS_RELAY_KV.get<NewsFeedSnapshot>(NEWS_FEED_KEY, 'json'),
          this.env.NEWS_RELAY_KV.get<NewsExecutiveSummary>(EXECUTIVE_SUMMARY_KEY, 'json'),
        ]);
        const previousSummary = stored ?? snapshot?.executiveSummary ?? undefined;
        if (!shouldGenerateExecutiveSummary(previousSummary, now)) return null;
        if (!snapshot) throw new Error('The news feed snapshot is unavailable');
        const items = selectExecutiveSummaryItems(snapshot.items, now);
        if (items.length === 0) throw new NonRetryableError('The news feed has no recent items');
        return generateExecutiveSummary({ apiKey: this.env.ANTHROPIC_API_KEY, items, previousSummary, now });
      },
    );
    if (!summary) return { state: 'already-generated', slot };

    await step.do(
      'store pulse',
      { retries: { limit: 5, delay: '30 seconds', backoff: 'exponential' }, timeout: '1 minute' },
      async () => { await this.env.NEWS_RELAY_KV.put(EXECUTIVE_SUMMARY_KEY, JSON.stringify(summary)); },
    );
    return { state: 'generated', slot, headline: summary.headline };
  }
}
