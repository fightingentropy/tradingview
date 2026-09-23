import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/mmkv';
import type { Instrument } from '@/domain/types';
import { themedSymbols, WATCHLIST_THEMES, type WatchlistThemeId } from '@/domain/marketThemes';

export interface Watchlist {
  id: string;
  name: string;
  symbolIds: string[];
  theme?: WatchlistThemeId;
  /** All automatically discovered members, including any the user later removed. */
  knownSymbolIds?: string[];
}

interface WatchlistState {
  lists: Watchlist[];
  activeId: string;
  addedThemes: WatchlistThemeId[];
  syncThemes: (instruments: readonly Instrument[]) => void;
  setActive: (id: string) => void;
  createList: (name: string) => string;
  renameList: (id: string, name: string) => void;
  deleteList: (id: string) => void;
  toggle: (listId: string, instrumentId: string) => void;
  isInList: (listId: string, instrumentId: string) => boolean;
  reorder: (listId: string, symbolIds: string[]) => void;
  resetDefaults: () => void;
}

const freshDefaults = () => DEFAULT_LISTS.map((l) => ({ ...l, symbolIds: [...l.symbolIds] }));
let latestCatalog: readonly Instrument[] = [];

function withThemes(lists: Watchlist[], addedThemes: WatchlistThemeId[], instruments: readonly Instrument[]) {
  let nextLists = lists;
  let nextAdded = addedThemes;
  for (const theme of WATCHLIST_THEMES) {
    const members = themedSymbols(instruments, theme.id);
    if (!members.length) continue;
    const existing = nextLists.find((list) => list.theme === theme.id);
    if (!existing) {
      // Deleting a theme is intentional; future catalog refreshes must not recreate it.
      if (nextAdded.includes(theme.id)) continue;
      nextLists = [...nextLists, {
        id: `theme_${theme.id}`, name: theme.name, theme: theme.id,
        symbolIds: members, knownSymbolIds: members,
      }];
      nextAdded = [...nextAdded, theme.id];
      continue;
    }
    const known = new Set(existing.knownSymbolIds ?? existing.symbolIds);
    const additions = members.filter((id) => !known.has(id));
    if (!additions.length) continue;
    nextLists = nextLists.map((list) => list === existing ? {
      ...list,
      symbolIds: [...new Set([...list.symbolIds, ...additions])],
      knownSymbolIds: [...known, ...additions],
    } : list);
  }
  return { lists: nextLists, addedThemes: nextAdded };
}

/**
 * Seeded on first launch; ids must match the provider id scheme.
 * The default list mirrors the user's Raycast "stocks" extension watchlist
 * (its DEFAULT_TICKERS, all trade.xyz / `xyz` dex markets) plus BTC/ETH/HYPE/ZEC.
 * VIX is the real CBOE Volatility Index via the keyless Cboe provider (`cboe:VIX`),
 * placed in the same slot the Raycast extension uses (after MU).
 */
const DEFAULT_LISTS: Watchlist[] = [
  {
    id: 'main',
    name: 'Watchlist',
    symbolIds: [
      // Raycast "stocks" extension tickers → trade.xyz (xyz dex) markets
      'hl:xyz:SP500', // SPX
      'hl:xyz:XYZ100', // NDX
      'hl:xyz:NVDA',
      'hl:xyz:GOOGL',
      'hl:xyz:AMZN',
      'hl:xyz:TSLA',
      'hl:xyz:SPCX', // SPACEX
      'hl:xyz:HOOD',
      'hl:xyz:SNDK',
      'hl:xyz:MU',
      'cboe:VIX', // real CBOE Volatility Index (keyless, via Cboe)
      'hl:xyz:HIMS',
      'hl:xyz:LLY',
      'hl:xyz:LITE',
      // Crypto perps
      'hl:perp:BTC',
      'hl:perp:ETH',
      'hl:perp:HYPE',
      'hl:perp:ZEC',
    ],
  },
];

