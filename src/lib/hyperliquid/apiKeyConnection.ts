import { fetchUserRole } from './info';
import { isValidPrivateKey, normalizeKey } from './keyStore';
import { addressFromPrivateKey } from './sign';
import { accountForVerifiedAgent, assertDirectMasterAccount } from './tradingIdentity';

/** Check a replacement before saving it. Only public addresses leave the device. */
export async function accountForApiKey(rawKey: string): Promise<string> {
  if (!isValidPrivateKey(rawKey)) {
    throw new Error('That key looks incomplete. Paste the full API key from Hyperliquid.');
  }

  let signer: string;
  try {
    signer = addressFromPrivateKey(normalizeKey(rawKey));
  } catch {
    throw new Error('That API key is not valid. Copy it again from Hyperliquid.');
  }

  try {
    const role = await fetchUserRole(signer, 'mainnet');
    if (role.role !== 'agent') {
      throw new Error('This key is not active. Use a new trading API key from your live Hyperliquid account.');
    }
    const account = accountForVerifiedAgent(signer, role);
    assertDirectMasterAccount(account, await fetchUserRole(account, 'mainnet'));
    return account;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('This key is not active.')) throw error;
    throw new Error('Could not verify your account. Check your connection and API key, then try again.');
  }
}
