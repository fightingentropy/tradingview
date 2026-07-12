import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import type { NewsSource } from '@/domain/news';

export function NewsSourceIcon({ source, size = 20 }: { source: NewsSource; size?: number }) {
  const radius = Math.max(5, Math.round(size * 0.28));
  if (source === 'telegram') {
    return (
      <View style={[styles.base, styles.telegram, { width: size, height: size, borderRadius: radius }]}>
        <Ionicons name="paper-plane" size={Math.round(size * 0.58)} color="#FFFFFF" />
      </View>
    );
  }
  return (
    <View style={[
      styles.base,
      source === 'x' ? styles.x : source === 'digg' ? styles.digg : styles.paste,
      { width: size, height: size, borderRadius: radius },
    ]}>
      <AppText style={[
        styles.glyph,
        { fontSize: Math.round(size * 0.55) },
        source === 'paste' && styles.pasteGlyph,
      ]}>
        {source === 'x' ? '𝕏' : source === 'digg' ? 'D' : 'P'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  x: { backgroundColor: '#16181C', borderWidth: StyleSheet.hairlineWidth, borderColor: '#3B3F46' },
  telegram: { backgroundColor: '#229ED9' },
  digg: { backgroundColor: '#FF5C35' },
  paste: { backgroundColor: '#F5F1EB' },
  glyph: { color: '#FFFFFF', fontWeight: '800', lineHeight: 14 },
  pasteGlyph: { color: '#171512' },
});
