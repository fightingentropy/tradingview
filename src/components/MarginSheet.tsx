import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
import { formatPrice, usd } from '@/lib/format';

type Mode = 'add' | 'remove';

const LIQUID_GLASS = isLiquidGlassAvailable();
const ACCESSORY_ID = 'margin-sheet-kb';

const GLASS_FILL = 'rgba(255,255,255,0.06)';
const GLASS_FILL_STRONG = 'rgba(255,255,255,0.13)';
const GLASS_INSET = 'rgba(0,0,0,0.28)';
const GLASS_HAIRLINE = 'rgba(255,255,255,0.10)';

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

export interface MarginSheetProps {
  visible: boolean;
  onClose: () => void;
  symbol: string;
  /** Current isolated margin on the position. */
  marginUsed: number;
  /** Conservative client-side ceiling after retaining the live transfer-margin floor. */
  removalSafetyLimit: number;
  /** False for strict-isolated markets, where protocol rules prohibit removal. */
  removalAllowed: boolean;
  /** Free USDC available to add. */
  available: number;
  side: 'long' | 'short';
  markPx: number;
  liquidationPx: number | null;
  positionValue: number;
  leverage: number;
  priceDecimals: number;
  /** Whether trading is enabled (an API key is set and it isn't the demo account). */
  tradable: boolean;
  busy: boolean;
  /** Positive adds margin, negative removes it. */
  onSubmit: (signedUsd: number) => void;
}

/**
 * Add or remove isolated margin on a position. The caller confirms (native Alert)
 * and runs the signed `updateIsolatedMargin`, then closes the sheet on success.
 */
