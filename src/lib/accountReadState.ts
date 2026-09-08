/** Cached data may remain visible after a refresh fails; missing data is never empty. */
export function accountReadState(input: {
  data: unknown;
  isError: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
}, freshForMs: number, now = Date.now()): 'loading' | 'error' | 'stale' | 'refreshing' | 'ready' {
  if (input.data === undefined) return input.isError ? 'error' : 'loading';
  if (input.isError || now - input.dataUpdatedAt > freshForMs) return 'stale';
  return input.isFetching ? 'refreshing' : 'ready';
}