export const useWatchlists = create<WatchlistState>()(
  persist(
    (set, get) => ({
      lists: DEFAULT_LISTS,
      activeId: DEFAULT_LISTS[0].id,
      addedThemes: [],
      syncThemes: (instruments) => {
        latestCatalog = instruments;
        const current = get();
        const next = withThemes(current.lists, current.addedThemes, instruments);
        // Price refreshes must not rewrite the saved lists or trigger row rerenders.
        if (next.lists !== current.lists) set(next);
      },
      setActive: (id) => { if (get().lists.some((list) => list.id === id)) set({ activeId: id }); },
      createList: (name) => {
        const id = `wl_${name.toLowerCase().replace(/\s+/g, '-')}_${get().lists.length}`;
        set((s) => ({ lists: [...s.lists, { id, name, symbolIds: [] }], activeId: id }));
        return id;
      },
      renameList: (id, name) =>
        set((s) => ({ lists: s.lists.map((l) => (l.id === id ? { ...l, name } : l)) })),
      deleteList: (id) =>
        set((s) => {
          if (s.lists.length <= 1) return s;
          const lists = s.lists.filter((l) => l.id !== id);
          const activeId = s.activeId === id ? (lists[0]?.id ?? '') : s.activeId;
          return { lists, activeId };
        }),
      toggle: (listId, instrumentId) =>
        set((s) => ({
          lists: s.lists.map((l) => {
            if (l.id !== listId) return l;
            const has = l.symbolIds.includes(instrumentId);
            return {
              ...l,
              symbolIds: has
                ? l.symbolIds.filter((x) => x !== instrumentId)
                : [...l.symbolIds, instrumentId],
            };
          }),
        })),
      isInList: (listId, instrumentId) =>
        get().lists.find((l) => l.id === listId)?.symbolIds.includes(instrumentId) ?? false,
      reorder: (listId, symbolIds) =>
        set((s) => ({ lists: s.lists.map((l) => (l.id === listId ? { ...l, symbolIds } : l)) })),
      resetDefaults: () => set({ ...withThemes(freshDefaults(), [], latestCatalog), activeId: DEFAULT_LISTS[0].id }),
    }),
    {
      name: 'watchlists-v3',
      storage: createJSONStorage(() => mmkvStorage),
      version: 2,
      // Coerce a stale/garbage persisted shape into a valid one: `lists` must be
      // an array of lists, each with a string `id`/`name` and an array `symbolIds`.
      // Malformed entries are dropped so consumers can read `list.symbolIds` safely.
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<WatchlistState>;
        const validThemes = new Set<string>(WATCHLIST_THEMES.map((theme) => theme.id));
        const lists = (Array.isArray(s.lists) ? s.lists : [])
          .filter((l): l is Watchlist => !!l && typeof l.id === 'string' && typeof l.name === 'string')
          .map((l) => ({
            ...l,
            symbolIds: Array.isArray(l.symbolIds)
              ? l.symbolIds.filter((x): x is string => typeof x === 'string')
              : [],
            theme: l.theme && validThemes.has(l.theme) ? l.theme : undefined,
            knownSymbolIds: Array.isArray(l.knownSymbolIds)
              ? l.knownSymbolIds.filter((x): x is string => typeof x === 'string')
              : undefined,
          }));
        const safeLists = lists.length ? lists : freshDefaults();
        const activeId =
          typeof s.activeId === 'string' && safeLists.some((l) => l.id === s.activeId)
            ? s.activeId
            : safeLists[0].id;
        const addedThemes = [...new Set([
          ...(Array.isArray(s.addedThemes) ? s.addedThemes.filter((id) => validThemes.has(id)) : []),
          ...safeLists.flatMap((list) => list.theme ? [list.theme] : []),
        ])];
        return { ...s, lists: safeLists, activeId, addedThemes } as WatchlistState;
      },
    },
  ),
);
