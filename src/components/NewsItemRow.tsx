import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { NewsColors, Radius, Spacing } from '@/constants/theme';
import type { NewsItem } from '@/domain/news';
import { NewsSourceIcon } from '@/components/NewsSourceIcon';

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

export function NewsItemRow({
  item,
  highlighted = false,
}: {
  item: NewsItem;
  highlighted?: boolean;
}) {
  const openItem = item.url ? () => Linking.openURL(item.url!) : undefined;
  const preview = item.media?.[0];

  return (
    <Pressable
      disabled={!openItem}
      onPress={openItem}
      accessibilityRole={openItem ? 'link' : undefined}
      accessibilityState={{ selected: highlighted }}
      style={({ pressed }) => [
        styles.row,
        highlighted && styles.highlighted,
        pressed && styles.pressed,
      ]}>
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
            <NewsSourceIcon source={item.source} size={18} />
          </View>
          <AppText variant="caption" numberOfLines={1}>
            {item.author.handle ? `@${item.author.handle.replace(/^@/, '')} · ` : ''}
            {relativeTime(item.publishedAt)}
          </AppText>
        </View>
        {openItem ? (
          <View style={styles.openButton}>
            <Ionicons name="arrow-up-outline" size={14} color={NewsColors.textMuted} />
          </View>
        ) : null}
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
    marginHorizontal: Spacing.lg,
    marginVertical: 5,
    padding: Spacing.lg,
    gap: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    borderRadius: 22,
    backgroundColor: NewsColors.surface,
  },
  highlighted: {
    borderColor: NewsColors.controlBorder,
    backgroundColor: NewsColors.surfaceRaised,
  },
  pressed: { backgroundColor: NewsColors.chip },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    backgroundColor: NewsColors.chip,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    backgroundColor: NewsColors.chip,
  },
  avatarLetter: { color: NewsColors.text, fontSize: 15, fontWeight: '700' },
  identity: { flex: 1, minWidth: 0, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, color: NewsColors.text, fontSize: 14, fontWeight: '700' },
  openButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: NewsColors.controlBorder,
  },
  body: { color: NewsColors.text, fontSize: 15, lineHeight: 21, fontWeight: '400' },
  mediaWrap: {
    height: 190,
    marginTop: 4,
    overflow: 'hidden',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NewsColors.border,
    backgroundColor: NewsColors.surfaceRaised,
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
