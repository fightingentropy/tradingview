import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * Cross-platform "context menu" gesture for a Pressable:
 *  - web: real right-click (`contextmenu`), with the native browser menu suppressed
 *  - native: long-press
 *
 * Spread the returned props onto the Pressable. On web that's a `ref` (RN-Web
 * forwards it to the host DOM node); on native it's the long-press handlers.
 */
export function useContextMenuTrigger(onOpen: () => void) {
  // `any` so the same ref satisfies both Pressable's View ref (native) and a
  // DOM node (web), where RN-Web forwards the ref to the host element.
  const ref = useRef<any>(null);
  const handler = useRef(onOpen);
  useEffect(() => {
    handler.current = onOpen;
  });

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as {
      addEventListener?: typeof window.addEventListener;
      removeEventListener?: typeof window.removeEventListener;
    } | null;
    if (!node?.addEventListener) return;
    const onContextMenu = (e: Event) => {
      e.preventDefault();
      handler.current();
    };
    node.addEventListener('contextmenu', onContextMenu);
    return () => node.removeEventListener?.('contextmenu', onContextMenu);
  }, []);

  if (Platform.OS === 'web') {
    return { ref } as const;
  }
  return { onLongPress: onOpen, delayLongPress: 280 } as const;
}
