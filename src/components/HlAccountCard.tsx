import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useTradingIdentity } from '@/data/useHlAccount';
import { accountForApiKey } from '@/lib/hyperliquid/apiKeyConnection';
import { toChecksumAddress } from '@/lib/hyperliquid/sign';
import { useHlConnection } from '@/store/hlConnection';

const short = (address: string) => {
  const value = toChecksumAddress(address);
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
};

export function HlAccountCard() {
  const address = useHlConnection((s) => s.address);
  const keyRevision = useHlConnection((s) => s.keyRevision);
  return address
    ? <ConnectedCard key={`${address}:${keyRevision}`} />
    : <ApiKeyForm />;
}

function ConnectedCard() {
  const address = useHlConnection((s) => s.address)!;
  const network = useHlConnection((s) => s.network);
  const hasKey = useHlConnection((s) => s.hasKey);
  const demo = useHlConnection((s) => s.demo);
  const disconnect = useHlConnection((s) => s.disconnect);
  const [editing, setEditing] = useState(false);
  const { data: identity, isError, isFetching, refetch } = useTradingIdentity();

  // Recheck on entry so a key deleted on Hyperliquid does not look connected.
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const live = network === 'mainnet';
  const verified = live && hasKey && !isError && identity?.status === 'verified-signer';
  const needsKey = !demo && (!hasKey || !live || (isError && !isFetching));
  const showForm = editing || needsKey;
  const status = demo ? 'Practice account'
    : !live ? 'Reconnect account'
    : isFetching ? 'Checking connection…'
    : verified ? 'Connected'
    : hasKey ? 'Connection needs attention' : 'View only';

  return (
    <>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            {isFetching ? <ActivityIndicator size="small" color={Colors.textMuted} />
              : <View style={[styles.dot, { backgroundColor: verified ? Colors.up : Colors.textMuted }]} />}
            <AppText variant="body">{status}</AppText>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <AppText variant="body">Account</AppText>
          <AppText variant="caption" muted style={styles.address}>
            {short(identity?.accountAddress ?? address)}
          </AppText>
        </View>
        {verified ? (
          <View style={styles.savedNote}>
            <Ionicons name="lock-closed-outline" size={14} color={Colors.textMuted} />
            <AppText variant="caption" muted>API key saved securely on this phone.</AppText>
          </View>
        ) : null}
        {!demo && !isFetching && hasKey && !verified ? (
          <AppText variant="caption" muted style={styles.connectionNote}>
            {live
              ? 'We couldn’t verify your saved key. If you deleted or replaced it in Hyperliquid, paste your new key below.'
              : 'Paste a key from your live Hyperliquid account to reconnect.'}
          </AppText>
        ) : null}
        {!showForm ? (
          <>
            <View style={styles.divider} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={hasKey && !demo ? 'Replace API key' : 'Connect Hyperliquid'}
              style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
              onPress={() => setEditing(true)}>
              <View style={styles.rowLeft}>
                <Ionicons name="key-outline" size={18} color={Colors.accent} />
                <AppText variant="body" color={Colors.accent}>
                  {hasKey && !demo ? 'Replace API key' : 'Connect Hyperliquid'}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textFaint} />
            </Pressable>
          </>
        ) : null}
      </View>

      {showForm ? (
        <ApiKeyForm
          replacing={hasKey && !demo}
          onCancel={needsKey ? undefined : () => setEditing(false)}
        />
      ) : null}

      <Pressable accessibilityRole="button" style={styles.disconnect} onPress={disconnect}>
        <AppText variant="caption" muted>{demo ? 'Exit practice account' : 'Disconnect account'}</AppText>
      </Pressable>
    </>
  );
}

