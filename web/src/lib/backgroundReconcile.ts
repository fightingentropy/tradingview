/** An acknowledged action can finish while a fresh account read follows in the background. */
export const reconcileInBackground = (
  inFlight: Promise<unknown> | undefined,
  isCurrent: () => boolean,
  refresh: () => Promise<void>,
) => {
  // A read started before the acknowledgement may not include this action.
  // Wait for it, then request a new snapshot instead of joining the stale read.
  void Promise.resolve(inFlight).catch(() => undefined).then(async () => {
    if (isCurrent()) await refresh();
  }).catch(() => { /* The account store exposes its refresh error and retries. */ });
};
