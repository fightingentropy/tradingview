import { fetchUserRole, type HlNetwork, type HlUserRole } from './info';
import { getAgentKey, isValidPrivateKey } from './keyStore';
import { addressFromPrivateKey } from './sign';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function normalizedAddress(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!ADDRESS_RE.test(normalized)) {
    throw new TradingIdentityError(`${label} is not a valid Hyperliquid address.`);
  }
  return normalized;
}

export class TradingIdentityError extends Error {
  override name = 'TradingIdentityError';
}

export interface ReadOnlyTradingIdentity {
  readonly status: 'verified-read-only';
  readonly network: HlNetwork;
  readonly connectionAddress: string;
  readonly accountAddress: string;
  readonly signerAddress: null;
  readonly keyFingerprint: null;
  readonly verifiedAt: number;
}

/**
 * Public, non-secret identity proof bound to an authenticated exchange action.
 * `keyFingerprint` is the API wallet's derived address; it lets a reviewed draft
 * detect a replaced key without retaining or comparing the private key itself.
 */
export interface SignedTradingIdentityBinding {
  readonly network: HlNetwork;
  readonly connectionAddress: string;
  readonly accountAddress: string;
  readonly signerAddress: string;
  readonly keyFingerprint: string;
}

export interface VerifiedSignedTradingIdentity extends SignedTradingIdentityBinding {
  readonly status: 'verified-signer';
  readonly verifiedAt: number;
}

export type TradingIdentity = ReadOnlyTradingIdentity | VerifiedSignedTradingIdentity;

export interface CurrentTradingConnection {
  readonly address: string | null;
  readonly network: HlNetwork;
  readonly hasKey: boolean;
  readonly demo: boolean;
}

/** Resolve an API-wallet role. Master keys, subaccounts, vaults, and missing roles fail closed. */
export function accountForVerifiedAgent(signerAddress: string, role: HlUserRole): string {
  const signer = normalizedAddress(signerAddress, 'API wallet address');
  if (role.role !== 'agent') {
    if (role.role === 'user') {
      throw new TradingIdentityError(
        'The stored key belongs to a master account, not an API wallet. Remove it and create a Hyperliquid API wallet key.',
      );
    }
    if (role.role === 'subAccount' || role.role === 'vault') {
      throw new TradingIdentityError(
        'Subaccount and vault execution requires an explicit vault address, which this app does not support. Trading is disabled.',
      );
    }
    throw new TradingIdentityError(
      'Hyperliquid does not recognize the stored key as an active API wallet. Trading is disabled.',
    );
  }

  const master = role.data?.user;
  if (!master) {
    throw new TradingIdentityError(
      'Hyperliquid did not return the master account for this API wallet. Trading is disabled.',
    );
  }
  const account = normalizedAddress(master, 'API wallet master account');
  if (account === signer) {
    throw new TradingIdentityError('The API wallet returned an invalid master-account mapping.');
  }
  return account;
}

/** vaultAddress is always null in this app, so the agent target must be a direct user. */
export function assertDirectMasterAccount(accountAddress: string, role: HlUserRole): void {
  normalizedAddress(accountAddress, 'API wallet master account');
  if (role.role !== 'user') {
    if (role.role === 'subAccount' || role.role === 'vault') {
      throw new TradingIdentityError(
        'This API wallet resolves to a subaccount or vault. This app does not set vaultAddress, so signed trading is disabled to prevent routing an action to the wrong account.',
      );
    }
    throw new TradingIdentityError(
      'Hyperliquid could not verify the API wallet target as a direct master account. Trading is disabled.',
    );
  }
}

function readOnlyAccountForRole(connectionAddress: string, role: HlUserRole): string {
  const entered = normalizedAddress(connectionAddress, 'Connected account');
  if (role.role === 'missing') {
    throw new TradingIdentityError('Hyperliquid does not recognize the connected address.');
  }
  if (role.role === 'agent') {
    const master = role.data?.user;
    if (!master) throw new TradingIdentityError('Hyperliquid did not return this API wallet’s master account.');
    return normalizedAddress(master, 'API wallet master account');
  }
  // User, vault, and subaccount addresses are valid read-only targets. Signed
  // execution for vault/subaccount would require vaultAddress and stays disabled.
  return entered;
}

/**
 * Resolve the connected account without any fallback. When a key exists, the
 * entered address must be either the verified API wallet or its exact master.
 */
