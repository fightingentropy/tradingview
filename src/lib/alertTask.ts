/**
 * Background price-alert check. iOS/Android wake the app on a system-chosen cadence
 * (a floor of ~15 min, often much longer on iOS and never on the simulator); each run
 * pulls a fresh market snapshot, fires a local notification for any armed alert that has
 * tripped, and marks it triggered. Foreground trips are handled live by AlertWatcher —
 * this covers the app being backgrounded or closed.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { loadAllMarkets } from '@/data/useMarkets';
import { formatPercent, formatPrice, formatProbability, priceDecimalsFor } from '@/lib/format';
import { notifyPriceAlert } from '@/lib/notifications';
import { useAlerts } from '@/store/alerts';
import { usePreferences } from '@/store/preferences';

/** Task name; also the BGTaskScheduler identifier on iOS. */
export const ALERT_TASK = 'price-alert-check';

/**
 * Evaluate every armed alert against a fresh market snapshot and notify on any trip.
 * Runs headless (no React) — reads and writes the persisted zustand stores directly.
 */
async function checkAlertsInBackground(): Promise<void> {
  const armed = useAlerts.getState().alerts.filter((a) => a.triggeredAt == null);
  if (armed.length === 0) return;

  const markets = await loadAllMarkets();
  const showOutcomeMarkets = usePreferences.getState().showOutcomeMarkets;
  const now = Date.now();
  for (const a of armed) {
    const inst = markets.byId[a.instrumentId];
    const price = markets.quotes[a.instrumentId]?.last;
    if (!inst || !a.anchorPrice || price == null) continue;
    // Turning the catalog off hides outcome routes and should also silence their
    // background notifications; the saved alert remains intact if re-enabled.
    if (inst.assetClass === 'outcome' && !showOutcomeMarkets) continue;

    const pct = ((price - a.anchorPrice) / a.anchorPrice) * 100;
    const hit =
      a.direction === 'both'
        ? Math.abs(pct) >= a.pct
        : a.direction === 'up'
          ? pct >= a.pct
          : pct <= -a.pct;
    if (!hit) continue;

    useAlerts.getState().markTriggered(a.id, price, now);
    const decimals = priceDecimalsFor(inst.priceDecimals, price);
    const displayedPrice =
      inst.assetClass === 'outcome' ? formatProbability(price) : formatPrice(price, decimals);
    await notifyPriceAlert(a.symbol, `${formatPercent(pct)} · ${displayedPrice}`, {
      instrumentId: a.instrumentId,
    });
  }
}

// Defined in module scope so the OS can invoke it after a cold relaunch. Importing this
// module (done at app startup via AlertWatcher) is what registers the definition.
TaskManager.defineTask(ALERT_TASK, async () => {
  try {
    await checkAlertsInBackground();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Start the periodic background check (the OS decides the actual cadence). */
export async function registerAlertTask(): Promise<void> {
  try {
    await BackgroundTask.registerTaskAsync(ALERT_TASK, { minimumInterval: 15 });
  } catch {
    /* background tasks unavailable here (e.g. iOS simulator) — foreground alerts still work */
  }
}

/** Stop the periodic background check. */
export async function unregisterAlertTask(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(ALERT_TASK)) {
      await BackgroundTask.unregisterTaskAsync(ALERT_TASK);
    }
  } catch {
    /* ignore */
  }
}
