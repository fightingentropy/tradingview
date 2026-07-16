import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { VenueBadge } from '@/components/VenueBadge';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { AlertDirection, Instrument, PriceAlert } from '@/domain/types';
import {
  formatPercent,
  formatPrice,
  formatProbability,
  formatProbabilityPointChange,
  priceDecimalsFor,
} from '@/lib/format';
import { useMarkets } from '@/data/useMarkets';
import { useAlerts, useAlertsFor } from '@/store/alerts';
import { useLivePrice } from '@/store/livePrices';
import { useWatchlists } from '@/store/watchlists';

interface SymbolMenuApi {
  /** Open the context menu / alert sheet for an instrument. */
  open: (instrument: Instrument) => void;
}

const SymbolMenuContext = createContext<SymbolMenuApi>({ open: () => {} });

/** Right-click / long-press a symbol anywhere to open its alert + actions sheet. */
export const useSymbolMenu = () => useContext(SymbolMenuContext);

const PRESETS = [5, 10, 25, 50];
const DIRECTIONS: { key: AlertDirection; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'up', label: 'Above', icon: 'arrow-up' },
  { key: 'down', label: 'Below', icon: 'arrow-down' },
  { key: 'both', label: 'Either', icon: 'swap-vertical' },
];

export function SymbolMenuProvider({ children }: PropsWithChildren) {
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const api = useMemo<SymbolMenuApi>(() => ({ open: setInstrument }), []);

  return (
    <SymbolMenuContext.Provider value={api}>
      {children}
      <SymbolMenuSheet instrument={instrument} onClose={() => setInstrument(null)} />
    </SymbolMenuContext.Provider>
  );
}

