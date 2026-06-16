import { useEffect, useMemo, useRef } from 'react';

import type { Instrument } from '@/domain/types';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import { useMarkets } from '@/data/useMarkets';
import { formatPercent, formatPrice, priceDecimalsFor } from '@/lib/format';
import { useAlertFeed } from '@/store/alertFeed';
import { useAlerts } from '@/store/alerts';
import { useLivePrices } from '@/store/livePrices';

/**
 * App-wide alert engine. Mounted once at the root: it opens live price streams
 * for every instrument with an armed alert (so alerts fire even when that symbol
 * isn't otherwise on screen) and evaluates each tick, firing an in-app toast and
 * marking the alert triggered when its price-move threshold is crossed.
 *
 * Renders nothing.
 */
export function AlertWatcher() {
  const { data: markets } = useMarkets();
  const alerts = useAlerts((s) => s.alerts);
  const markTriggered = useAlerts((s) => s.markTriggered);
  const push = useAlertFeed((s) => s.push);

  // Subscribe live feeds for the distinct instruments that still have armed alerts.
  const armedInstruments = useMemo(() => {
    if (!markets) return [];
    const ids = Array.from(
      new Set(alerts.filter((a) => a.triggeredAt == null).map((a) => a.instrumentId)),
    );
    return ids
      .map((id) => markets.byId[id])
      .filter((i): i is Instrument => i !== undefined);
  }, [markets, alerts]);

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
        push({
          id: a.id,
          instrumentId: a.instrumentId,
          symbol: a.symbol,
          changePct: pct,
          message: `${formatPercent(pct)} · ${formatPrice(price, decimals)}`,
        });
      }
    };

    // Evaluate immediately against the current snapshot, then on every tick.
    evaluate(useLivePrices.getState().prices);
    return useLivePrices.subscribe((s) => evaluate(s.prices));
  }, [markTriggered, push]);

  return null;
}