export async function resolveTradingIdentity(
  connectionAddress: string,
  network: HlNetwork,
  useStoredKey = true,
): Promise<TradingIdentity> {
  const entered = normalizedAddress(connectionAddress, 'Connected account');
  const key = useStoredKey ? getAgentKey() : null;

  if (!key) {
    let role: HlUserRole;
    try {
      role = await fetchUserRole(entered, network);
    } catch (error) {
      throw new TradingIdentityError(
        `Could not verify the connected account with Hyperliquid: ${
          error instanceof Error ? error.message : 'network error'
        }`,
      );
    }
    return Object.freeze({
      status: 'verified-read-only',
      network,
      connectionAddress: entered,
      accountAddress: readOnlyAccountForRole(entered, role),
      signerAddress: null,
      keyFingerprint: null,
      verifiedAt: Date.now(),
    });
  }

  if (!isValidPrivateKey(key)) {
    throw new TradingIdentityError('The stored API wallet key is invalid. Trading is disabled.');
  }
  let signerAddress: string;
  try {
    signerAddress = normalizedAddress(addressFromPrivateKey(key), 'API wallet address');
  } catch {
    throw new TradingIdentityError('Could not derive an address from the stored API wallet key.');
  }

  let role: HlUserRole;
  try {
    role = await fetchUserRole(signerAddress, network);
  } catch (error) {
    throw new TradingIdentityError(
      `Could not verify the API wallet with Hyperliquid: ${
        error instanceof Error ? error.message : 'network error'
      }`,
    );
  }
  const accountAddress = accountForVerifiedAgent(signerAddress, role);
  let accountRole: HlUserRole;
  try {
    accountRole = await fetchUserRole(accountAddress, network);
  } catch (error) {
    throw new TradingIdentityError(
      `Could not verify the API wallet’s master account with Hyperliquid: ${
        error instanceof Error ? error.message : 'network error'
      }`,
    );
  }
  assertDirectMasterAccount(accountAddress, accountRole);
  if (entered !== signerAddress && entered !== accountAddress) {
    throw new TradingIdentityError(
      'The connected account does not match this API wallet’s verified master account. Trading is disabled.',
    );
  }

  return Object.freeze({
    status: 'verified-signer',
    network,
    connectionAddress: entered,
    accountAddress,
    signerAddress,
    keyFingerprint: signerAddress,
    verifiedAt: Date.now(),
  });
}

export function signedIdentityBinding(
  identity: TradingIdentity | null | undefined,
): SignedTradingIdentityBinding | null {
  if (!identity || identity.status !== 'verified-signer') return null;
  return Object.freeze({
    network: identity.network,
    connectionAddress: identity.connectionAddress,
    accountAddress: identity.accountAddress,
    signerAddress: identity.signerAddress,
    keyFingerprint: identity.keyFingerprint,
  });
}

/** Synchronous UI/store guard, called again immediately before exchange signing. */
export function assertTradingIdentityCurrent(
  expected: SignedTradingIdentityBinding,
  current: CurrentTradingConnection,
): void {
  const currentAddress = current.address?.trim().toLowerCase() ?? null;
  if (
    current.demo ||
    !current.hasKey ||
    current.network !== expected.network ||
    currentAddress !== expected.connectionAddress
  ) {
    throw new TradingIdentityError(
      'The selected account, network, or API wallet changed after review. No action was sent.',
    );
  }
}

/**
 * Synchronously re-read the exact key that is about to sign and bind it to the
 * reviewed public fingerprint. Call only after all awaited pre-sign checks.
 */
export function signingKeyForCurrentFingerprint(
  expected: SignedTradingIdentityBinding,
): string {
  const key = getAgentKey();
  if (!key || !isValidPrivateKey(key)) {
    throw new TradingIdentityError(
      'The reviewed API wallet key is no longer available. No action was sent.',
    );
  }
  let signerAddress: string;
  try {
    signerAddress = normalizedAddress(addressFromPrivateKey(key), 'API wallet address');
  } catch {
    throw new TradingIdentityError('The stored API wallet key is invalid. No action was sent.');
  }
  if (signerAddress !== expected.signerAddress || signerAddress !== expected.keyFingerprint) {
    throw new TradingIdentityError('The API wallet key changed after review. No action was sent.');
  }
  return key;
}

/**
 * Re-read the key and freshly query userRole before every signed mutation. This
 * proves the remote signer/master relationship; the key is synchronously read
 * again only after the action-specific validator completes.
 */
export async function verifySignedTradingIdentity(
  expected: SignedTradingIdentityBinding,
): Promise<VerifiedSignedTradingIdentity> {
  const key = getAgentKey();
  if (!key || !isValidPrivateKey(key)) {
    throw new TradingIdentityError('The reviewed API wallet key is no longer available. No action was sent.');
  }

  let signerAddress: string;
  try {
    signerAddress = normalizedAddress(addressFromPrivateKey(key), 'API wallet address');
  } catch {
    throw new TradingIdentityError('The stored API wallet key is invalid. No action was sent.');
  }
  if (signerAddress !== expected.signerAddress || signerAddress !== expected.keyFingerprint) {
    throw new TradingIdentityError('The API wallet key changed after review. No action was sent.');
  }

  let role: HlUserRole;
  try {
    role = await fetchUserRole(signerAddress, expected.network);
  } catch (error) {
    throw new TradingIdentityError(
      `Could not freshly verify the API wallet; no action was sent: ${
        error instanceof Error ? error.message : 'network error'
      }`,
    );
  }
  const accountAddress = accountForVerifiedAgent(signerAddress, role);
  let accountRole: HlUserRole;
  try {
    accountRole = await fetchUserRole(accountAddress, expected.network);
  } catch (error) {
    throw new TradingIdentityError(
      `Could not freshly verify the API wallet’s master account; no action was sent: ${
        error instanceof Error ? error.message : 'network error'
      }`,
    );
  }
  assertDirectMasterAccount(accountAddress, accountRole);
  if (accountAddress !== expected.accountAddress) {
    throw new TradingIdentityError(
      'The API wallet’s master account changed after review. No action was sent.',
    );
  }
  if (
    expected.connectionAddress !== expected.signerAddress &&
    expected.connectionAddress !== expected.accountAddress
  ) {
    throw new TradingIdentityError(
      'The reviewed account does not match the verified API wallet. No action was sent.',
    );
  }

  return Object.freeze({
    status: 'verified-signer',
    ...expected,
    verifiedAt: Date.now(),
  });
}
