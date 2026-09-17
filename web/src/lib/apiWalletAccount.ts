// Resolve the account from Hyperliquid's authoritative userRole response. Never
// accept a normal wallet key or infer an account from balances or key ownership.
export function resolveApiWalletAccount(
  role: unknown,
  expectedAccount?: string,
): `0x${string}` {
  if (
    !role ||
    typeof role !== "object" ||
    !("role" in role) ||
    role.role !== "agent"
  ) {
    throw new Error(
      "This key is not an approved trading API key. Create one in Hyperliquid’s API settings, then paste it here.",
    );
  }
  const data = "data" in role ? role.data : undefined;
  const user =
    data && typeof data === "object" && "user" in data ? data.user : undefined;
  if (typeof user !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(user)) {
    throw new Error(
      "Hyperliquid could not identify the account for this key. Please try again.",
    );
  }
  const account = user.toLowerCase() as `0x${string}`;
  if (expectedAccount && account !== expectedAccount.trim().toLowerCase()) {
    throw new Error(
      "This key now belongs to a different account. Remove the saved connection and reconnect.",
    );
  }
  return account;
}