function ApiKeyForm({ replacing = false, onCancel }: { replacing?: boolean; onCancel?: () => void }) {
  const [key, setKey] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(0);
  const pending = useRef(false);

  // Leaving Settings cancels an in-flight attempt and drops the unsaved key.
  useFocusEffect(useCallback(() => () => {
    attempt.current += 1;
    pending.current = false;
    setKey('');
    setShown(false);
    setBusy(false);
    setError(null);
  }, []));

  const connect = async () => {
    if (pending.current || !key.trim()) return;
    pending.current = true;
    const request = ++attempt.current;
    const previous = useHlConnection.getState();
    setBusy(true);
    setError(null);
    Keyboard.dismiss();
    try {
      const accountAddress = await accountForApiKey(key);
      if (request !== attempt.current) return;
      const current = useHlConnection.getState();
      if (current.address !== previous.address || current.network !== previous.network
        || current.keyRevision !== previous.keyRevision || current.demo !== previous.demo) {
        throw new Error('Your account changed while connecting. Please try again.');
      }
      current.connectVerifiedAccount(accountAddress, key);
      // The committed account remounts this card; no secret enters persisted app state.
    } catch (failure) {
      if (request === attempt.current) {
        setError(failure instanceof Error ? failure.message : 'Could not connect. Please try again.');
      }
    } finally {
      if (request === attempt.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <View style={[styles.card, styles.form]}>
      <View style={styles.formHeading}>
        <AppText variant="body" style={styles.heading}>
          {replacing ? 'Replace API key' : 'Connect Hyperliquid'}
        </AppText>
        {onCancel ? (
          <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8}>
            <AppText variant="caption" muted>Cancel</AppText>
          </Pressable>
        ) : null}
      </View>
      <AppText variant="caption" muted style={styles.description}>
        {replacing
          ? 'Paste your new key. We’ll check it before replacing the saved one.'
          : 'Paste your API key. We’ll find your account automatically.'}
      </AppText>

      <View style={styles.field}>
        <AppText variant="caption" muted>API key</AppText>
        <View style={styles.inputFrame}>
          <TextInput
            accessibilityLabel="API key"
            value={key}
            onChangeText={(value) => { setKey(value); setError(null); }}
            placeholder="Paste your Hyperliquid API key"
            placeholderTextColor={Colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            spellCheck={false}
            secureTextEntry={!shown}
            editable={!busy}
            returnKeyType="done"
            onSubmitEditing={() => { void connect(); }}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide API key' : 'Show API key'}
            hitSlop={8}
            onPress={() => setShown((value) => !value)}>
            <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={19} color={Colors.textMuted} />
          </Pressable>
        </View>
      </View>
      <AppText variant="caption" muted style={styles.description}>
        Use a trading API key, never your wallet’s private key or recovery phrase.
      </AppText>
      <Pressable
        accessibilityRole="link"
        onPress={() => { void Linking.openURL('https://app.hyperliquid.xyz/API').catch(() => setError('Could not open Hyperliquid. Try opening its API settings in your browser.')); }}>
        <AppText variant="caption" color={Colors.accent}>Get an API key ↗</AppText>
      </Pressable>

      {error ? <AppText accessibilityRole="alert" variant="caption" color={Colors.down} style={styles.description}>{error}</AppText> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || !key.trim(), busy }}
        disabled={busy || !key.trim()}
        style={[styles.primaryButton, (busy || !key.trim()) && styles.disabledButton]}
        onPress={() => { void connect(); }}>
        {busy ? <ActivityIndicator size="small" color={Colors.textMuted} /> : null}
        <AppText variant="label" color={busy || !key.trim() ? Colors.textFaint : Colors.background}>
          {busy ? 'Connecting…' : replacing ? 'Save and reconnect' : 'Connect account'}
        </AppText>
      </Pressable>
      <View style={styles.storageNote}>
        <Ionicons name="lock-closed-outline" size={13} color={Colors.textMuted} />
        <AppText variant="caption" muted style={styles.storageText}>
          Saved securely on this phone. Connects to your real account.
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10, backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 54, paddingHorizontal: 18, paddingVertical: 14,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 7, height: 7, borderRadius: 4 },
  address: { fontFamily: Fonts.mono },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 18, backgroundColor: Colors.border },
  actionRow: {
    minHeight: 58, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 18,
  },
  rowPressed: { backgroundColor: Colors.surfacePress },
  savedNote: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 18, paddingBottom: 16 },
  connectionNote: { paddingHorizontal: 18, paddingBottom: 16, lineHeight: 19 },
  disconnect: { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 14 },
  form: { padding: 18, gap: 14 },
  formHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: { fontWeight: '600', fontSize: 18 },
  description: { lineHeight: 19 },
  field: { gap: 8 },
  inputFrame: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  input: { flex: 1, minWidth: 0, minHeight: 50, color: Colors.text, fontSize: 14, paddingVertical: 12 },
  primaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 48, backgroundColor: Colors.accent, borderRadius: 8,
  },
  disabledButton: { backgroundColor: Colors.surfaceAlt },
  storageNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  storageText: { flex: 1, lineHeight: 17 },
});
