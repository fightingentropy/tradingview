import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { GlassSurface } from '@/components/ui/GlassSurface';
import { AppText } from '@/components/ui/AppText';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useTradingIdentity } from '@/data/useHlAccount';
import type { HlNetwork } from '@/lib/hyperliquid/info';
import { isValidPrivateKey, setAgentKey } from '@/lib/hyperliquid/keyStore';
import { addressFromPrivateKey, toChecksumAddress } from '@/lib/hyperliquid/sign';
import { isHexAddress, useHlConnection } from '@/store/hlConnection';

/** EIP-55 checksum, then truncate for display: `0xAbC1…9FdE`. */
const short = (a: string) => {
  const c = toChecksumAddress(a);
  return `${c.slice(0, 6)}…${c.slice(-4)}`;
};

/**
 * Connect / manage the Hyperliquid account from Settings. The public address
 * powers the read-only Account screen; the optional API-wallet ("agent") key
 * unlocks trading and is stored encrypted on-device, never synced.
 */
export function HlAccountCard() {
  const address = useHlConnection((s) => s.address);
  const network = useHlConnection((s) => s.network);
  const hasKey = useHlConnection((s) => s.hasKey);
  const demo = useHlConnection((s) => s.demo);
  const setAddress = useHlConnection((s) => s.setAddress);
  const setNetwork = useHlConnection((s) => s.setNetwork);
  const refreshKey = useHlConnection((s) => s.refreshKey);
  const disconnect = useHlConnection((s) => s.disconnect);

  if (address) {
    return (
      <ConnectedCard
        address={address}
        network={network}
        hasKey={hasKey}
        demo={demo}
        onAddKey={refreshKey}
        onDisconnect={disconnect}
      />
    );
  }

  return (
    <ConnectForm
      onConnect={(addr, net, key) => {
        if (key) setAgentKey(key);
        setNetwork(net);
        setAddress(addr);
        refreshKey();
      }}
    />
  );
}

// ─── Connected ───────────────────────────────────────────────────────────────

function ConnectedCard({
  address,
  network,
  hasKey,
  demo,
  onAddKey,
  onDisconnect,
}: {
  address: string;
  network: HlNetwork;
  hasKey: boolean;
  demo: boolean;
  onAddKey: () => void;
  onDisconnect: () => void;
}) {
  // The account we actually read (master behind the agent key), which may differ
  // from what was typed. While resolving we show the entered address; if resolution
  // fails we say so rather than silently presenting a possibly-wrong account.
  const { data: identity, error: identityError, isError, isFetching } = useTradingIdentity();
  const resolved = identity?.accountAddress;
  const resolveFailed = isError && !resolved;
  const signerVerified = identity?.status === 'verified-signer';
  const shownAddress = resolved ?? address;
  return (
    <>
      <GlassSurface style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <View style={[styles.dot, { backgroundColor: demo ? Colors.textMuted : Colors.text }]} />
            <AppText variant="body">{demo ? 'Demo account' : 'Connected'}</AppText>
          </View>
          {resolveFailed ? (
            <AppText variant="caption" color={Colors.down} style={styles.addr}>
              Couldn’t resolve account
            </AppText>
          ) : (
            <View style={styles.rowLeft}>
              {isFetching && !resolved ? <ActivityIndicator size="small" color={Colors.textMuted} /> : null}
              <AppText variant="caption" muted style={styles.addr}>
                {short(shownAddress)}
              </AppText>
            </View>
          )}
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <AppText variant="body">Network</AppText>
          <NetworkBadge network={network} />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <AppText variant="body">Trading</AppText>
          {demo ? (
            <AppText variant="caption" muted>
              Read-only
            </AppText>
          ) : hasKey && isFetching && !identity ? (
            <View style={styles.rowLeft}>
              <ActivityIndicator size="small" color={Colors.textMuted} />
              <AppText variant="caption" muted>
                Verifying API wallet…
              </AppText>
            </View>
          ) : hasKey && signerVerified ? (
            <View style={styles.rowLeft}>
              <Ionicons name="checkmark-circle" size={15} color={Colors.up} />
              <AppText variant="caption" color={Colors.up}>
                Verified · {short(identity.signerAddress)}
              </AppText>
            </View>
          ) : hasKey ? (
            <View style={styles.rowLeft}>
              <Ionicons name="close-circle" size={15} color={Colors.down} />
              <AppText variant="caption" color={Colors.down}>
                Blocked · identity mismatch
              </AppText>
            </View>
          ) : (
            <AppText variant="caption" muted>
              Add API key to trade
            </AppText>
          )}
        </View>
        {!demo && hasKey && !signerVerified && !isFetching ? (
          <>
            <View style={styles.divider} />
            <AppText variant="caption" color={Colors.down} style={styles.identityError}>
              {identityError instanceof Error
                ? identityError.message
                : 'Hyperliquid could not verify this API wallet against the connected master account.'}
            </AppText>
          </>
        ) : null}
      </GlassSurface>

      {/* Connected by address only — let them paste an agent key to enable trading. */}
      {!demo && !hasKey ? <AddKeyCard onSaved={onAddKey} /> : null}

      <GlassSurface style={styles.card} interactive>
        <Pressable
          style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
          onPress={onDisconnect}>
          <View style={styles.rowLeft}>
            <Ionicons name="log-out-outline" size={18} color={Colors.text} />
            <AppText variant="body">{demo ? 'Exit demo' : 'Disconnect'}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textFaint} />
        </Pressable>
      </GlassSurface>
    </>
  );
}

