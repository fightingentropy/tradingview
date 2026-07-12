import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { GlassSurface } from '@/components/ui/GlassSurface';

const TRACK_WIDTH = 54;
const TRACK_HEIGHT = 32;
const THUMB_SIZE = 28;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - 4;

export function GlassToggle({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const [progress] = useState(() => new Animated.Value(value ? 1 : 0));

  useEffect(() => {
    Animated.spring(progress, {
      toValue: value ? 1 : 0,
      stiffness: 360,
      damping: 28,
      mass: 0.75,
      useNativeDriver: true,
    }).start();
  }, [progress, value]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, THUMB_TRAVEL],
  });

  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        void Haptics.selectionAsync();
        onValueChange(!value);
      }}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}>
      <GlassSurface
        style={[
          styles.track,
          { borderColor: value ? 'rgba(255,255,255,0.40)' : 'rgba(255,255,255,0.14)' },
        ]}
        tintColor={value ? 'rgba(255,255,255,0.34)' : 'rgba(0,0,0,0.72)'}
        interactive>
        <View
          pointerEvents="none"
          style={[
            styles.trackFill,
            {
              backgroundColor: disabled
                ? 'rgba(255,255,255,0.05)'
                : value
                  ? 'rgba(255,255,255,0.28)'
                  : 'rgba(255,255,255,0.035)',
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            value ? styles.thumbOn : styles.thumbOff,
            disabled && styles.thumbDisabled,
            { transform: [{ translateX }] },
          ]}>
          <View style={styles.thumbHighlight} />
        </Animated.View>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  trackFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  thumb: {
    position: 'absolute',
    top: 1.5,
    left: 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  thumbOn: { backgroundColor: '#050506', borderColor: 'rgba(255,255,255,0.32)' },
  thumbOff: { backgroundColor: '#F4F4F5', borderColor: 'rgba(255,255,255,0.72)' },
  thumbDisabled: { backgroundColor: '#68686D', borderColor: 'rgba(255,255,255,0.12)' },
  thumbHighlight: {
    position: 'absolute',
    top: 2,
    left: 6,
    right: 6,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.70)',
  },
});