function SymbolMenuSheet({
  instrument,
  onClose,
}: {
  instrument: Instrument | null;
  onClose: () => void;
}) {
  const { data: markets } = useMarkets();
  const quote = instrument ? markets?.quotes[instrument.id] : undefined;
  const live = useLivePrice(instrument?.coinKey);
  const anchor = live ?? quote?.last ?? null;
  const decimals = priceDecimalsFor(instrument?.priceDecimals ?? 2, anchor);
  const isOutcome = instrument?.assetClass === 'outcome';
  const displayPrice = (value: number | null | undefined) =>
    isOutcome ? formatProbability(value) : formatPrice(value, decimals);

  const prev = quote?.prevClose ?? null;
  const changePct =
    anchor !== null && prev !== null && prev !== 0
      ? ((anchor - prev) / prev) * 100
      : (quote?.change24hPct ?? null);

  const alerts = useAlertsFor(instrument?.id);
  const add = useAlerts((s) => s.add);
  const remove = useAlerts((s) => s.remove);
  const rearm = useAlerts((s) => s.rearm);

  const activeId = useWatchlists((s) => s.activeId);
  const toggleWatch = useWatchlists((s) => s.toggle);
  const watched = useWatchlists((s) =>
    instrument
      ? (s.lists.find((l) => l.id === s.activeId)?.symbolIds.includes(instrument.id) ?? false)
      : false,
  );

  const [direction, setDirection] = useState<AlertDirection>('both');
  const [pctText, setPctText] = useState('10');

  // Reset the form when a different symbol opens the sheet. Adjusting state
  // during render (rather than in an effect) skips a wasted commit.
  const [formFor, setFormFor] = useState(instrument?.id);
  if (instrument?.id !== formFor) {
    setFormFor(instrument?.id);
    setDirection('both');
    setPctText('10');
  }

  const createAlert = useCallback(
    (pct: number, dir: AlertDirection) => {
      if (!instrument || anchor == null || !(pct > 0)) return;
      add({
        instrumentId: instrument.id,
        symbol: instrument.symbol,
        pct: Math.round(pct * 100) / 100,
        direction: dir,
        anchorPrice: anchor,
      });
    },
    [instrument, anchor, add],
  );

  const customPct = parseFloat(pctText);
  const validCustom = Number.isFinite(customPct) && customPct > 0;
  const targetPreview =
    anchor == null || !validCustom
      ? null
      : direction === 'up'
        ? `→ ${displayPrice(anchor * (1 + customPct / 100))}`
        : direction === 'down'
          ? `→ ${displayPrice(anchor * (1 - customPct / 100))}`
          : `→ ${displayPrice(anchor * (1 - customPct / 100))} / ${displayPrice(anchor * (1 + customPct / 100))}`;

  const openChart = () => {
    if (!instrument) return;
    onClose();
    router.push({ pathname: '/symbol/[id]', params: { id: instrument.id } });
  };

  return (
    <Modal visible={!!instrument} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      {instrument ? (
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <AppText variant="heading">{instrument.symbol}</AppText>
                <View style={styles.metaRow}>
                  <VenueBadge venue={instrument.venue} />
                  <AppText variant="caption" muted numberOfLines={1} style={styles.name}>
                    {instrument.name}
                  </AppText>
                </View>
              </View>
              <View style={styles.headerRight}>
                <AppText variant="body" numeric>
                  {displayPrice(anchor)}
                </AppText>
                <AppText
                  variant="caption"
                  numeric
                  color={changePct === null ? Colors.textMuted : changePct >= 0 ? Colors.up : Colors.down}>
                  {isOutcome && anchor !== null && prev !== null
                    ? formatProbabilityPointChange(anchor - prev)
                    : formatPercent(changePct)}
                </AppText>
              </View>
            </View>

            {/* Alert builder */}
            <AppText variant="caption" muted style={styles.sectionLabel}>
              PRICE-MOVE ALERT
            </AppText>

            <View style={styles.segment}>
              {DIRECTIONS.map((d) => {
                const active = direction === d.key;
                return (
                  <Pressable
                    key={d.key}
                    onPress={() => setDirection(d.key)}
                    style={[styles.segmentItem, active && styles.segmentItemActive]}>
                    <Ionicons
                      name={d.icon}
                      size={14}
                      color={active ? Colors.text : Colors.textMuted}
                    />
                    <AppText variant="caption" color={active ? Colors.text : Colors.textMuted}>
                      {d.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.presetRow}>
              {PRESETS.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => createAlert(p, direction)}
                  disabled={anchor == null}
                  style={[styles.preset, anchor == null && styles.disabled]}>
                  <AppText variant="label" color={Colors.text}>
                    {p}%
                  </AppText>
                </Pressable>
              ))}
            </View>

            <View style={styles.customRow}>
              <View style={styles.inputWrap}>
                <TextInput
                  value={pctText}
                  onChangeText={setPctText}
                  keyboardType="decimal-pad"
                  placeholder="Custom"
                  placeholderTextColor={Colors.textFaint}
                  style={styles.input}
                />
                <AppText variant="body" muted>
                  %
                </AppText>
              </View>
              <Pressable
                onPress={() => createAlert(customPct, direction)}
                disabled={!validCustom || anchor == null}
                style={[styles.setBtn, (!validCustom || anchor == null) && styles.disabled]}>
                <Ionicons name="notifications" size={15} color="#04121A" />
                <AppText variant="label" color="#04121A">
                  Set alert
                </AppText>
              </Pressable>
            </View>
            {targetPreview ? (
              <AppText variant="caption" muted style={styles.preview}>
                From {displayPrice(anchor)} {targetPreview}
              </AppText>
            ) : null}

            {/* Existing alerts */}
            {alerts.length > 0 ? (
              <>
                <AppText variant="caption" muted style={styles.sectionLabel}>
                  ACTIVE ALERTS
                </AppText>
                <View style={styles.alertList}>
                  {alerts.map((a) => (
                    <AlertRow
                      key={a.id}
                      alert={a}
                      decimals={decimals}
                      probability={isOutcome}
                      onRemove={() => remove(a.id)}
                      onRearm={anchor == null ? undefined : () => rearm(a.id, anchor)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {/* Quick actions */}
            <View style={styles.actions}>
              <Pressable style={styles.action} onPress={openChart}>
                <Ionicons name="bar-chart-outline" size={18} color={Colors.text} />
                <AppText variant="body">Open chart</AppText>
              </Pressable>
              <View style={styles.actionDivider} />
              <Pressable
                style={styles.action}
                onPress={() => toggleWatch(activeId, instrument.id)}>
                <Ionicons
                  name={watched ? 'star' : 'star-outline'}
                  size={18}
                  color={watched ? Colors.warning : Colors.text}
                />
                <AppText variant="body">
                  {watched ? 'Remove from watchlist' : 'Add to watchlist'}
                </AppText>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

function AlertRow({
  alert,
  decimals,
  probability = false,
  onRemove,
  onRearm,
}: {
  alert: PriceAlert;
  decimals: number;
  probability?: boolean;
  onRemove: () => void;
  onRearm?: () => void;
}) {
  const dirSymbol = alert.direction === 'up' ? '▲' : alert.direction === 'down' ? '▼' : '±';
  const triggered = alert.triggeredAt != null;
  const displayPrice = (value: number | null) =>
    probability ? formatProbability(value) : formatPrice(value, decimals);
  return (
    <View style={styles.alertRow}>
      <View style={styles.alertInfo}>
        <AppText variant="label">
          {dirSymbol} {alert.pct}%
        </AppText>
        <AppText variant="caption" muted>
          {triggered
            ? `Fired @ ${displayPrice(alert.triggeredPrice)}`
            : `Armed from ${displayPrice(alert.anchorPrice)}`}
        </AppText>
      </View>
      <View style={styles.alertActions}>
        {triggered ? (
          <View style={styles.firedPill}>
            <AppText variant="caption" color={Colors.warning}>
              Triggered
            </AppText>
          </View>
        ) : (
          <View style={styles.armedPill}>
            <AppText variant="caption" color={Colors.up}>
              Armed
            </AppText>
          </View>
        )}
        {triggered && onRearm ? (
          <Pressable
            hitSlop={8}
            onPress={onRearm}
            accessibilityRole="button"
            accessibilityLabel="Re-arm alert">
            <Ionicons name="refresh" size={18} color={Colors.accent} />
          </Pressable>
        ) : null}
        <Pressable
          hitSlop={8}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel="Delete alert">
          <Ionicons name="trash-outline" size={18} color={Colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginTop: Spacing.sm,
  },
  content: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flex: 1, gap: 4 },
  headerRight: { alignItems: 'flex-end', gap: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { flexShrink: 1 },
  sectionLabel: { marginTop: Spacing.md, letterSpacing: 1 },
  segment: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },
  segmentItemActive: { backgroundColor: Colors.surfaceAlt },
  presetRow: { flexDirection: 'row', gap: Spacing.sm },
  preset: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
  },
  customRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  input: { flex: 1, color: Colors.text, fontSize: 16 },
  setBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
  },
  preview: { marginTop: 2 },
  disabled: { opacity: 0.4 },
  alertList: { backgroundColor: Colors.background, borderRadius: Radius.md, overflow: 'hidden' },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  alertInfo: { gap: 2 },
  alertActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  firedPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(240,185,11,0.12)',
  },
  armedPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(46,189,133,0.12)',
  },
  actions: {
    marginTop: Spacing.md,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  actionDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginLeft: Spacing.lg },
});
