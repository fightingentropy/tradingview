/** Turn notification transport/native errors into an action the user can take. */
export function notificationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/permission|enable .*notifications|notifications .*settings/i.test(message)) return 'Enable notifications in iPhone Settings, then retry.';
  if (/secure.?store|keychain|FunctionCallException|getValueWithKey|locked/i.test(message)) return 'Couldn’t access saved settings. Unlock your iPhone and retry.';
  if (/not configured|invalid response|project/i.test(message)) return 'Notifications are unavailable right now. Please try again later.';
  return 'Couldn’t refresh notifications. Check your connection and retry.';
}
