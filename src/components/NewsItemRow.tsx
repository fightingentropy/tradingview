import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { NewsItem } from '@/domain/news';

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SourceMark({ source }: Pick<NewsItem, 'source'>) {
  if (source === 'x') {
    return (
      <View style={[styles.sourceMark, styles.xMark]}>
        <AppText style={styles.xGlyph}>𝕏</AppText>
      </View>
    );
  }
  if (source === 'digg') {
    return (
      <View style={[styles.sourceMark, styles.diggMark]}>
        <AppText style={styles.diggGlyph}>D</AppText>
      </View>
    );
  }
  return (
    <View style={[styles.sourceMark, styles.telegramMark]}>
      <Ionicons name="paper-plane" size={13} color="#FFFFFF" />
    </View>
  );
}

export function NewsItemRow({ item }: { item: NewsItem }) {
  const openItem = item.url ? () => Linking.openURL(item.url!) : undefined;
  const preview = item.media?.[0];

  return (
    <Pressable
      disabled={!openItem}
      onPress={openItem}
      accessibilityRole={openItem ? 'link' : undefined}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.header}>
        {item.author.avatarUrl ? (
          <Image source={item.author.avatarUrl} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={styles.avatarFallback}>
            <AppText style={styles.avatarLetter}>{item.author.name.slice(0, 1).toUpperCase()}</AppText>
          </View>
        )}
        <View style={styles.identity}>
          <View style={styles.nameLine}>
            <AppText style={styles.name} numberOfLines={1}>
              {item.author.name}
            </AppText>
            <SourceMark source={item.source} />
          </View>
          <AppText variant="caption" numberOfLines={1}>
            {item.author.handle ? `@${item.author.handle.replace(/^@/, '')} · ` : ''}
            {relativeTime(item.publishedAt)}
          </AppText>
        </View>
        {openItem ? <Ionicons name="open-outline" size={16} color={Colors.textFaint} /> : null}
      </View>

      <AppText style={styles.body}>{item.text}</AppText>

      {preview ? (
        <View style={styles.mediaWrap}>
          <Image source={preview.previewUrl} style={styles.media} contentFit="cover" />
          {preview.type === 'video' ? (
            <View style={styles.play}>
              <Ionicons name="play" color="#FFFFFF" size={16} />
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  pressed: { backgroundColor: Colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.surfaceAlt },
  avatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
  },
  avatarLetter: { fontSize: 15, fontWeight: '700' },
  identity: { flex: 1, minWidth: 0, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontSize: 14, fontWeight: '700' },
  sourceMark: {
    width: 18,
    height: 18,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  xMark: { backgroundColor: '#16181C', borderWidth: StyleSheet.hairlineWidth, borderColor: '#3B3F46' },
  telegramMark: { backgroundColor: '#229ED9' },
  diggMark: { backgroundColor: '#FF5C35' },
  xGlyph: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  diggGlyph: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  mediaWrap: {
    height: 190,
    marginTop: 2,
    overflow: 'hidden',
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  media: { width: '100%', height: '100%' },
  play: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 38,
    height: 38,
    marginLeft: -19,
    marginTop: -19,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
});