function AddKeyCard({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!isValidPrivateKey(key)) {
      setError('Enter a 64-character hex key (0x…).');
      return;
    }
    setAgentKey(key);
    setKey('');
    setError(null);
    onSaved();
  };

  return (
    <GlassSurface style={styles.card}>
      <View style={styles.fieldRow}>
        <SecretInput value={key} onChangeText={setKey} placeholder="API wallet key (0x…)" />
        <Pressable
          style={[styles.inlineBtn, !key && styles.inlineBtnDisabled]}
          onPress={save}
          disabled={!key}>
          <AppText variant="label" color={key ? Colors.text : Colors.textFaint}>
            Save
          </AppText>
        </Pressable>
      </View>
      {error ? (
        <AppText variant="caption" color={Colors.down} style={styles.fieldError}>
          {error}
        </AppText>
      ) : null}
    </GlassSurface>
  );
}

// ─── Connect form ────────────────────────────────────────────────────────────

function ConnectForm({
  onConnect,
}: {
  onConnect: (address: string, network: HlNetwork, key: string | null) => void;
}) {
  const [addr, setAddr] = useState('');
  const [key, setKey] = useState('');
  const [net, setNet] = useState<HlNetwork>('mainnet');
  const [error, setError] = useState<string | null>(null);

  const canConnect = !!(addr.trim() || key.trim());

  const connect = () => {
    const trimmedKey = key.trim();
    const hasAddr = isHexAddress(addr);
    const keyValid = trimmedKey ? isValidPrivateKey(trimmedKey) : false;

    if (trimmedKey && !keyValid) {
      setError('API wallet key must be a 64-character hex key.');
      return;
    }
    if (!hasAddr && !keyValid) {
      setError('Enter your account address or a valid API wallet key.');
      return;
    }
    // Address is optional when a key is given: derive the agent address and let the
    // account resolver map it to the master account that actually holds positions.
    let stored = hasAddr ? addr.trim() : '';
    if (!stored && keyValid) {
      try {
        stored = addressFromPrivateKey(trimmedKey);
      } catch {
        setError('Could not read that API wallet key.');
        return;
      }
    }
    setError(null);
    onConnect(stored, net, trimmedKey ? trimmedKey : null);
  };

  return (
    <>
      <GlassSurface style={styles.card}>
        <View style={styles.segment}>
          {(['mainnet', 'testnet'] as HlNetwork[]).map((n) => (
            <Pressable
              key={n}
              style={[styles.segmentItem, net === n && styles.segmentItemActive]}
              onPress={() => setNet(n)}>
              <AppText variant="label" color={net === n ? Colors.text : Colors.textMuted}>
                {n === 'mainnet' ? 'Mainnet' : 'Testnet'}
              </AppText>
            </Pressable>
          ))}
        </View>
        <View style={styles.divider} />
        <View style={styles.field}>
          <AppText variant="caption" muted>
            Main account address
          </AppText>
          <TextInput
            value={addr}
            onChangeText={setAddr}
            placeholder="0x… · optional if key set"
            placeholderTextColor={Colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={styles.input}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.field}>
          <AppText variant="caption" muted>
            API wallet key · optional
          </AppText>
          <SecretInput value={key} onChangeText={setKey} placeholder="0x… (enables trading)" />
        </View>
      </GlassSurface>

      <AppText variant="caption" muted style={styles.note}>
        {net === 'mainnet' ? 'Mainnet uses real funds. ' : 'Testnet uses test funds. '}
        Paste your API wallet key and we’ll detect your account automatically — the address field is only
        needed for read-only viewing. The agent key trades but can’t withdraw, and is stored in the device keychain.
      </AppText>

      {error ? (
        <AppText variant="caption" color={Colors.down} style={styles.note}>
          {error}
        </AppText>
      ) : null}

      <Pressable
        style={[styles.primaryBtn, !canConnect && styles.primaryBtnDisabled]}
        onPress={connect}
        disabled={!canConnect}>
        <Ionicons name="link" size={16} color={canConnect ? Colors.text : Colors.textFaint} />
        <AppText variant="label" color={canConnect ? Colors.text : Colors.textFaint}>
          Connect
        </AppText>
      </Pressable>
    </>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function SecretInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <View style={styles.secretRow}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        secureTextEntry={!shown}
        style={[styles.input, styles.secretInput]}
      />
      <Pressable hitSlop={8} onPress={() => setShown((s) => !s)}>
        <Ionicons name={shown ? 'eye-off' : 'eye'} size={18} color={Colors.textMuted} />
      </Pressable>
    </View>
  );
}

function NetworkBadge({ network }: { network: HlNetwork }) {
  const main = network === 'mainnet';
  return (
    <View style={styles.badge}>
      <AppText variant="caption" color={Colors.text}>
        {main ? 'Mainnet' : 'Testnet'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 13,
  },
  actionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.065)' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  addr: { fontFamily: Fonts.mono },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.075)',
  },

  field: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: 6 },
  input: {
    color: Colors.text,
    fontSize: 15,
    fontFamily: Fonts.mono,
    paddingVertical: Spacing.xs,
  },
  secretRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  secretInput: { flex: 1 },

  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  inlineBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  inlineBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.035)' },
  fieldError: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  identityError: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    lineHeight: 17,
  },

  segment: { flexDirection: 'row', padding: Spacing.xs, gap: Spacing.xs },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
  },
  segmentItemActive: { backgroundColor: 'rgba(255,255,255,0.10)' },

  note: { marginTop: Spacing.sm, marginHorizontal: Spacing.xs, lineHeight: 16 },

  badge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.20)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: Spacing.md,
    borderRadius: Radius.pill,
    marginTop: Spacing.sm,
  },
  primaryBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.035)' },
});
