import { portfolioNumber } from './portfolioMetrics';

export interface AccountActivity {
  key: string;
  timestamp: number;
  type: string;
  label: string;
  amount: number | null;
  token: string | null;
  flow: 'in' | 'out' | 'internal' | 'other';
}

/** Display only reported ledger amounts. These records are never added to PNL. */
export function normalizeAccountActivity(raw: unknown, address: string): AccountActivity[] {
  if (!Array.isArray(raw)) throw new Error('Account activity is unavailable');
  const labels: Record<string, string> = {
    deposit: 'Deposit', withdraw: 'Withdrawal', internalTransfer: 'Transfer',
    accountClassTransfer: 'Wallet transfer', subAccountTransfer: 'Sub-account transfer',
    spotTransfer: 'Token transfer', vaultDeposit: 'Vault deposit', vaultWithdraw: 'Vault withdrawal',
    vaultDistribution: 'Vault distribution', rewardsClaim: 'Rewards claimed', liquidation: 'Liquidation',
  };
  const user = address.toLowerCase();
  return raw.map((row, index): AccountActivity => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Account activity contains an invalid record');
    const entry = row as Record<string, unknown>;
    const timestamp = portfolioNumber(entry.time);
    const delta = entry.delta as Record<string, unknown> | undefined;
    if (timestamp == null || !Number.isSafeInteger(timestamp) || timestamp <= 0 || !delta ||
      typeof delta !== 'object' || Array.isArray(delta) || typeof delta.type !== 'string' || !delta.type.trim()) {
      throw new Error('Account activity contains an invalid record');
    }
    const type = delta.type;
    const usdc = portfolioNumber(type === 'vaultWithdraw' ? delta.netWithdrawnUsd : delta.usdc);
    const tokenAmount = portfolioNumber(delta.amount);
    const token = typeof delta.token === 'string' ? delta.token.split(':')[0] : null;
    let flow: AccountActivity['flow'] = type === 'deposit' ? 'in' : type === 'withdraw' ? 'out'
      : type === 'accountClassTransfer' || type.startsWith('vault') ? 'internal' : 'other';
    if (['internalTransfer', 'subAccountTransfer', 'spotTransfer'].includes(type)) {
      const from = typeof delta.user === 'string' ? delta.user.toLowerCase() : '';
      const to = typeof delta.destination === 'string' ? delta.destination.toLowerCase() : '';
      if (from === user && to === user) flow = 'internal';
      else if (to === user) flow = 'in';
      else if (from === user) flow = 'out';
    }
    return {
      key: `${typeof entry.hash === 'string' ? entry.hash : type}-${timestamp}-${index}`,
      timestamp, type, label: type === 'vaultWithdraw' ? 'Vault withdrawal (net)' : labels[type] ?? type.replace(/([a-z])([A-Z])/g, '$1 $2'),
      amount: usdc ?? (token ? tokenAmount : null), token: usdc != null ? 'USDC' : token, flow,
    };
  }).sort((a, b) => b.timestamp - a.timestamp);
}
