import assert from 'node:assert/strict';

import {
  accountForVerifiedAgent,
  assertDirectMasterAccount,
  assertTradingIdentityCurrent,
  signedIdentityBinding,
  signingKeyForCurrentFingerprint,
  TradingIdentityError,
  type VerifiedSignedTradingIdentity,
} from '../src/lib/hyperliquid/tradingIdentity';
import { clearAgentKey, setAgentKey } from '../src/lib/hyperliquid/keyStore';
import { addressFromPrivateKey } from '../src/lib/hyperliquid/sign';

const SIGNER = '0x1111111111111111111111111111111111111111';
const MASTER = '0x2222222222222222222222222222222222222222';

assert.equal(
  accountForVerifiedAgent(SIGNER.toUpperCase().replace('0X', '0x'), {
    role: 'agent',
    data: { user: MASTER.toUpperCase().replace('0X', '0x') },
  }),
  MASTER,
  'agent role resolves only to the returned master',
);

for (const role of ['user', 'vault', 'subAccount', 'missing'] as const) {
  assert.throws(
    () => accountForVerifiedAgent(SIGNER, { role }),
    TradingIdentityError,
    `${role} must not be accepted as an API-wallet signer`,
  );
}
assert.throws(
  () => accountForVerifiedAgent(SIGNER, { role: 'agent' }),
  TradingIdentityError,
  'agent without data.user must fail closed',
);
assert.doesNotThrow(() => assertDirectMasterAccount(MASTER, { role: 'user' }));
for (const role of ['subAccount', 'vault', 'missing', 'agent'] as const) {
  assert.throws(
    () => assertDirectMasterAccount(MASTER, { role }),
    TradingIdentityError,
    `${role} must not be accepted as a direct master execution target`,
  );
}

const identity: VerifiedSignedTradingIdentity = Object.freeze({
  status: 'verified-signer',
  network: 'mainnet',
  connectionAddress: MASTER,
  accountAddress: MASTER,
  signerAddress: SIGNER,
  keyFingerprint: SIGNER,
  verifiedAt: 1,
});
const binding = signedIdentityBinding(identity);
assert.ok(binding);
assert.doesNotThrow(() =>
  assertTradingIdentityCurrent(binding, {
    address: MASTER.toUpperCase().replace('0X', '0x'),
    network: 'mainnet',
    hasKey: true,
    demo: false,
  }),
);
assert.throws(
  () =>
    assertTradingIdentityCurrent(binding, {
      address: SIGNER,
      network: 'mainnet',
      hasKey: true,
      demo: false,
    }),
  TradingIdentityError,
  'changing the typed connection after review must fail',
);
assert.throws(
  () =>
    assertTradingIdentityCurrent(binding, {
      address: MASTER,
      network: 'testnet',
      hasKey: true,
      demo: false,
    }),
  TradingIdentityError,
  'changing the network after review must fail',
);
assert.throws(
  () =>
    assertTradingIdentityCurrent(binding, {
      address: MASTER,
      network: 'mainnet',
      hasKey: false,
      demo: false,
    }),
  TradingIdentityError,
  'removing the key after review must fail',
);

const TEST_KEY = '0x0123456789012345678901234567890123456789012345678901234567890123';
const TEST_SIGNER = addressFromPrivateKey(TEST_KEY);
const keyBinding = Object.freeze({
  ...binding,
  signerAddress: TEST_SIGNER,
  keyFingerprint: TEST_SIGNER,
});
setAgentKey(TEST_KEY);
assert.equal(
  signingKeyForCurrentFingerprint(keyBinding),
  TEST_KEY,
  'the final synchronous check returns only the reviewed signing key',
);
assert.throws(
  () => signingKeyForCurrentFingerprint(binding),
  TradingIdentityError,
  'a synchronously replaced key must fail before signing',
);
clearAgentKey();

console.log('  ✓ trading identity is fail-closed and transaction-bound');
