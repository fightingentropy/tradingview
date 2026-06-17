import { Ionicons } from '@expo/vector-icons';
import { useIsRestoring } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { IndicatorMenu } from '@/components/IndicatorMenu';
import { PriceChart, type ChartType } from '@/components/PriceChart';
import { RangeBar } from '@/components/RangeBar';
import { RsiPane } from '@/components/RsiPane';
import { useSymbolMenu } from '@/components/SymbolMenu';
import { TradeTicket } from '@/components/TradeTicket';
import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { VenueBadge } from '@/components/VenueBadge';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { DEFAULT_RANGE, resolveRange, type RangeKey } from '@/domain/ranges';
import type { Candle } from '@/domain/types';
import { useCandles } from '@/data/useCandles';
import { useMarkets } from '@/data/useMarkets';
import { useLivePriceFeed } from '@/data/useLivePriceFeed';
import {
  formatCompact,
  formatFundingApr,
  formatPercent,
  formatPrice,
  priceDecimalsFor,
} from '@/lib/format';
import { useChartSettings } from '@/store/chartSettings';
import { useLivePrice } from '@/store/livePrices';
import { useWatchlists } from '@/store/watchlists';

export default function SymbolScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading: marketsLoading } = useMarkets();
  const isRestoring = useIsRestoring();
  const instrument = id ? data?.byId[id] : undefined;
  const quote = id ? data?.quotes[id] : undefined;

  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [ticketSide, setTicketSide] = useState<'buy' | 'sell' | null>(null);
  const { interval, fetch: fetchCount, visible, render, axis } = resolveRange(range);

  useLivePriceFeed(instrument ? [instrument] : []);
  const live = useLivePrice(instrument?.coinKey);
  const { data: candleData, isLoading: candlesLoading } = useCandles(instrument, interval, fetchCount);
  const candles: Candle[] = candleData ?? [];

  const activeId = useWatchlists((s) => s.activeId);
  const watched = useWatchlists((s) => s.lists.find((l) => l.id === s.activeId)?.symbolIds.includes(id) ?? false);
  const toggle = useWatchlists((s) => s.toggle);
  const { open: openMenu } = useSymbolMenu();

  const smaPeriods = useChartSettings((s) => s.smaPeriods);
  const volume = useChartSettings((s) => s.volume);
  const rsi = useChartSettings((s) => s.rsi);
  const rsiPeriod = useChartSettings((s) => s.rsiPeriod);

  if (!instrument) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: id ?? 'Symbol' }} />
        <View style={styles.center}>
          {marketsLoading || isRestoring ? (
            <ActivityIndicator color={Colors.accent} />
          ) : (
            <AppText muted>Not found</AppText>
          )}
        </View>
      </Screen>
    );
  }

  const last = live ?? quote?.last ?? null;
  const prev = quote?.prevClose ?? null;
  const changePct =
    last !== null && prev !== null && prev !== 0
      ? ((last - prev) / prev) * 100
      : (quote?.change24hPct ?? null);
  const up = (changePct ?? 0) >= 0;
  const decimals = priceDecimalsFor(instrument.priceDecimals, last);

  // Trading covers Hyperliquid perps AND the trade.xyz (HIP-3) dex — the venues we can
  // sign orders for. Both resolve their order asset-id from the cached meta by coinKey.
  const isHlTradable =
    instrument.id.startsWith('hl:perp:') || instrument.id.startsWith('hl:xyz:');

  // Funding rate (perps only). Positive = longs pay shorts (red); negative = shorts pay longs (green).
  const funding = quote?.funding ?? null;
  const fundingColor =
    funding == null || funding === 0 ? Colors.textMuted : funding > 0 ? Colors.down : Colors.up;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: instrument.symbol,
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                hitSlop={12}
                onPress={() => openMenu(instrument)}
                accessibilityRole="button"
                accessibilityLabel="Set price alert">
                <Ionicons name="notifications-outline" size={21} color={Colors.textMuted} />
              </Pressable>
              <Pressable hitSlop={12} onPress={() => toggle(activeId, instrument.id)}>
                <Ionicons
                  name={watched ? 'star' : 'star-outline'}
                  size={22}
                  color={watched ? Colors.warning : Colors.textMuted}
                />
              </Pressable>
            </View>
          ),
        }}
      />

      <View style={styles.header}>
        <View style={styles.headerTop}>
          <VenueBadge venue={instrument.venue} />
          <AppText variant="caption" muted numberOfLines={1} style={styles.name}>
            {instrument.name}
          </AppText>
        </View>
        <AppText variant="title" numeric>
          {formatPrice(last, decimals)}
        </AppText>
        <View style={styles.metaRow}>
          <AppText
            variant="label"
            numeric
            color={changePct === null ? Colors.textMuted : up ? Colors.up : Colors.down}>
            {formatPercent(changePct)}
          </AppText>
          {quote?.dayVolume ? (
            <AppText variant="label" numeric muted>
              · Vol {formatCompact(quote.dayVolume)}
            </AppText>
          ) : null}
          {funding != null ? (
            <AppText variant="label" numeric color={fundingColor}>
              · Funding {formatFundingApr(funding)} APR
            </AppText>
          ) : null}
        </View>
      </View>

      <View style={styles.chartArea}>
        {candlesLoading && candles.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <PriceChart
            // Remount on range change so the history-pan offset resets to the latest.
            key={range}
            candles={candles}
            priceDecimals={decimals}
            type={chartType}
            smaPeriods={smaPeriods}
            showVolume={volume}
            visibleCount={visible}
            renderCount={render}
            axisKind={axis}
          />
        )}
      </View>

      {rsi && candles.length > 0 ? (
        <RsiPane candles={candles} period={rsiPeriod} visibleCount={visible} />
      ) : null}

      <View style={styles.controls}>
        <Pressable
          style={styles.typeToggle}
          onPress={() => setChartType((t) => (t === 'candle' ? 'line' : 'candle'))}
          accessibilityRole="button"
          accessibilityLabel="Toggle chart type">
          <Ionicons
            name={chartType === 'candle' ? 'stats-chart' : 'pulse'}
            size={18}
            color={Colors.textMuted}
          />
        </Pressable>
        <IndicatorMenu />
        <View style={styles.timeframeWrap}>
          <RangeBar value={range} onChange={setRange} />
        </View>
      </View>

      {isHlTradable ? (
        <View style={styles.tradeBar}>
          <Pressable style={[styles.tradeBtn, styles.sellBtn]} onPress={() => setTicketSide('sell')}>
            <AppText variant="label" color="#FFFFFF">
              Sell
            </AppText>
          </Pressable>
          <Pressable style={[styles.tradeBtn, styles.buyBtn]} onPress={() => setTicketSide('buy')}>
            <AppText variant="label" color="#04150E">
              Buy
            </AppText>
          </Pressable>
        </View>
      ) : null}

      {isHlTradable ? (
        <TradeTicket
          key={ticketSide ?? 'closed'}
          visible={ticketSide !== null}
          onClose={() => setTicketSide(null)}
          coin={instrument.coinKey}
          symbol={instrument.symbol}
          markPx={last ?? 0}
          priceDecimals={decimals}
          initialSide={ticketSide ?? 'buy'}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: 4 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.xs, rowGap: 2 },
  chartArea: { flex: 1, marginTop: Spacing.sm },
  controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.sm },
  typeToggle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeframeWrap: { flex: 1 },
  tradeBar: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  tradeBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md },
  sellBtn: { backgroundColor: Colors.down },
  buyBtn: { backgroundColor: Colors.up },
});
