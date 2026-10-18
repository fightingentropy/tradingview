import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { cleanCoin } from '@/lib/accountPresentation';
import type { HlUserFunding } from '@/lib/hyperliquid/info';

interface Props {
  rows: readonly HlUserFunding[];
  selected: readonly string[];
  visibleCount: number;
  onChange: (tickers: string[]) => void;
}

export function FundingTickerFilter({ rows, selected, visibleCount, onChange }: Props) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = selected.length > 0;
  const label = !filtered
    ? 'All tickers'
    : selected.length <= 2
      ? selected.map(cleanCoin).join(', ')
      : `${selected.length} tickers`;

  const tickers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.coin, (counts.get(row.coin) ?? 0) + 1);
    // Keep saved selections available even after their payments leave the history window.
    for (const coin of selected) if (!counts.has(coin)) counts.set(coin, 0);
    return [...counts].sort(([a], [b]) => cleanCoin(a).localeCompare(cleanCoin(b)) || a.localeCompare(b));
  }, [rows, selected]);
  const query = search.trim().toLowerCase();
  const matches = tickers.filter(([coin]) => coin.toLowerCase().includes(query));
  const close = () => setOpen(false);

  return (
    <>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Filter funding by ticker: ${label}`}
          accessibilityState={{ expanded: open }}
          onPress={() => { setSearch(''); setOpen(true); }}
          style={[styles.trigger, filtered && styles.triggerActive]}>
          <Ionicons name="filter-outline" size={16} color={filtered ? Colors.accent : Colors.textMuted} />
          <AppText variant="label" numberOfLines={1} style={styles.triggerLabel} color={filtered ? Colors.accent : Colors.text}>
            {label}
          </AppText>
          <Ionicons name="chevron-down" size={14} color={Colors.textMuted} />
        </Pressable>
        <AppText variant="caption" numeric style={styles.count}>
          {filtered ? `${visibleCount} of ${rows.length}` : `${rows.length} payments`}
        </AppText>
        {filtered ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Show all funding tickers" onPress={() => onChange([])} style={styles.reset}>
            <AppText variant="label" color={Colors.accent}>Reset</AppText>
          </Pressable>
        ) : null}
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Close ticker filter" />
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.heading}>
                <AppText variant="heading">Filter tickers</AppText>
                <AppText variant="caption">Choose one or more tickers.</AppText>
              </View>
              <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close ticker filter" style={styles.close}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>
            <View style={styles.search}>
              <Ionicons name="search" size={18} color={Colors.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search tickers"
                placeholderTextColor={Colors.textFaint}
                accessibilityLabel="Search funding tickers"
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                clearButtonMode="while-editing"
                style={styles.searchInput}
              />
            </View>
            <Pressable
              onPress={() => onChange([])}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !filtered }}
              style={styles.option}>
              <AppText variant="label" style={styles.optionLabel}>All tickers</AppText>
              <AppText variant="caption" numeric>{rows.length}</AppText>
              <Ionicons name={!filtered ? 'checkbox' : 'square-outline'} size={22} color={!filtered ? Colors.accent : Colors.textFaint} />
            </Pressable>
            <ScrollView style={styles.options} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              {matches.map(([coin, count]) => {
                const checked = selected.includes(coin);
                return (
                  <Pressable
                    key={coin}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${cleanCoin(coin)}${coin.includes(':') ? `, ${coin.split(':')[0]}` : ''}`}
                    accessibilityState={{ checked }}
                    onPress={() => onChange(checked ? selected.filter((value) => value !== coin) : [...selected, coin])}
                    style={[styles.option, checked && styles.optionActive]}>
                    <View style={styles.optionLabel}>
                      <AppText variant="label">{cleanCoin(coin)}</AppText>
                      {coin.includes(':') ? <AppText variant="caption">{coin.split(':')[0].toUpperCase()}</AppText> : null}
                    </View>
                    <AppText variant="caption" numeric>{count}</AppText>
                    <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? Colors.accent : Colors.textFaint} />
                  </Pressable>
                );
              })}
              {matches.length === 0 ? <AppText muted style={styles.noMatches}>No matching tickers</AppText> : null}
            </ScrollView>
            <Pressable onPress={close} accessibilityRole="button" style={styles.done}>
              <AppText variant="label" color={Colors.background}>
                Show {visibleCount} {visibleCount === 1 ? 'payment' : 'payments'}
              </AppText>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.lg, marginVertical: Spacing.xs },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1, minHeight: 44, paddingHorizontal: Spacing.md, borderRadius: Radius.pill, backgroundColor: Colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  triggerActive: { backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  triggerLabel: { flexShrink: 1 },
  count: { flex: 1, textAlign: 'right' },
  reset: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.xs },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { maxHeight: '85%', backgroundColor: Colors.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, paddingHorizontal: Spacing.lg },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.textFaint, alignSelf: 'center', marginTop: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', marginVertical: Spacing.md },
  heading: { flex: 1, gap: Spacing.xs },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, backgroundColor: Colors.background, borderRadius: Radius.md, marginBottom: Spacing.sm },
  searchInput: { flex: 1, minHeight: 44, color: Colors.text, fontSize: 15 },
  options: { flexGrow: 0, flexShrink: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 52, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.md },
  optionActive: { backgroundColor: Colors.accentSoft },
  optionLabel: { flex: 1, gap: 2 },
  noMatches: { textAlign: 'center', padding: Spacing.xl },
  done: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.accent, borderRadius: Radius.pill, marginTop: Spacing.md },
});
