import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAlertFeed, type AlertToast } from '@/store/alertFeed';

const VISIBLE_MS = 5000;

/** Renders the most recent fired-alert as a tappable banner at the top of the app. */
export function AlertHost() {
  const toasts = useAlertFeed((s) => s.toasts);
  const top = toasts[toasts.length - 1];
  if (!top) return null;
  return <Banner key={top.id} toast={top} />;
}

function Banner({ toast }: { toast: AlertToast }) {
  const insets = useSafeAreaInsets();
  const dismiss = useAlertFeed((s) => s.dismiss);
  // Lazy state initializer keeps one stable Animated.Value without reading a ref during render.
  const [translateY] = useState(() => new Animated.Value(-120));

  useEffect(() => {
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    const t = setTimeout(() => {
      Animated.timing(translateY, {
        toValue: -160,
        duration: 220,
        useNativeDriver: true,
      }).start(() => dismiss(toast.id));
    }, VISIBLE_MS);
    return () => clearTimeout(t);
  }, [toast.id, translateY, dismiss]);

  const up = toast.changePct >= 0;
  const onOpen = () => {
    dismiss(toast.id);
    router.push({ pathname: '/symbol/[id]', params: { id: toast.instrumentId } });
  };

  return (
    <Animated.View
      style={[styles.wrap, { paddingTop: insets.top + Spacing.sm, transform: [{ translateY }] }]}>
      <Pressable style={styles.banner} onPress={onOpen}>
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: up ? 'rgba(46,189,133,0.15)' : 'rgba(246,70,93,0.15)' },
          ]}>
          <Ionicons name="notifications" size={18} color={up ? Colors.up : Colors.down} />
        </View>
        <View style={styles.textWrap}>
          <AppText variant="label">{toast.symbol} price alert</AppText>
          <AppText variant="caption" numeric color={up ? Colors.up : Colors.down}>
            {toast.message}
          </AppText>
        </View>
        <Pressable hitSlop={10} onPress={() => dismiss(toast.id)}>
          <Ionicons name="close" size={18} color={Colors.textMuted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.md,
    zIndex: 1000,
    elevation: 1000,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  iconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1, gap: 2 },
});
