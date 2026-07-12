import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useMemo, useState, type ReactNode } from 'react';
import {
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
import { formatPercent, formatPrice, signedUsd } from '@/lib/format';

const LIQUID_GLASS = isLiquidGlassAvailable();
const ACCESSORY_ID = 'tpsl-sheet-kb';

const GLASS_FILL = 'rgba(255,255,255,0.06)';
const GLASS_FILL_STRONG = 'rgba(255,255,255,0.13)';
const GLASS_INSET = 'rgba(0,0,0,0.28)';
const GLASS_HAIRLINE = 'rgba(255,255,255,0.10)';

/** Quick targets are return-on-equity percentages, not raw price moves. */
const TP_ROE_PRESETS = [2, 5, 10, 20];
const SL_ROE_PRESETS = [2, 5, 10, 20];
const CLOSE_PRESETS = [25, 50, 75, 100];

type TriggerFill = 'market' | 'limit';

const num = (s: string) => {
  const v = Number(s.replace(/[^0-9.]/g, ''));
  return isFinite(v) ? v : 0;
};

/** Floor a coin amount to Hyperliquid's asset size precision. Flooring is
 * intentional: a partial-protection preset must never submit more than the
 * percentage shown to the user. */
export function floorSizeToDecimals(size: number, szDecimals: number): number {
  const decimals = Number.isFinite(szDecimals)
    ? Math.max(0, Math.min(8, Math.trunc(szDecimals)))
    : 8;
  const factor = 10 ** decimals;
  const scaled = Math.max(0, Number.isFinite(size) ? size : 0) * factor;
  // Correct only binary floating-point noise at an exact decimal boundary
  // (e.g. parsed 0.29 × 100 becoming 28.999999999999996) before flooring.
  const ulpGuard = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return Math.floor(scaled + ulpGuard) / factor;
}

/** Black-glass surface when iOS 26 Liquid Glass is available, else a near-black panel. */
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

/** A trigger leg plus the selected reduce-only quantity for callers that support partial exits. */
export interface TpSlLegInput {
  tpsl: 'tp' | 'sl';
  triggerPx: number;
  isMarket: boolean;
  /** Limit triggers rest at this price; currently the entered trigger price. */
  limitPx?: number;
  /** Coin quantity protected by this leg. */
  size: number;
  /** User-facing fraction of the current position, from 1–100. */
  closePct: number;
}

/** Existing reduce-only trigger shown in the management sheet. */
export interface TpSlExistingOrder {
  id: string | number;
  tpsl: 'tp' | 'sl';
  triggerPx: number;
  size: number;
  isMarket: boolean;
}

export interface TpSlSheetProps {
  visible: boolean;
  onClose: () => void;
  symbol: string;
  /** Side of the position being protected. */
  side: 'long' | 'short';
  /** Position size in coins. */
  size: number;
  entryPx: number;
  markPx: number;
  leverage: number;
  priceDecimals: number;
  /** Hyperliquid coin-size precision for this asset. */
  szDecimals?: number;
  /** Whether trading is enabled (an API key is set and it isn't the demo account). */
  tradable: boolean;
  busy: boolean;
  /** Submit reduce-only trigger legs. Caller confirms + signs. */
  onSubmit: (legs: TpSlLegInput[]) => void;
  /** Enable 25/50/75/100% quantities once the caller honors `leg.size`. */
  allowPartial?: boolean;
  /** Existing reduce-only TP/SL orders for this position. */
  existingOrders?: readonly TpSlExistingOrder[];
  /** Cancel one existing order. The caller remains responsible for confirmation. */
  onCancelExisting?: (id: string | number) => void;
  cancelBusy?: boolean;
}

/**
 * Manage reduce-only take-profit / stop-loss orders on an open position. The
 * sheet makes two exchange details explicit: triggers watch the mark price, and
 * a market trigger is an aggressive IOC (so the fill can differ from the trigger).
 */
export function TpSlSheet({
  visible,
  onClose,
  symbol,
  side,
  size,
  entryPx,
  markPx,
  leverage,
  priceDecimals,
  szDecimals = 8,
  tradable,
  busy,
  onSubmit,
  allowPartial = false,
  existingOrders = [],
  onCancelExisting,
  cancelBusy = false,
}: TpSlSheetProps) {
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [closePct, setClosePct] = useState(100);
  const [triggerFill, setTriggerFill] = useState<TriggerFill>('market');

  const isLong = side === 'long';
  const dir = isLong ? 1 : -1;

  const close = () => {
    setTp('');
    setSl('');
    setClosePct(100);
    setTriggerFill('market');
    Keyboard.dismiss();
    onClose();
  };

  const tpPx = num(tp);
  const slPx = num(sl);
  const selectedSize = floorSizeToDecimals(size * (closePct / 100), szDecimals);

  // Estimated PnL and ROE (leveraged) at a given exit price, for selected size.
  const estimate = (px: number) => {
    const pnl = (px - entryPx) * selectedSize * dir;
    const movePct = entryPx > 0 ? ((px - entryPx) / entryPx) * 100 * dir : 0;
    return { pnl, roe: movePct * leverage };
  };

  // A trigger only makes sense on the correct side of the current mark, or the
  // exchange fires (or rejects) it immediately. Long: TP above / SL below mark.
  const markReady = markPx > 0 && Number.isFinite(markPx);
  const tpValidSide =
    tpPx <= 0 || !markReady || (isLong ? tpPx > markPx : tpPx < markPx);
  const slValidSide =
    slPx <= 0 || !markReady || (isLong ? slPx < markPx : slPx > markPx);

  const legs = useMemo<TpSlLegInput[]>(() => {
    const out: TpSlLegInput[] = [];
    const isMarket = triggerFill === 'market';
    const leg = (tpsl: 'tp' | 'sl', triggerPx: number): TpSlLegInput => ({
      tpsl,
      triggerPx,
      isMarket,
      limitPx: isMarket ? undefined : triggerPx,
      size: selectedSize,
      closePct,
    });
    if (tpPx > 0) out.push(leg('tp', tpPx));
    if (slPx > 0) out.push(leg('sl', slPx));
    return out;
  }, [tpPx, slPx, triggerFill, selectedSize, closePct]);

  const sidesOk = tpValidSide && slValidSide;
  const canSubmit =
    tradable && markReady && selectedSize > 0 && legs.length > 0 && sidesOk && !busy;

  // ROE target → raw price move. At 10×, a 5% ROE preset is a 0.5% price move.
  const round = (px: number) => Number(px.toFixed(priceDecimals));
  const applyTpRoe = (roePct: number) =>
    setTp(String(round(entryPx * (1 + (roePct / Math.max(1, leverage) / 100) * dir))));
  const applySlRoe = (roePct: number) =>
    setSl(String(round(entryPx * (1 - (roePct / Math.max(1, leverage) / 100) * dir))));

  const tpEst = tpPx > 0 ? estimate(tpPx) : null;
  const slEst = slPx > 0 ? estimate(slPx) : null;
  const submittingLabel =
    legs.length === 2
      ? `Set TP & SL · ${closePct}%`
      : legs.some((l) => l.tpsl === 'tp')
        ? `Set take profit · ${closePct}%`
        : legs.length
          ? `Set stop loss · ${closePct}%`
          : 'Set TP/SL';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}>
        <SheetSurface style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <AppText variant="heading">Manage protection</AppText>
              <AppText variant="caption" muted numberOfLines={1}>
                {symbol} · {isLong ? 'Long' : 'Short'} {leverage}× · {qtyLabel(size, szDecimals)} {symbol}
              </AppText>
            </View>
            <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close protection sheet">
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}>
            {existingOrders.length > 0 ? (
              <View style={styles.existingCard}>
                <View style={styles.sectionHead}>
                  <AppText variant="caption" color={Colors.text}>
                    Active protection
                  </AppText>
                  <AppText variant="caption" muted>
                    {existingOrders.length} order{existingOrders.length === 1 ? '' : 's'}
                  </AppText>
                </View>
                {existingOrders.map((order) => (
                  <View key={String(order.id)} style={styles.existingRow}>
                    <View style={styles.existingMain}>
                      <View
                        style={[
                          styles.typeDot,
                          { backgroundColor: order.tpsl === 'tp' ? Colors.up : Colors.down },
                        ]}
                      />
                      <View style={styles.existingCopy}>
                        <AppText variant="caption" numeric>
                          {order.tpsl === 'tp' ? 'TP' : 'SL'} ${formatPrice(order.triggerPx, priceDecimals)}
                        </AppText>
                        <AppText variant="caption" muted numeric>
                          {qtyLabel(order.size, szDecimals)} {symbol} · {order.isMarket ? 'market' : 'limit'}
                        </AppText>
                      </View>
                    </View>
                    {onCancelExisting ? (
                      <Pressable
                        style={[styles.cancelOrder, cancelBusy && styles.disabled]}
                        onPress={() => onCancelExisting(order.id)}
                        disabled={cancelBusy}>
                        <AppText variant="caption" color={Colors.down}>
                          Cancel
                        </AppText>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <AppText variant="caption" color={Colors.warning}>
                  Submitting adds another order; cancel a leg first when you mean to replace it.
                </AppText>
              </View>
            ) : (
              <View style={styles.unprotectedCard}>
                <Ionicons name="shield-outline" size={16} color={Colors.warning} />
                <AppText variant="caption" color={Colors.warning}>
                  No active TP/SL protection found for this position.
                </AppText>
              </View>
            )}

            {allowPartial ? (
              <View style={styles.optionCard}>
                <View style={styles.sectionHead}>
                  <AppText variant="caption" muted>
                    Close size
                  </AppText>
                  <AppText variant="caption" numeric>
                    {qtyLabel(selectedSize, szDecimals)} {symbol}
                  </AppText>
                </View>
                <View style={styles.chipRow}>
                  {CLOSE_PRESETS.map((pct) => {
                    const presetSize = floorSizeToDecimals(size * (pct / 100), szDecimals);
                    const unavailable = presetSize <= 0;
                    return (
                      <Pressable
                        key={pct}
                        style={[
                          styles.choiceChip,
                          closePct === pct && !unavailable && styles.choiceChipOn,
                          unavailable && styles.disabled,
                        ]}
                        onPress={() => setClosePct(pct)}
                        disabled={unavailable}
                        accessibilityState={{ disabled: unavailable, selected: closePct === pct }}>
                        <AppText
                          variant="caption"
                          color={
                            unavailable
                              ? Colors.textFaint
                              : closePct === pct
                                ? Colors.text
                                : Colors.textMuted
                          }>
                          {pct}%
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={styles.optionCard}>
              <View style={styles.sectionHead}>
                <AppText variant="caption" muted>
                  When mark price triggers
                </AppText>
                <AppText variant="caption" color={triggerFill === 'market' ? Colors.accent : Colors.warning}>
                  {triggerFill === 'market' ? 'Prioritise exit' : 'Prioritise price'}
                </AppText>
              </View>
              <View style={styles.segment}>
                {(['market', 'limit'] as TriggerFill[]).map((mode) => (
                  <Pressable
                    key={mode}
                    style={[styles.segmentItem, triggerFill === mode && styles.segmentItemOn]}
                    onPress={() => setTriggerFill(mode)}>
                    <AppText
                      variant="caption"
                      color={triggerFill === mode ? Colors.text : Colors.textMuted}>
                      {mode === 'market' ? 'Market exit' : 'Limit at trigger'}
                    </AppText>
                  </Pressable>
                ))}
              </View>
              <AppText variant="caption" muted>
                {triggerFill === 'market'
                  ? 'Uses a reduce-only IOC with a 5% adverse price bound. The fill can slip in a fast or thin market.'
                  : 'Rests a reduce-only limit at the trigger price. Price is capped, but the position may not close.'}
              </AppText>
              {!markReady ? (
                <AppText variant="caption" color={Colors.warning}>
                  Waiting for Hyperliquid’s mark price before validating triggers.
                </AppText>
              ) : null}
            </View>

            <TriggerField
              kind="tp"
              value={tp}
              onChange={setTp}
              markPx={markPx}
              priceDecimals={priceDecimals}
              isLong={isLong}
              estimate={tpEst}
              validSide={tpValidSide}
              presets={TP_ROE_PRESETS}
              onPreset={applyTpRoe}
            />

            <TriggerField
              kind="sl"
              value={sl}
              onChange={setSl}
              markPx={markPx}
              priceDecimals={priceDecimals}
              isLong={isLong}
              estimate={slEst}
              validSide={slValidSide}
              presets={SL_ROE_PRESETS}
              onPreset={applySlRoe}
            />

            <View style={styles.infoCard}>
              <InfoRow label="Entry" value={`$${formatPrice(entryPx, priceDecimals)}`} />
              <InfoRow
                label="Mark trigger"
                value={markReady ? `$${formatPrice(markPx, priceDecimals)}` : 'Loading…'}
              />
              <InfoRow
                label="Protected size"
                value={`${qtyLabel(selectedSize, szDecimals)} ${symbol} · ${closePct}%`}
              />
            </View>

            {!tradable ? (
              <AppText variant="caption" color={Colors.warning}>
                Add an API wallet key in Settings to change protection.
              </AppText>
            ) : null}
          </ScrollView>

          <Pressable
            style={[styles.submit, { backgroundColor: canSubmit ? Colors.accent : GLASS_FILL_STRONG }]}
            onPress={() => onSubmit(legs)}
            disabled={!canSubmit}>
            <AppText variant="label" color={canSubmit ? '#04150E' : Colors.textFaint}>
              {busy ? 'Setting protection…' : submittingLabel}
            </AppText>
          </Pressable>
        </SheetSurface>

        {Platform.OS === 'ios' ? (
          <InputAccessoryView nativeID={ACCESSORY_ID} backgroundColor="#0B0E13">
            <View style={styles.accessory}>
              <View />
              <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} style={styles.doneBtn}>
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

function TriggerField({
  kind,
  value,
  onChange,
  markPx,
  priceDecimals,
  isLong,
  estimate,
  validSide,
  presets,
  onPreset,
}: {
  kind: 'tp' | 'sl';
  value: string;
  onChange: (value: string) => void;
  markPx: number;
  priceDecimals: number;
  isLong: boolean;
  estimate: { pnl: number; roe: number } | null;
  validSide: boolean;
  presets: number[];
  onPreset: (roePct: number) => void;
}) {
  const isTp = kind === 'tp';
  const color = isTp ? Colors.up : Colors.down;
  const comparator = isTp === isLong ? 'above' : 'below';
  const glyph = comparator === 'above' ? '≥' : '≤';

  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <AppText variant="caption" color={color}>
          {isTp ? 'Take profit' : 'Stop loss'}
        </AppText>
        {estimate ? (
          <AppText variant="caption" numeric color={estimate.pnl >= 0 ? Colors.up : Colors.down}>
            {signedUsd(estimate.pnl)} · {formatPercent(estimate.roe)} ROE
          </AppText>
        ) : (
          <AppText variant="caption" muted>
            optional
          </AppText>
        )}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={
            markPx > 0 ? `${glyph} ${formatPrice(markPx, priceDecimals)}` : 'Waiting for mark'
          }
          placeholderTextColor={Colors.textFaint}
          keyboardType="decimal-pad"
          keyboardAppearance="dark"
          inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
          style={styles.input}
        />
        <AppText variant="caption" muted>
          USD
        </AppText>
      </View>
      <View style={styles.chipRow}>
        {presets.map((roe) => (
          <Pressable key={roe} style={styles.presetChip} onPress={() => onPreset(roe)}>
            <AppText variant="caption" color={color}>
              {isTp ? '+' : '−'}{roe}% ROE
            </AppText>
          </Pressable>
        ))}
      </View>
      {!validSide ? (
        <AppText variant="caption" color={Colors.warning}>
          {isTp ? 'Take profit' : 'Stop loss'} must be {comparator} the mark ($
          {formatPrice(markPx, priceDecimals)}).
        </AppText>
      ) : null}
    </View>
  );
}

/** Compact coin quantity for summary lines. */
function qtyLabel(size: number, precision?: number): string {
  const d = precision ?? (size >= 1000 ? 0 : size >= 1 ? 3 : 5);
  return String(Number(size.toFixed(d)));
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="caption" numeric color={Colors.text}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000C2',
  },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    backgroundColor: 'rgba(0,0,0,0.20)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_HAIRLINE,
    overflow: 'hidden',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  sheetFallback: { backgroundColor: 'rgba(8,10,14,0.98)' },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: GLASS_FILL_STRONG,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  headerCopy: { flex: 1, gap: 2 },
  body: { flexShrink: 1 },
  bodyContent: { gap: Spacing.md, paddingBottom: Spacing.xs },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  existingCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  existingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingVertical: 2,
  },
  existingMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  existingCopy: { flex: 1, minWidth: 0 },
  typeDot: { width: 7, height: 7, borderRadius: 4 },
  cancelOrder: { paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  disabled: { opacity: 0.45 },
  unprotectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.warning + '12',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.warning + '55',
  },

  optionCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  chipRow: { flexDirection: 'row', gap: Spacing.xs },
  choiceChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: Radius.sm,
    backgroundColor: GLASS_INSET,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  choiceChipOn: { backgroundColor: Colors.accentSoft, borderColor: Colors.accent + '88' },
  segment: { flexDirection: 'row', padding: 3, borderRadius: Radius.sm, backgroundColor: GLASS_INSET },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: Radius.sm },
  segmentItemOn: { backgroundColor: GLASS_FILL_STRONG },

  field: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: 23,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    paddingVertical: 2,
  },
  presetChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: Radius.sm,
    backgroundColor: GLASS_INSET,
  },

  infoCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  submit: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    minHeight: 48,
  },

  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS_HAIRLINE,
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.sm,
    backgroundColor: Colors.accentSoft,
  },
});
