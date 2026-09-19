/** Unknown connectivity is usable; a definite loss pauses requests until reconnect. */
export function networkIsOnline(state: { isConnected?: boolean; isInternetReachable?: boolean }) {
  return state.isConnected !== false && state.isInternetReachable !== false;
}
