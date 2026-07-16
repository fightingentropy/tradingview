import { useEffect, useMemo, useRef } from 'react';

import type { Instrument } from '@/domain/types';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useAllMarkets } from '@/data/useMarkets';
import { registerAlertTask, unregisterAlertTask } from '@/lib/alertTask';
import { formatPercent, formatPrice, formatProbability, priceDecimalsFor } from '@/lib/format';
import { configureNotifications, notifyPriceAlert } from '@/lib/notifications';
import { useAlertFeed } from '@/store/alertFeed';
import { useAlerts } from '@/store/alerts';
import { useLivePrices } from '@/store/livePrices';
import { usePreferences } from '@/store/preferences';

/**
 * App-wide alert engine. Mounted once at the root: it opens live price streams
 * for every instrument with an armed alert (so alerts fire even when that symbol
 * isn't otherwise on screen) and evaluates each tick, firing an in-app toast and
 * marking the alert triggered when its price-move threshold is crossed.
 *
 * Renders nothing.
 */
export function AlertWatcher() {
  const { data: markets } = useAllMarkets();
  const alerts = useAlerts((s) => s.alerts);
  const markTriggered = useAlerts((s) => s.markTriggered);
  const push = useAlertFeed((s) => s.push);
  const notifyEnabled = usePreferences((s) => s.alertNotifications);
  const showOutcomeMarkets = usePreferences((s) => s.showOutcomeMarkets);

  // Install the notification handler once, and keep the background alert check
  // registered only while alert notifications are enabled.
  useEffect(() => {
    configureNotifications();
  }, []);
  useEffect(() => {
    if (notifyEnabled) registerAlertTask();
    else unregisterAlertTask();
  }, [notifyEnabled]);

  // Subscribe live feeds for the distinct instruments that still have armed alerts.
  const armedInstruments = useMemo(() => {
    if (!markets) return [];
    const ids = Array.from(
      new Set(alerts.filter((a) => a.triggeredAt == null).map((a) => a.instrumentId)),
    );
    return ids
      .map((id) => markets.byId[id])
      .filter(
        (instrument): instrument is Instrument =>
          instrument !== undefined &&
          (showOutcomeMarkets || instrument.assetClass !== 'outcome'),
      );
  }, [markets, alerts, showOutcomeMarkets]);

  useLivePriceFeed(armedInstruments);

  // Keep markets reachable inside the price subscription without re-subscribing.
  const marketsRef = useRef(markets);
  useEffect(() => {
    marketsRef.current = markets;
  }, [markets]);

  useEffect(() => {
    const evaluate = (prices: Record<string, number>) => {
      const m = marketsRef.current;
      if (!m) return;
      const active = useAlerts.getState().alerts.filter((a) => a.triggeredAt == null);
      for (const a of active) {
        const inst = m.byId[a.instrumentId];
        if (!inst || !a.anchorPrice) continue;
        if (inst.assetClass === 'outcome' && !showOutcomeMarkets) continue;
        const price = prices[inst.coinKey];
        if (price == null) continue;

        const pct = ((price - a.anchorPrice) / a.anchorPrice) * 100;
        const hit =
          a.direction === 'both'
            ? Math.abs(pct) >= a.pct
            : a.direction === 'up'
              ? pct >= a.pct
              : pct <= -a.pct;
        if (!hit) continue;

        markTriggered(a.id, price, Date.now());
        const decimals = priceDecimalsFor(inst.priceDecimals, price);
        const displayedPrice =
          inst.assetClass === 'outcome' ? formatProbability(price) : formatPrice(price, decimals);
        const message = `${formatPercent(pct)} · ${displayedPrice}`;
        push({
          id: a.id,
          instrumentId: a.instrumentId,
          symbol: a.symbol,
          changePct: pct,
          message,
        });
        // Also fire a local notification so a trip is captured if the user backgrounds
        // the app right after (foreground shows only the in-app toast — see the handler).
        if (usePreferences.getState().alertNotifications) {
          void notifyPriceAlert(a.symbol, message, { instrumentId: a.instrumentId });
        }
      }
    };

    // Evaluate immediately against the current snapshot, then on every tick.
    evaluate(useLivePrices.getState().prices);
    return useLivePrices.subscribe((s) => evaluate(s.prices));
  }, [markTriggered, push, showOutcomeMarkets]);

  return null;
}
