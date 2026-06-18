import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useState, type ReactNode } from 'react';
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
import { usd } from '@/lib/format';

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
  /** Free USDC available to add. */
  available: number;
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
  available,
  tradable,
  busy,
  onSubmit,
}: MarginSheetProps) {
  const [mode, setMode] = useState<Mode>('add');
  const [amount, setAmount] = useState('');
  const amt = num(amount);

  const close = () => {
    setMode('add');
    setAmount('');
    onClose();
  };

  // Cap by what's actually movable; the exchange does the final maintenance-margin check.
  const cap = mode === 'add' ? available : marginUsed;
  const newMargin = mode === 'add' ? marginUsed + amt : Math.max(0, marginUsed - amt);
  const valid = amt > 0 && amt <= cap + 1e-9;
  const canSubmit = tradable && valid && !busy;

  const setMax = () => setAmount(cap > 0 ? String(Number(cap.toFixed(2))) : '');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
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
                onPress={() => setMode(mItem)}>
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
              <Pressable onPress={setMax} hitSlop={6} disabled={cap <= 0}>
                <AppText variant="caption" color={cap > 0 ? Colors.accent : Colors.textFaint}>
                  Max {usd(cap)}
                </AppText>
              </Pressable>
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
            <InfoRow label="Current margin" value={usd(marginUsed)} />
            <InfoRow
              label="New margin"
              value={amt > 0 ? usd(newMargin) : '—'}
              valueColor={amt > 0 ? Colors.text : Colors.textMuted}
            />
            <InfoRow label={mode === 'add' ? 'Available' : 'Removable'} value={usd(cap)} />
          </View>

          {!tradable ? (
            <AppText variant="caption" color={Colors.warning} style={styles.hint}>
              Add an API wallet key in Settings to adjust margin.
            </AppText>
          ) : null}

          <Pressable
            style={[styles.submit, { backgroundColor: canSubmit ? Colors.accent : GLASS_FILL_STRONG }]}
            onPress={() => onSubmit(mode === 'add' ? amt : -amt)}
            disabled={!canSubmit}>
            <AppText variant="label" color={canSubmit ? '#04150E' : Colors.textFaint}>
              {mode === 'add' ? 'Add margin' : 'Remove margin'}
              {amt > 0 ? ` · ${usd(amt)}` : ''}
            </AppText>
          </Pressable>
        </SheetSurface>

        {Platform.OS === 'ios' ? (
          <InputAccessoryView nativeID={ACCESSORY_ID} backgroundColor="#0B0E13">
            <View style={styles.accessory}>
              <Pressable onPress={setMax} hitSlop={8} style={styles.accBtn} disabled={cap <= 0}>
                <AppText variant="label" color={cap > 0 ? Colors.accent : Colors.textFaint}>
                  Max
                </AppText>
              </Pressable>
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
