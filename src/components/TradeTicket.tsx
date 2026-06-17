import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useHlAccount } from '@/data/useHlAccount';
import { useHlMeta } from '@/data/useHlMeta';
import { placeOrder, type OrderResult } from '@/lib/hyperliquid/exchange';
import { formatPrice } from '@/lib/format';
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

const num = (s: string) => {
  const v = Number(s.replace(/[^0-9.]/g, ''));
  return isFinite(v) ? v : 0;
};

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

  const [side, setSide] = useState<Side>(initialSide ?? 'buy');
  const [orderType, setOrderType] = useState<OrderType>(initialType ?? 'market');
  const [sizeMode, setSizeMode] = useState<SizeMode>(initialSizeCoin != null ? 'coin' : 'usd');
  const [amount, setAmount] = useState(initialSizeCoin != null ? String(initialSizeCoin) : '');
  const [limitPrice, setLimitPrice] = useState('');
  // In close mode reduce-only is forced on and not user-toggleable.
  const [reduceOnly, setReduceOnly] = useState(!!closing);
  const [result, setResult] = useState<OrderResult | null>(null);

  const assetMeta = meta?.[coin];
  const refPx = orderType === 'limit' && num(limitPrice) > 0 ? num(limitPrice) : markPx;
  const coinSize = sizeMode === 'usd' ? (refPx > 0 ? num(amount) / refPx : 0) : num(amount);
  const notional = coinSize * refPx;
  const sideColor = side === 'buy' ? Colors.up : Colors.down;

  const tradable = hasKey && !demo;
  const validSize = coinSize > 0 && (orderType === 'market' || num(limitPrice) > 0);
  const canSubmit = tradable && !!assetMeta && validSize;

  const mutation = useMutation({
    mutationFn: () =>
      placeOrder({
        network,
        assetIndex: assetMeta!.assetIndex,
        szDecimals: assetMeta!.szDecimals,
        isBuy: side === 'buy',
        size: coinSize,
        reduceOnly,
        limitPrice: orderType === 'limit' ? num(limitPrice) : undefined,
        markPx,
      }),
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ['hl-account'] });
    },
    onError: (e: unknown) => {
      Alert.alert('Order failed', e instanceof Error ? e.message : 'Unknown error');
    },
  });

  const reset = () => {
    setAmount(initialSizeCoin != null ? String(initialSizeCoin) : '');
    setLimitPrice('');
    setReduceOnly(!!closing);
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
    Alert.alert(
      `${verb} ${label}?`,
      `${verb} ${sizeStr} ≈ $${formatPrice(notional, 2)}\nat ${priceStr}` +
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <AppText variant="heading">{closing ? `Close ${label}` : `${label}-PERP`}</AppText>
            <View style={styles.headerRight}>
              <AppText variant="caption" muted numeric>
                ${formatPrice(markPx, priceDecimals)}
              </AppText>
              {assetMeta ? (
                <View style={styles.levBadge}>
                  <AppText variant="caption" muted>
                    Up to {assetMeta.maxLeverage}x
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>

          {result ? (
            <ResultView coin={label} result={result} priceDecimals={priceDecimals} onDone={close} onAgain={reset} />
          ) : (
            <>
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
                        side === s && { backgroundColor: (s === 'buy' ? Colors.up : Colors.down) + '22', borderColor: s === 'buy' ? Colors.up : Colors.down },
                      ]}>
                      <AppText variant="label" color={side === s ? (s === 'buy' ? Colors.up : Colors.down) : Colors.textMuted}>
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

              {/* Limit price */}
              {orderType === 'limit' ? (
                <Field label="Limit price">
                  <TextInput
                    value={limitPrice}
                    onChangeText={setLimitPrice}
                    placeholder={formatPrice(markPx, priceDecimals)}
                    placeholderTextColor={Colors.textFaint}
                    keyboardType="decimal-pad"
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
                  placeholder="0.00"
                  placeholderTextColor={Colors.textFaint}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
                <AppText variant="caption" muted>
                  {sizeMode === 'usd' ? 'USD' : label}
                </AppText>
              </Field>

              <AppText variant="caption" muted style={styles.convertLine}>
                {sizeMode === 'usd'
                  ? `≈ ${coinSize > 0 ? Number(coinSize.toFixed(assetMeta?.szDecimals ?? 4)) : 0} ${label}`
                  : `≈ $${formatPrice(notional, 2)}`}
                {account
                  ? `   ·   Available $${formatPrice(account.availableUsdc ?? account.withdrawable, 2)}`
                  : ''}
              </AppText>

              {/* Reduce-only — locked on when closing. */}
              <Pressable
                style={styles.reduceRow}
                disabled={closing}
                onPress={() => setReduceOnly((v) => !v)}>
                <View style={[styles.checkbox, reduceOnly && styles.checkboxOn]}>
                  {reduceOnly ? <Ionicons name="checkmark" size={13} color={Colors.background} /> : null}
                </View>
                <AppText variant="body" muted>
                  Reduce-only{closing ? ' (closing)' : ''}
                </AppText>
              </Pressable>

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
                style={[styles.submit, { backgroundColor: canSubmit ? sideColor : Colors.surfaceAlt }]}
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
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ResultView({
  coin,
  result,
  priceDecimals,
  onDone,
  onAgain,
}: {
  coin: string;
  result: OrderResult;
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
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000AA' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginBottom: Spacing.xs,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  levBadge: { backgroundColor: Colors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.sm },

  closeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceAlt,
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
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },

  segment: { flexDirection: 'row', backgroundColor: Colors.surfaceAlt, borderRadius: Radius.sm, padding: 3, gap: 3 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.sm },
  segmentItemActive: { backgroundColor: Colors.surfacePress },

  field: { backgroundColor: Colors.surfaceAlt, borderRadius: Radius.md, padding: Spacing.md, gap: 4 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  input: { flex: 1, color: Colors.text, fontSize: 22, fontWeight: '700', fontFamily: Fonts.mono, paddingVertical: 2 },
  modeToggle: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  convertLine: { marginTop: -Spacing.xs, marginLeft: Spacing.xs },

  reduceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },

  hint: { marginTop: Spacing.xs },
  submit: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md, marginTop: Spacing.xs, minHeight: 48 },

  result: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  resultBtns: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md, alignSelf: 'stretch' },
  resultBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md },
  resultBtnGhost: { backgroundColor: Colors.surfaceAlt },
});
