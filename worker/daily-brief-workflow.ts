import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { londonDateKey } from '@tradingview/shared/brief';

import briefContract from '../docs/BRIEF.md';
import {
  NEWS_FEED_KEY,
  fetchHyperliquidMarks,
  loadPublicationContext,
  publishDailyBrief,
  researchDailyBrief,
  type DailyBriefEnv,
  type DailyBriefParams,
} from './daily-brief';
import type { NewsFeedSnapshot } from './news-pulse';

function requireSameLondonDay(day: string): void {
  // A late retry must never publish yesterday's research as today's brief.
  if (londonDateKey(new Date()) !== day) throw new NonRetryableError(`The London publication day ${day} has ended.`);
}

/**
 * One instance per London day. Completed steps are durable: a publication
 * retry reuses the validated edition instead of researching again.
 */
export class DailyBriefWorkflow extends WorkflowEntrypoint<DailyBriefEnv, DailyBriefParams> {
  async run(event: WorkflowEvent<DailyBriefParams>, step: WorkflowStep) {
    const { day } = event.payload;
    const context = await step.do('load publication context', async () => {
      requireSameLondonDay(day);
      return loadPublicationContext(this.env.DAILY_BRIEFS, day);
    });
    if (context.published) return { state: 'already-published', day };

    // Retries after 30, 60 and 120 minutes: four research attempts per day.
    const edition = await step.do(
      'research edition',
      { retries: { limit: 3, delay: '30 minutes', backoff: 'exponential' }, timeout: '45 minutes' },
      async () => {
        requireSameLondonDay(day);
        return researchDailyBrief({
          apiKey: this.env.ANTHROPIC_API_KEY,
          contract: briefContract,
          day,
          previousEdition: context.previousEdition,
          feed: await this.env.NEWS_RELAY_KV.get<NewsFeedSnapshot>(NEWS_FEED_KEY, 'json'),
          marks: await fetchHyperliquidMarks(),
        });
      },
    );

    await step.do(
      'publish edition',
      { retries: { limit: 6, delay: '1 minute', backoff: 'exponential' }, timeout: '2 minutes' },
      async () => {
        requireSameLondonDay(day);
        return publishDailyBrief(this.env.DAILY_BRIEFS, edition);
      },
    );
    return { state: 'published', day, title: edition.title };
  }
}
