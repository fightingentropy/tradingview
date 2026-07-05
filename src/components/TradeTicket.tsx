import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useActiveAsset } from '@/data/useActiveAsset';
import { useHlAccount } from '@/data/useHlAccount';
import { useHlMeta } from '@/data/useHlMeta';
import {
  placeBracket,
  placeOrder,
  updateLeverage,
  type OrderResult,
  type TriggerLeg,
} from '@/lib/hyperliquid/exchange';
import { formatPrice, signedUsd, usd } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { useHlConnection } from '@/store/hlConnection';

type Side = 'buy' | 'sell';
type OrderType = 'market' | 'limit';
type SizeMode = 'usd' | 'coin';

export interface TradeTicketProps {
  visible: boolean;
  onClose: () => void;
  /** Catalog coin key used to resolve the order asset-id from meta (e.g. "BTC", "xyz:MU"). */
  coin: string;
  /** Clean ticker for display (e.g. "MU"). Defaults to {@link coin}. */
  symbol?: string;
  markPx: number;
  priceDecimals: number;
  initialSide?: Side;
  /** Start on Market or Limit (default Market). */
  initialType?: OrderType;
  /** Prefill the size, in coins (switches the size field to coin mode). */
  initialSizeCoin?: number;
  /** Close mode: lock reduce-only on, fix the side, label the action "Close". */
  closing?: boolean;
}

/** Market orders cross the book as an IOC limit at mark ± this — kept in sync with the order. */
const MARKET_SLIPPAGE = 0.05;

/** Ties the numeric fields to their keyboard accessory bar (decimal-pads have no Done key). */
const ACCESSORY_ID = 'trade-ticket-kb';

const LIQUID_GLASS = isLiquidGlassAvailable();
// Translucent fills so the dark glass reads through the grouped panels.
const GLASS_FILL = 'rgba(255,255,255,0.06)';
const GLASS_FILL_STRONG = 'rgba(255,255,255,0.13)';
const GLASS_INSET = 'rgba(0,0,0,0.28)';
const GLASS_HAIRLINE = 'rgba(255,255,255,0.10)';

