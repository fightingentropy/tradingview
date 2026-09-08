import { useEffect, useMemo, useRef } from 'react';

import type { Instrument } from '@/domain/types';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useAllMarkets } from '@/data/useMarkets';
import { priceAlertMove } from '@/domain/priceAlerts';
import { formatPercent, formatPrice, formatProbability, priceDecimalsFor } from '@/lib/format';
import { configureNotifications } from '@/lib/notifications';
import { useAlertFeed } from '@/store/alertFeed';
import { useAlerts } from '@/store/alerts';
import { useLivePrices } from '@/store/livePrices';
import { usePreferences } from '@/store/preferences';

/**
 * Foreground-only alerts when remote monitoring is off. The Mac mini is the sole
 * trigger authority while notifications are enabled, avoiding duplicate dispatch.
 */
export function AlertWatcher() {
  const { data: markets } = useAllMarkets();
  const alerts = useAlerts((s) => s.alerts);
  const markTriggered = useAlerts((s) => s.markTriggered);
  const push = useAlertFeed((s) => s.push);
  const notifyEnabled = usePreferences((s) => s.alertNotifications);
  const showOutcomeMarkets = usePreferences((s) => s.showOutcomeMarkets);

  useEffect(() => {
    configureNotifications();
  }, []);

  // Subscribe live feeds for the distinct instruments that still have armed alerts.
  const armedInstruments = useMemo(() => {
    if (!markets || notifyEnabled) return [];
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
  }, [markets, alerts, showOutcomeMarkets, notifyEnabled]);

  useLivePriceFeed(armedInstruments);

  // Keep markets reachable inside the price subscription without re-subscribing.
  const marketsRef = useRef(markets);
  useEffect(() => {
    marketsRef.current = markets;
  }, [markets]);

  useEffect(() => {
    const evaluate = () => {
      if (usePreferences.getState().alertNotifications) return;
      const m = marketsRef.current;
      if (!m) return;
      const active = useAlerts.getState().alerts.filter((a) => a.triggeredAt == null);
      for (const a of active) {
        const inst = m.byId[a.instrumentId];
        if (!inst || !a.anchorPrice) continue;
        if (inst.assetClass === 'outcome' && !showOutcomeMarkets) continue;
        const tick = useLivePrices.getState().observations[inst.coinKey];
        if (!tick || tick.ts < a.createdAt || Date.now() - tick.ts > 30_000) continue;
        const price = tick.last;
        const pct = priceAlertMove(a, price);
        if (pct === null) continue;

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
      }
    };

    // Evaluate immediately against the current snapshot, then on every tick.
    evaluate();
    return useLivePrices.subscribe(evaluate);
  }, [markTriggered, push, showOutcomeMarkets]);

  return null;
}