export function MarginSheet({
  visible,
  onClose,
  symbol,
  marginUsed,
  removalSafetyLimit,
  removalAllowed,
  available,
  side,
  markPx,
  liquidationPx,
  positionValue,
  leverage,
  priceDecimals,
  tradable,
  busy,
  onSubmit,
}: MarginSheetProps) {
  const [mode, setMode] = useState<Mode>('add');
  const [amount, setAmount] = useState('');
  const amt = num(amount);
  const liquidationDistancePct =
    markPx > 0 && liquidationPx != null && liquidationPx > 0
      ? (Math.abs(markPx - liquidationPx) / markPx) * 100
      : null;

  const close = () => {
    if (busy) return;
    setMode('add');
    setAmount('');
    onClose();
  };

  // Removal deliberately does not use all displayed margin as "Max". The caller
  // supplies a conservative ceiling that retains the current transfer-margin floor;
  // Hyperliquid still rechecks the live position before accepting the action.
  const cap = mode === 'add' ? available : removalAllowed ? removalSafetyLimit : 0;
  const newMargin = mode === 'add' ? marginUsed + amt : Math.max(0, marginUsed - amt);
  const valid = amt > 0 && amt <= cap + 1e-9;
  const canSubmit = tradable && valid && !busy;

  const setMax = () => {
    if (mode === 'add') setAmount(cap > 0 ? String(Number(cap.toFixed(2))) : '');
  };

  const setMarginMode = (next: Mode) => {
    setMode(next);
    // An amount safe to add can be unsafe to remove. Force a fresh amount review.
    setAmount('');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} disabled={busy} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}>
        <SheetSurface style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <AppText variant="heading">Adjust Margin</AppText>
            <View style={styles.headerRight}>
              <AppText variant="caption" muted>
                {symbol} · Isolated
              </AppText>
            </View>
          </View>

          {/* Add / Remove */}
          <View style={styles.segment}>
            {(['add', 'remove'] as Mode[]).map((mItem) => (
              <Pressable
                key={mItem}
                style={[styles.segmentItem, mode === mItem && styles.segmentItemActive]}
                onPress={() => setMarginMode(mItem)}>
                <AppText variant="label" color={mode === mItem ? Colors.text : Colors.textMuted}>
                  {mItem === 'add' ? 'Add' : 'Remove'}
                </AppText>
              </Pressable>
            ))}
          </View>

          {/* Amount */}
          <View style={styles.field}>
            <View style={styles.fieldHead}>
              <AppText variant="caption" muted>
                Amount
              </AppText>
              {mode === 'add' ? (
                <Pressable onPress={setMax} hitSlop={6} disabled={cap <= 0}>
                  <AppText variant="caption" color={cap > 0 ? Colors.accent : Colors.textFaint}>
                    Max {usd(cap)}
                  </AppText>
                </Pressable>
              ) : (
                <AppText variant="caption" color={cap > 0 ? Colors.warning : Colors.textFaint}>
                  Safety limit {usd(cap)}
                </AppText>
              )}
            </View>
            <View style={styles.inputRow}>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
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
          </View>

          {/* Summary */}
          <View style={styles.infoCard}>
            <InfoRow label="Margin shown now" value={usd(marginUsed)} />
            <InfoRow
              label="Margin if accepted"
              value={amt > 0 ? usd(newMargin) : '—'}
              valueColor={amt > 0 ? Colors.text : Colors.textMuted}
            />
            <InfoRow label="Position notional" value={usd(positionValue)} />
            <InfoRow label="Leverage" value={`${leverage.toFixed(0)}× · ${side}`} />
            <InfoRow
              label={mode === 'add' ? 'Available collateral' : 'Removal safety limit'}
              value={usd(cap)}
              valueColor={mode === 'remove' ? Colors.warning : Colors.text}
            />
          </View>

          <View style={[styles.riskCard, mode === 'remove' && styles.riskCardDanger]}>
            <View style={styles.riskHead}>
              <Ionicons
                name={mode === 'remove' ? 'warning' : 'shield-checkmark-outline'}
                size={16}
                color={mode === 'remove' ? Colors.down : Colors.up}
              />
              <AppText variant="label" color={mode === 'remove' ? Colors.down : Colors.text}>
                Liquidation risk
              </AppText>
            </View>
            <InfoRow label="Current mark" value={`$${formatPrice(markPx, priceDecimals)}`} />
            <InfoRow
              label="Current liquidation"
              value={
                liquidationPx != null && liquidationPx > 0
                  ? `$${formatPrice(liquidationPx, priceDecimals)}`
                  : 'Unavailable'
              }
              valueColor={liquidationPx != null && liquidationPx > 0 ? Colors.down : Colors.warning}
            />
            <InfoRow
              label="Current distance"
              value={liquidationDistancePct == null ? 'Unavailable' : `${liquidationDistancePct.toFixed(2)}%`}
              valueColor={liquidationDistancePct == null ? Colors.warning : Colors.text}
            />
            <InfoRow
              label="After this change"
              value="Unknown until accepted"
              valueColor={mode === 'remove' ? Colors.down : Colors.textMuted}
            />
            <AppText
              variant="caption"
              color={mode === 'remove' ? Colors.down : Colors.textMuted}
              style={styles.riskCopy}>
              {mode === 'remove'
                ? 'Removing margin moves liquidation closer to the mark. No projected liquidation price is shown because the exchange must recalculate it from live margin tiers, price, PnL, and funding.'
                : 'Adding margin generally moves liquidation farther away. Verify the recalculated liquidation price on the live position after acceptance.'}
            </AppText>
          </View>

          {mode === 'remove' && !removalAllowed ? (
            <AppText variant="caption" color={Colors.down} style={styles.hint}>
              This is a strict-isolated market. Hyperliquid permits adding margin but does not permit removing it.
            </AppText>
          ) : mode === 'remove' && removalSafetyLimit <= 0 ? (
            <AppText variant="caption" color={Colors.warning} style={styles.hint}>
              No removal clears the current conservative margin floor. Add margin or reduce the position first.
            </AppText>
          ) : null}

          {!tradable ? (
            <AppText variant="caption" color={Colors.warning} style={styles.hint}>
              Add an API wallet key in Settings to adjust margin.
            </AppText>
          ) : null}

          <Pressable
            style={[
              styles.submit,
              { backgroundColor: canSubmit || busy ? Colors.accent : GLASS_FILL_STRONG },
            ]}
            onPress={() => onSubmit(mode === 'add' ? amt : -amt)}
            disabled={!canSubmit || busy}
            accessibilityState={{ disabled: !canSubmit || busy, busy }}>
            {busy ? (
              <View style={styles.submitBusy}>
                <ActivityIndicator size="small" color="#04150E" />
                <AppText variant="label" color="#04150E">
                  Updating margin…
                </AppText>
              </View>
            ) : (
              <AppText variant="label" color={canSubmit ? '#04150E' : Colors.textFaint}>
                {mode === 'add' ? 'Add margin' : 'Review risky removal'}
                {amt > 0 ? ` · ${usd(amt)}` : ''}
              </AppText>
            )}
          </Pressable>
        </SheetSurface>

        {Platform.OS === 'ios' ? (
          <InputAccessoryView nativeID={ACCESSORY_ID} backgroundColor="#0B0E13">
            <View style={styles.accessory}>
              {mode === 'add' ? (
                <Pressable onPress={setMax} hitSlop={8} style={styles.accBtn} disabled={cap <= 0}>
                  <AppText variant="label" color={cap > 0 ? Colors.accent : Colors.textFaint}>
                    Max
                  </AppText>
                </Pressable>
              ) : (
                <AppText variant="caption" color={Colors.warning}>
                  Live safety check on submit
                </AppText>
              )}
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

  segment: { flexDirection: 'row', backgroundColor: GLASS_INSET, borderRadius: Radius.sm, padding: 3, gap: 3 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.sm },
  segmentItemActive: { backgroundColor: GLASS_FILL_STRONG },

  field: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: 4 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  input: { flex: 1, color: Colors.text, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'], paddingVertical: 2 },

  infoCard: { backgroundColor: GLASS_FILL, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  riskCard: {
    backgroundColor: GLASS_FILL,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_HAIRLINE,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  riskCardDanger: { backgroundColor: 'rgba(246,70,93,0.09)', borderColor: 'rgba(246,70,93,0.48)' },
  riskHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  riskCopy: { lineHeight: 17 },

  hint: { marginTop: -Spacing.xs },
  submit: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md, marginTop: Spacing.xs, minHeight: 48 },
  submitBusy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },

  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS_HAIRLINE,
  },
  accBtn: { paddingHorizontal: Spacing.md, paddingVertical: 7 },
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