/** The sheet surface: iOS 26 dark Liquid Glass when available, else a near-black panel. */
function SheetSurface({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  if (LIQUID_GLASS) {
    return (
      <GlassView style={style} glassEffectStyle="regular" colorScheme="dark">
        {children}
      </GlassView>
    );
  }
  return <View style={[style, styles.sheetFallback]}>{children}</View>;
}

const num = (s: string) => {
  const v = Number(s.replace(/[^0-9.]/g, ''));
  return isFinite(v) ? v : 0;
};

/** A short ladder of leverage presets up to (and including) the asset's max. */
function levPresets(maxLev: number): number[] {
  const base = [1, 2, 5, 10, 20].filter((x) => x < maxLev);
  return Array.from(new Set([...base, Math.max(1, maxLev)])).sort((a, b) => a - b);
}

export function TradeTicket({
  visible,
  onClose,
  coin,
  symbol,
  markPx,
  priceDecimals,
  initialSide,
  initialType,
  initialSizeCoin,
  closing,
}: TradeTicketProps) {
  const label = symbol ?? coin;
  const qc = useQueryClient();
  const network = useHlConnection((s) => s.network);
  const hasKey = useHlConnection((s) => s.hasKey);
  const demo = useHlConnection((s) => s.demo);
  const { data: meta } = useHlMeta();
  const { data: account } = useHlAccount();
  const { data: active } = useActiveAsset(coin);

  const [side, setSide] = useState<Side>(initialSide ?? 'buy');
  const [orderType, setOrderType] = useState<OrderType>(initialType ?? 'market');
  // Default to sizing in the asset itself (1 AMZN, not $1) — toggle to USD if wanted.
  const [sizeMode, setSizeMode] = useState<SizeMode>('coin');
  const [amount, setAmount] = useState(initialSizeCoin != null ? String(initialSizeCoin) : '');
  const [limitPrice, setLimitPrice] = useState('');
  // In close mode reduce-only is forced on and not user-toggleable.
  const [reduceOnly, setReduceOnly] = useState(!!closing);
  // Leverage / margin overrides — null means "follow the account's current setting".
  const [levOverride, setLevOverride] = useState<number | null>(null);
  const [crossOverride, setCrossOverride] = useState<boolean | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);
  // How many TP/SL legs rode along with the entry, for the success screen.
  const [bracketExtra, setBracketExtra] = useState(0);
  // Optional bracket: take-profit / stop-loss to attach to a new entry.
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  // Which numeric field owns the keyboard, so the accessory steppers nudge the right one.
  const [focused, setFocused] = useState<'size' | 'limit' | 'tp' | 'sl' | null>(null);

  const assetMeta = meta?.[coin];
  const maxLev = Math.max(1, assetMeta?.maxLeverage ?? 1);
  const refPx = orderType === 'limit' && num(limitPrice) > 0 ? num(limitPrice) : markPx;

  // Effective leverage / margin mode: an explicit user pick wins, else the live
  // account setting, else a safe default until activeAssetData loads.
  const leverage = levOverride ?? active?.leverage ?? Math.min(10, maxLev);
  const isCross = crossOverride ?? active?.isCross ?? true;
  const userSetLev = levOverride !== null || crossOverride !== null;

  const coinSize = sizeMode === 'usd' ? (refPx > 0 ? num(amount) / refPx : 0) : num(amount);
  const notional = coinSize * refPx;
  const marginRequired = leverage > 0 ? notional / leverage : 0;
  const sideColor = side === 'buy' ? Colors.up : Colors.down;

  // Buying power for this side, and the largest order it supports at this leverage.
  const avail = active
    ? side === 'buy'
      ? active.availBuy
      : active.availSell
    : (account?.availableUsdc ?? account?.withdrawable ?? 0);
  const maxSz = refPx > 0 ? (avail * leverage) / refPx : 0;

  // Estimated liquidation for a *new isolated* position. Cross margin depends on the
  // whole account, so — like the official app — we show N/A.
  const liqPrice = useMemo(() => {
    if (closing || isCross) return null;
    if (!(notional > 0) || !(refPx > 0) || leverage <= 0) return null;
    const mmf = 1 / (2 * maxLev); // maintenance margin fraction ≈ half initial at max leverage
    const s = side === 'buy' ? 1 : -1;
    const denom = 1 - mmf * s;
    if (denom === 0) return null;
    const liq = refPx - (s * refPx * (1 / leverage - mmf)) / denom;
    return liq > 0 ? liq : null;
  }, [closing, isCross, notional, refPx, leverage, maxLev, side]);

  const tradable = hasKey && !demo;
  const validSize = coinSize > 0 && (orderType === 'market' || num(limitPrice) > 0);

  // Optional bracket (open orders only). A trigger must sit on the correct side of
  // the entry — TP in profit, SL in loss — or the exchange fires/rejects it at once.
  const isBuy = side === 'buy';
  const tpNum = num(tpPrice);
  const slNum = num(slPrice);
  const tpOk = tpNum <= 0 || (isBuy ? tpNum > refPx : tpNum < refPx);
  const slOk = slNum <= 0 || (isBuy ? slNum < refPx : slNum > refPx);
  const bracketOk = closing || (tpOk && slOk);
  const tpPnl = tpNum > 0 ? (tpNum - refPx) * coinSize * (isBuy ? 1 : -1) : 0;
  const slPnl = slNum > 0 ? (slNum - refPx) * coinSize * (isBuy ? 1 : -1) : 0;

  const canSubmit = tradable && !!assetMeta && validSize && bracketOk;

  const applyPct = (pct: number) => {
    if (maxSz <= 0) return;
    const dec = assetMeta?.szDecimals ?? 4;
    const pow = 10 ** dec;
    // Round DOWN so 'Max' never overshoots maxSz and trips an exchange reject.
    const floored = Math.floor(((pct / 100) * maxSz) * pow) / pow;
    setSizeMode('coin');
    setAmount(floored > 0 ? String(floored) : '');
  };

  const dismissKeyboard = () => Keyboard.dismiss();

  // Step the focused field: limit price by one tick, size by 1 coin / $10.
  const nudge = (dir: 1 | -1) => {
    const tick = 1 / 10 ** priceDecimals;
    if (focused === 'limit' || focused === 'tp' || focused === 'sl') {
      const [cur, set] =
        focused === 'limit'
          ? ([limitPrice, setLimitPrice] as const)
          : focused === 'tp'
            ? ([tpPrice, setTpPrice] as const)
            : ([slPrice, setSlPrice] as const);
      const next = Math.max(0, (num(cur) || refPx) + dir * tick);
      set(String(Number(next.toFixed(priceDecimals))));
      return;
    }
    const step = sizeMode === 'usd' ? 10 : 1;
    const dec = sizeMode === 'usd' ? 2 : (assetMeta?.szDecimals ?? 4);
    const next = Math.max(0, num(amount) + dir * step);
    setAmount(next > 0 ? String(Number(next.toFixed(dec))) : '');
  };

  const mutation = useMutation({
    mutationFn: async (): Promise<{ primary: OrderResult; extra: number }> => {
      // If the user changed leverage / margin mode, apply it before the order.
      const needLevUpdate =
        !closing &&
        userSetLev &&
        (!active || leverage !== active.leverage || isCross !== active.isCross);
      if (needLevUpdate) {
        await updateLeverage({ network, assetIndex: assetMeta!.assetIndex, isCross, leverage });
      }

      // Attach a take-profit / stop-loss bracket when the user set one (open orders only).
      const legs: TriggerLeg[] = [];
      if (!closing) {
        if (tpNum > 0) legs.push({ tpsl: 'tp', triggerPx: tpNum });
        if (slNum > 0) legs.push({ tpsl: 'sl', triggerPx: slNum });
      }
      if (legs.length > 0) {
        const results = await placeBracket({
          network,
          assetIndex: assetMeta!.assetIndex,
          szDecimals: assetMeta!.szDecimals,
          isBuy: side === 'buy',
          size: coinSize,
          limitPrice: orderType === 'limit' ? num(limitPrice) : undefined,
          markPx,
          slippage: MARKET_SLIPPAGE,
          legs,
        });
        const primary = results[0];
        if (!primary) throw new Error('Hyperliquid returned no order status');
        return { primary, extra: results.length - 1 };
      }

      const res = await placeOrder({
        network,
        assetIndex: assetMeta!.assetIndex,
        szDecimals: assetMeta!.szDecimals,
        isBuy: side === 'buy',
        size: coinSize,
        reduceOnly,
        limitPrice: orderType === 'limit' ? num(limitPrice) : undefined,
        markPx,
        slippage: MARKET_SLIPPAGE,
      });
      return { primary: res, extra: 0 };
    },
    onSuccess: ({ primary, extra }) => {
      setResult(primary);
      setBracketExtra(extra);
      qc.invalidateQueries({ queryKey: queryKeys.hlAccountPrefix() });
    },
    onError: (e: unknown) => {
      Alert.alert('Order failed', e instanceof Error ? e.message : 'Unknown error');
    },
  });

  const reset = () => {
    setAmount(initialSizeCoin != null ? String(initialSizeCoin) : '');
    setLimitPrice('');
    setTpPrice('');
    setSlPrice('');
    setBracketExtra(0);
    setReduceOnly(!!closing);
    setLevOverride(null);
    setCrossOverride(null);
    setResult(null);
    mutation.reset();
  };

  const close = () => {
    reset();
    onClose();
  };

  const confirm = () => {
    if (!canSubmit) return;
    const verb = closing ? 'Close' : side === 'buy' ? 'Buy' : 'Sell';
    const sizeStr = `${coinSize.toPrecision(4).replace(/\.?0+$/, '')} ${label}`;
    const priceStr =
      orderType === 'market'
        ? `~$${formatPrice(markPx, priceDecimals)} (market)`
        : `$${formatPrice(num(limitPrice), priceDecimals)} (limit)`;
    const levLine = !closing && userSetLev ? `\nLeverage ${leverage}× ${isCross ? 'Cross' : 'Isolated'}` : '';
    const tpSlLine =
      !closing && (tpNum > 0 || slNum > 0)
        ? '\n' +
          [
            tpNum > 0 ? `TP $${formatPrice(tpNum, priceDecimals)}` : '',
            slNum > 0 ? `SL $${formatPrice(slNum, priceDecimals)}` : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : '';
    Alert.alert(
      `${verb} ${label}?`,
      `${verb} ${sizeStr} ≈ ${usd(notional)}\nat ${priceStr}` +
        levLine +
        tpSlLine +
        (reduceOnly ? '\nReduce-only' : '') +
        (network === 'mainnet' ? '\n\nThis uses real funds on mainnet.' : '\n\nTestnet order.'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb,
          style: side === 'buy' ? 'default' : 'destructive',
          onPress: () => mutation.mutate(),
        },
      ],
    );
  };

  const presets = levPresets(maxLev);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}>
        <SheetSurface style={styles.sheet}>
          {/* Header */}
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <AppText variant="heading">{closing ? `Close ${label}` : `${label}-PERP`}</AppText>
            <View style={styles.headerRight}>
              <AppText variant="caption" muted numeric>
                ${formatPrice(markPx, priceDecimals)}
              </AppText>
              {!closing && assetMeta ? (
                <View style={styles.levBadge}>
                  <AppText variant="caption" color={Colors.text}>
                    {isCross ? 'Cross' : 'Isolated'} · {leverage}×
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>

          {result ? (
            <ResultView
              coin={label}
              result={result}
              extra={bracketExtra}
              priceDecimals={priceDecimals}
              onDone={close}
              onAgain={reset}
            />
          ) : (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}>
              {/* Buy / Sell — hidden in close mode (the side is fixed to flatten). */}
              {closing ? (
                <View style={styles.closeBanner}>
                  <Ionicons name="arrow-undo-outline" size={14} color={Colors.textMuted} />
                  <AppText variant="caption" muted>
                    Reduce-only {side === 'buy' ? 'buy' : 'sell'} to close your position
                  </AppText>
                </View>
              ) : (
                <View style={styles.sideRow}>
                  {(['buy', 'sell'] as Side[]).map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => setSide(s)}
                      style={[
                        styles.sideBtn,
                        side === s && {
                          backgroundColor: (s === 'buy' ? Colors.up : Colors.down) + '22',
                          borderColor: s === 'buy' ? Colors.up : Colors.down,
                        },
                      ]}>
                      <AppText
                        variant="label"
                        color={side === s ? (s === 'buy' ? Colors.up : Colors.down) : Colors.textMuted}>
                        {s === 'buy' ? 'Buy / Long' : 'Sell / Short'}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Market / Limit */}
              <View style={styles.segment}>
                {(['market', 'limit'] as OrderType[]).map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.segmentItem, orderType === t && styles.segmentItemActive]}
                    onPress={() => setOrderType(t)}>
                    <AppText variant="label" color={orderType === t ? Colors.text : Colors.textMuted}>
                      {t === 'market' ? 'Market' : 'Limit'}
                    </AppText>
                  </Pressable>
                ))}
              </View>

              {/* Leverage & margin mode — hidden in close mode. */}
              {!closing ? (
                <View style={styles.levCard}>
                  <View style={styles.levRow}>
                    <AppText variant="caption" muted>
                      Margin mode
                    </AppText>
                    <View style={styles.marginToggle}>
                      {([
                        ['cross', 'Cross'],
                        ['isolated', 'Isolated'],
                      ] as const).map(([k, lbl]) => {
                        const on = (k === 'cross') === isCross;
                        return (
                          <Pressable
                            key={k}
                            onPress={() => setCrossOverride(k === 'cross')}
                            style={[styles.marginBtn, on && styles.marginBtnOn]}>
                            <AppText variant="caption" color={on ? Colors.text : Colors.textMuted}>
                              {lbl}
                            </AppText>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <View style={styles.levDivider} />
                  <View style={styles.levRow}>
                    <AppText variant="caption" muted>
                      Leverage
                    </AppText>
                    <AppText variant="label" numeric color={Colors.text}>
                      {leverage}×
                    </AppText>
                  </View>
                  <View style={styles.chipRow}>
                    {presets.map((L) => {
                      const on = leverage === L;
                      return (
                        <Pressable
                          key={L}
                          onPress={() => setLevOverride(L)}
                          style={[styles.chip, on && styles.chipOn]}>
                          <AppText variant="caption" color={on ? Colors.text : Colors.textMuted}>
                            {L}×
                          </AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Limit price */}
              {orderType === 'limit' ? (
                <Field label="Limit price">
                  <TextInput
                    value={limitPrice}
                    onChangeText={setLimitPrice}
                    onFocus={() => setFocused('limit')}
                    placeholder={formatPrice(markPx, priceDecimals)}
                    placeholderTextColor={Colors.textFaint}
                    keyboardType="decimal-pad"
                    keyboardAppearance="dark"
                    inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                    style={styles.input}
                  />
                  <AppText variant="caption" muted>
                    USD
                  </AppText>
                </Field>
              ) : null}

              {/* Size */}
              <Field
                label="Size"
                right={
                  <Pressable
                    onPress={() => {
                      // Keep the entered value's intent: convert across modes.
                      const next = sizeMode === 'usd' ? 'coin' : 'usd';
                      if (amount) {
                        setAmount(
                          next === 'coin'
                            ? String(Number((num(amount) / (refPx || 1)).toFixed(assetMeta?.szDecimals ?? 4)))
                            : String(Number((num(amount) * refPx).toFixed(2))),
                        );
                      }
                      setSizeMode(next);
                    }}
                    style={styles.modeToggle}>
                    <AppText variant="caption" color={Colors.accent}>
                      {sizeMode === 'usd' ? 'USD' : label}
                    </AppText>
                    <Ionicons name="swap-vertical" size={13} color={Colors.accent} />
                  </Pressable>
                }>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  onFocus={() => setFocused('size')}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textFaint}
                  keyboardType="decimal-pad"
                  keyboardAppearance="dark"
                  inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                  style={styles.input}
                />
                <AppText variant="caption" muted>
                  {sizeMode === 'usd' ? 'USD' : label}
                </AppText>
              </Field>

              <AppText variant="caption" muted style={styles.convertLine}>
                {sizeMode === 'usd'
                  ? `≈ ${coinSize > 0 ? Number(coinSize.toFixed(assetMeta?.szDecimals ?? 4)) : 0} ${label}`
                  : `≈ ${usd(notional)}`}
              </AppText>

              {/* Quick size — % of buying power at the selected leverage. */}
              {!closing ? (
                <View style={styles.pctRow}>
                  {[25, 50, 75, 100].map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => applyPct(p)}
                      disabled={maxSz <= 0}
                      style={[styles.pctChip, maxSz <= 0 && styles.pctChipDisabled]}>
                      <AppText variant="caption" color={Colors.text}>
                        {p === 100 ? 'Max' : `${p}%`}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {/* Take profit / stop loss (optional bracket) — attaches to a new entry. */}
              {!closing ? (
                <View style={styles.tpslCard}>
                  <View style={styles.tpslHead}>
                    <AppText variant="caption" muted>
                      Take profit / Stop loss
                    </AppText>
                    <AppText variant="caption" muted>
                      optional · market
                    </AppText>
                  </View>

                  <View style={styles.tpslRow}>
                    <View style={[styles.tpslDot, { backgroundColor: Colors.up }]} />
                    <TextInput
                      value={tpPrice}
                      onChangeText={setTpPrice}
                      onFocus={() => setFocused('tp')}
                      placeholder={`TP ${isBuy ? '≥' : '≤'} ${formatPrice(refPx, priceDecimals)}`}
                      placeholderTextColor={Colors.textFaint}
                      keyboardType="decimal-pad"
                      keyboardAppearance="dark"
                      inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                      style={styles.tpslInput}
                    />
                    {tpNum > 0 ? (
                      <AppText variant="caption" numeric color={tpOk ? Colors.up : Colors.warning}>
                        {tpOk ? signedUsd(tpPnl) : 'wrong side'}
                      </AppText>
                    ) : null}
                  </View>

                  <View style={styles.tpslRow}>
                    <View style={[styles.tpslDot, { backgroundColor: Colors.down }]} />
                    <TextInput
                      value={slPrice}
                      onChangeText={setSlPrice}
                      onFocus={() => setFocused('sl')}
                      placeholder={`SL ${isBuy ? '≤' : '≥'} ${formatPrice(refPx, priceDecimals)}`}
                      placeholderTextColor={Colors.textFaint}
                      keyboardType="decimal-pad"
                      keyboardAppearance="dark"
                      inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                      style={styles.tpslInput}
                    />
                    {slNum > 0 ? (
                      <AppText variant="caption" numeric color={slOk ? Colors.down : Colors.warning}>
                        {slOk ? signedUsd(slPnl) : 'wrong side'}
                      </AppText>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {/* Order summary */}
              <View style={styles.infoCard}>
                <InfoRow label="Order Value" value={notional > 0 ? usd(notional) : '—'} />
                {!closing ? (
                  <InfoRow label="Margin Required" value={marginRequired > 0 ? usd(marginRequired) : '—'} />
                ) : null}
                {!closing ? (
                  <InfoRow
                    label="Liq. Price"
                    value={liqPrice ? `$${formatPrice(liqPrice, priceDecimals)}` : 'N/A'}
                    valueColor={liqPrice ? Colors.down : Colors.textMuted}
                  />
                ) : null}
                <InfoRow
                  label="Slippage"
                  value={orderType === 'market' ? `Max ${(MARKET_SLIPPAGE * 100).toFixed(0)}%` : '—'}
                />
                <InfoRow label="Available" value={usd(avail)} />
              </View>

              {/* Disabled-state hint */}
              {!tradable ? (
                <AppText variant="caption" color={Colors.warning} style={styles.hint}>
                  {demo
                    ? 'Demo account is read-only. Connect your own account with an API key in Settings to trade.'
                    : 'Add an API wallet key in Settings to enable trading.'}
                </AppText>
              ) : null}

              {/* Submit */}
              <Pressable
                style={[styles.submit, { backgroundColor: canSubmit ? sideColor : GLASS_FILL_STRONG }]}
                onPress={confirm}
                disabled={!canSubmit || mutation.isPending}>
                {mutation.isPending ? (
                  <ActivityIndicator color={Colors.text} />
                ) : (
                  <AppText variant="label" color={canSubmit ? '#04150E' : Colors.textFaint}>
                    {closing ? `Close ${label}` : side === 'buy' ? `Buy ${label}` : `Sell ${label}`}
                  </AppText>
                )}
              </Pressable>
            </ScrollView>
          )}
        </SheetSurface>

        {/* Above-keyboard bar: decimal-pads have no Done key, so this is the only
            way to dismiss. Steppers nudge the focused field. */}
        {Platform.OS === 'ios' && !result ? (
          <InputAccessoryView nativeID={ACCESSORY_ID} backgroundColor="#0B0E13">
            <View style={styles.accessory}>
              <View style={styles.steppers}>
                <Pressable onPress={() => nudge(-1)} hitSlop={8} style={styles.stepBtn}>
                  <Ionicons name="remove" size={20} color={Colors.text} />
                </Pressable>
                <View style={styles.stepDivider} />
                <Pressable onPress={() => nudge(1)} hitSlop={8} style={styles.stepBtn}>
                  <Ionicons name="add" size={20} color={Colors.text} />
                </Pressable>
              </View>
              <AppText variant="caption" muted>
                {focused === 'limit'
                  ? 'Limit price'
                  : focused === 'tp'
                    ? 'Take profit'
                    : focused === 'sl'
                      ? 'Stop loss'
                      : `Size · ${sizeMode === 'usd' ? 'USD' : label}`}
              </AppText>
              <Pressable onPress={dismissKeyboard} hitSlop={8} style={styles.doneBtn}>
                <Ionicons name="checkmark" size={16} color={Colors.accent} />
                <AppText variant="label" color={Colors.accent}>
                  Done
                </AppText>
              </Pressable>
            </View>
          </InputAccessoryView>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.infoRow}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="caption" numeric color={valueColor ?? Colors.text}>
        {value}
      </AppText>
    </View>
  );
}

function ResultView({
  coin,
  result,
  extra,
  priceDecimals,
  onDone,
  onAgain,
}: {
  coin: string;
  result: OrderResult;
  /** Number of TP/SL legs that rode along with the entry. */
  extra: number;
  priceDecimals: number;
  onDone: () => void;
  onAgain: () => void;
}) {
  const filled = result.status === 'filled';
  return (
    <View style={styles.result}>
      <Ionicons
        name={filled ? 'checkmark-circle' : 'time-outline'}
        size={40}
        color={filled ? Colors.up : Colors.warning}
      />
      <AppText variant="heading">{filled ? 'Order filled' : 'Order resting'}</AppText>
      <AppText variant="body" muted numeric>
        {filled
          ? `${result.totalSz} ${coin} @ $${formatPrice(result.avgPx ?? 0, priceDecimals)}`
          : `Working on the book · #${result.oid ?? ''}`}
      </AppText>
      {extra > 0 ? (
        <AppText variant="caption" color={Colors.accent}>
          + {extra === 2 ? 'TP & SL' : 'TP/SL'} order{extra > 1 ? 's' : ''} resting
        </AppText>
      ) : null}
      <View style={styles.resultBtns}>
        <Pressable style={[styles.resultBtn, styles.resultBtnGhost]} onPress={onAgain}>
          <AppText variant="label" color={Colors.text}>
            New order
          </AppText>
        </Pressable>
        <Pressable style={[styles.resultBtn, { backgroundColor: Colors.accent }]} onPress={onDone}>
          <AppText variant="label">Done</AppText>
        </Pressable>
      </View>
    </View>
  );
}

function Field({
  label,
  right,
  children,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <AppText variant="caption" muted>
          {label}
        </AppText>
        {right}
      </View>
      <View style={styles.inputRow}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000C2' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    // Dark Liquid Glass; the faint black scrim deepens it to "black glass" and keeps text legible.
    backgroundColor: 'rgba(0,0,0,0.20)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_HAIRLINE,
    overflow: 'hidden',
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
    maxHeight: '92%',
  },
  // Used only when Liquid Glass isn't available (older iOS) — a near-black solid panel.
  sheetFallback: { backgroundColor: 'rgba(8,10,14,0.98)' },
  body: { flexShrink: 1 },
  bodyContent: { gap: Spacing.md, paddingBottom: Spacing.xs },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: GLASS_FILL_STRONG,
    marginBottom: Spacing.xs,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  levBadge: { backgroundColor: GLASS_FILL_STRONG, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.sm },

  closeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: GLASS_FILL,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  sideRow: { flexDirection: 'row', gap: Spacing.sm },
  sideBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: GLASS_HAIRLINE,
    backgroundColor: GLASS_FILL,
  },

  segment: { flexDirection: 'row', backgroundColor: GLASS_INSET, borderRadius: Radius.sm, padding: 3, gap: 3 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.sm },
  segmentItemActive: { backgroundColor: GLASS_FILL_STRONG },

  levCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  levRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  levDivider: { height: StyleSheet.hairlineWidth, backgroundColor: GLASS_HAIRLINE },
  marginToggle: { flexDirection: 'row', backgroundColor: GLASS_INSET, borderRadius: Radius.sm, padding: 2, gap: 2 },
  marginBtn: { paddingHorizontal: Spacing.md, paddingVertical: 5, borderRadius: Radius.sm },
  marginBtnOn: { backgroundColor: GLASS_FILL_STRONG },
  chipRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: GLASS_FILL,
    borderWidth: 1,
    borderColor: GLASS_HAIRLINE,
    minWidth: 46,
    alignItems: 'center',
  },
  chipOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },

  field: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: 4 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  // App font (SF Pro) with tabular figures — matches the rest of the app; no monospace.
  input: { flex: 1, color: Colors.text, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'], paddingVertical: 2 },
  modeToggle: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  convertLine: { marginTop: -Spacing.xs, marginLeft: Spacing.xs },

  pctRow: { flexDirection: 'row', gap: Spacing.sm },
  pctChip: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.sm, backgroundColor: GLASS_FILL },
  pctChipDisabled: { opacity: 0.4 },

  infoCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  tpslCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  tpslHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tpslRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: GLASS_INSET,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'ios' ? Spacing.sm : 4,
  },
  tpslDot: { width: 8, height: 8, borderRadius: 4 },
  tpslInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    paddingVertical: 4,
  },

  hint: { marginTop: Spacing.xs },
  submit: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md, marginTop: Spacing.xs, minHeight: 48 },

  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: 'transparent',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS_HAIRLINE,
  },
  steppers: { flexDirection: 'row', alignItems: 'center', backgroundColor: GLASS_FILL, borderRadius: Radius.sm, overflow: 'hidden' },
  stepBtn: { paddingHorizontal: Spacing.lg, paddingVertical: 7 },
  stepDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: GLASS_HAIRLINE },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.sm,
    backgroundColor: Colors.accentSoft,
  },

  result: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  resultBtns: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md, alignSelf: 'stretch' },
  resultBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md },
  resultBtnGhost: { backgroundColor: GLASS_FILL },
});
