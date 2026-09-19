import { networkIsOnline } from '@/lib/queryLifecycle';
import { focusManager, onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

/** One native lifecycle bridge for every query, rather than per-screen listeners. */
export function QueryLifecycle() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let disposed = false;
    let networkRevision = 0;
    const applyNetwork = (state: Network.NetworkState) => onlineManager.setOnline(networkIsOnline(state));
    const refreshNetwork = () => {
      const revision = networkRevision;
      void Network.getNetworkStateAsync().then((state) => {
        if (!disposed && revision === networkRevision) applyNetwork(state);
      }).catch(() => { /* Unknown connectivity must not freeze otherwise usable queries. */ });
    };
    focusManager.setFocused(AppState.currentState === 'active');
    const app = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
      if (state === 'active') refreshNetwork();
    });
    const network = Network.addNetworkStateListener((state) => {
      networkRevision += 1;
      applyNetwork(state);
    });
    refreshNetwork();
    return () => { disposed = true; app.remove(); network.remove(); };
  }, []);
  return null;
}
