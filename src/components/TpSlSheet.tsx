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

/** Preset price-move %s from entry, quick-filling a trigger price. */
const PRESETS = [5, 10, 25, 50];

const num = (s: string) => {
  const v = Number(s.replace(/[^0-9.]/g, ''));
  return isFinite(v) ? v : 0;
};

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

export interface TpSlLegInput {
  tpsl: 'tp' | 'sl';
  triggerPx: number;
}

export interface TpSlSheetProps {
  visible: boolean;
  onClose: () => void;
  symbol: string;
  /** Side of the position being protected. */
  side: 'long' | 'short';
  /** Position size in coins (the triggers close the whole position). */
  size: number;
  entryPx: number;
  markPx: number;
  leverage: number;
  priceDecimals: number;
  /** Whether trading is enabled (an API key is set and it isn't the demo account). */
  tradable: boolean;
  busy: boolean;
  /** Submit the entered legs (market triggers, reduce-only). Caller confirms + signs. */
  onSubmit: (legs: TpSlLegInput[]) => void;
}

/**
 * Set a take-profit and/or stop-loss on an open position. Both fire as market
 * triggers that close the whole position (reduce-only). The caller confirms via
 * native Alert and runs the signed `placePositionTpSl`, closing the sheet on success.
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
  tradable,
  busy,
  onSubmit,
}: TpSlSheetProps) {
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');

  const isLong = side === 'long';
  const dir = isLong ? 1 : -1;

  const close = () => {
    setTp('');
    setSl('');
    onClose();
  };

  const tpPx = num(tp);
  const slPx = num(sl);

  // Estimated PnL and ROE (leveraged) at a given exit price.
  const estimate = (px: number) => {
    const pnl = (px - entryPx) * size * dir;
    const movePct = entryPx > 0 ? ((px - entryPx) / entryPx) * 100 * dir : 0;
    return { pnl, roe: movePct * leverage };
  };

  // A trigger only makes sense on the correct side of the current mark, or the
  // exchange fires (or rejects) it immediately. Long: TP above / SL below mark.
  const tpValidSide = tpPx <= 0 || (isLong ? tpPx > markPx : tpPx < markPx);
  const slValidSide = slPx <= 0 || (isLong ? slPx < markPx : slPx > markPx);

  const legs = useMemo<TpSlLegInput[]>(() => {
    const out: TpSlLegInput[] = [];
    if (tpPx > 0) out.push({ tpsl: 'tp', triggerPx: tpPx });
    if (slPx > 0) out.push({ tpsl: 'sl', triggerPx: slPx });
    return out;
  }, [tpPx, slPx]);

  const sidesOk = tpValidSide && slValidSide;
  const canSubmit = tradable && legs.length > 0 && sidesOk && !busy;

  // Fill a trigger price from a preset % move off entry (TP in favor, SL against).
  const round = (px: number) => Number(px.toFixed(priceDecimals));
  const applyTpPct = (pct: number) => setTp(String(round(entryPx * (1 + (pct / 100) * dir))));
  const applySlPct = (pct: number) => setSl(String(round(entryPx * (1 - (pct / 100) * dir))));

  const tpEst = tpPx > 0 ? estimate(tpPx) : null;
  const slEst = slPx > 0 ? estimate(slPx) : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}>
        <SheetSurface style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <AppText variant="heading">Take Profit / Stop Loss</AppText>
            <View style={styles.headerRight}>
              <AppText variant="caption" muted>
                {symbol} · {isLong ? 'Long' : 'Short'} {leverage}x
              </AppText>
            </View>
          </View>

          {/* Take profit */}
          <View style={styles.field}>
            <View style={styles.fieldHead}>
              <AppText variant="caption" color={Colors.up}>
                Take profit
              </AppText>
              {tpEst ? (
                <AppText variant="caption" numeric color={tpEst.pnl >= 0 ? Colors.up : Colors.down}>
                  {signedUsd(tpEst.pnl)} · {formatPercent(tpEst.roe)}
                </AppText>
              ) : (
                <AppText variant="caption" muted>
                  optional
                </AppText>
              )}
            </View>
            <View style={styles.inputRow}>
              <TextInput
                value={tp}
                onChangeText={setTp}
                placeholder={`≥ ${formatPrice(markPx, priceDecimals)}`}
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
            <View style={styles.presetRow}>
              {PRESETS.map((p) => (
                <Pressable key={p} style={styles.presetChip} onPress={() => applyTpPct(p)}>
                  <AppText variant="caption" color={Colors.up}>
                    +{p}%
                  </AppText>
                </Pressable>
              ))}
            </View>
            {!tpValidSide ? (
              <AppText variant="caption" color={Colors.warning}>
                Take profit must be {isLong ? 'above' : 'below'} the mark (${formatPrice(markPx, priceDecimals)}).
              </AppText>
            ) : null}
          </View>

          {/* Stop loss */}
          <View style={styles.field}>
            <View style={styles.fieldHead}>
              <AppText variant="caption" color={Colors.down}>
                Stop loss
              </AppText>
              {slEst ? (
                <AppText variant="caption" numeric color={slEst.pnl >= 0 ? Colors.up : Colors.down}>
                  {signedUsd(slEst.pnl)} · {formatPercent(slEst.roe)}
                </AppText>
              ) : (
                <AppText variant="caption" muted>
                  optional
                </AppText>
              )}
            </View>
            <View style={styles.inputRow}>
              <TextInput
                value={sl}
                onChangeText={setSl}
                placeholder={`≤ ${formatPrice(markPx, priceDecimals)}`}
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
            <View style={styles.presetRow}>
              {PRESETS.map((p) => (
                <Pressable key={p} style={styles.presetChip} onPress={() => applySlPct(p)}>
                  <AppText variant="caption" color={Colors.down}>
                    -{p}%
                  </AppText>
                </Pressable>
              ))}
            </View>
            {!slValidSide ? (
              <AppText variant="caption" color={Colors.warning}>
                Stop loss must be {isLong ? 'below' : 'above'} the mark (${formatPrice(markPx, priceDecimals)}).
              </AppText>
            ) : null}
          </View>

          {/* Summary */}
          <View style={styles.infoCard}>
            <InfoRow label="Entry" value={`$${formatPrice(entryPx, priceDecimals)}`} />
            <InfoRow label="Mark" value={`$${formatPrice(markPx, priceDecimals)}`} />
            <InfoRow label="Closes" value={`${qtyLabel(size)} ${symbol} · market`} />
          </View>

          {!tradable ? (
            <AppText variant="caption" color={Colors.warning} style={styles.hint}>
              Add an API wallet key in Settings to set TP/SL.
            </AppText>
          ) : (
            <AppText variant="caption" muted style={styles.hint}>
              Reduce-only market triggers that close the whole position.
            </AppText>
          )}

          <Pressable
            style={[styles.submit, { backgroundColor: canSubmit ? Colors.accent : GLASS_FILL_STRONG }]}
            onPress={() => onSubmit(legs)}
            disabled={!canSubmit}>
            <AppText variant="label" color={canSubmit ? '#04150E' : Colors.textFaint}>
              {legs.length === 2 ? 'Set TP & SL' : legs.some((l) => l.tpsl === 'tp') ? 'Set take profit' : legs.length ? 'Set stop loss' : 'Set TP/SL'}
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

/** Compact coin quantity for the summary line. */
function qtyLabel(size: number): string {
  const d = size >= 1000 ? 0 : size >= 1 ? 3 : 5;
  return String(Number(size.toFixed(d)));
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

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000C2' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: 'rgba(0,0,0,0.20)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_HAIRLINE,
    overflow: 'hidden',
    padding: Spacing.lg,
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
    marginBottom: Spacing.xs,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

  field: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  input: { flex: 1, color: Colors.text, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'], paddingVertical: 2 },
  presetRow: { flexDirection: 'row', gap: Spacing.sm },
  presetChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: Radius.sm,
    backgroundColor: GLASS_INSET,
  },

  infoCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  hint: { marginTop: -Spacing.xs },
  submit: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md, marginTop: Spacing.xs, minHeight: 48 },

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
