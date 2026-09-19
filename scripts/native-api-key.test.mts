import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { accountForApiKey } from '../src/lib/hyperliquid/apiKeyConnection';
import { clearAgentKey, getAgentKey, setAgentKey } from '../src/lib/hyperliquid/keyStore';
import { createApiKeyStore } from '../src/lib/hyperliquid/apiKeyStore';
import { addressFromPrivateKey } from '../src/lib/hyperliquid/sign';

// Public test fixture, never used against the real API.
const KEY = '0x0123456789012345678901234567890123456789012345678901234567890123';
const PREVIOUS_KEY = '0x1123456789012345678901234567890123456789012345678901234567890123';
const ACCOUNT = '0x2222222222222222222222222222222222222222';
const SIGNER = addressFromPrivateKey(KEY);

afterEach(async () => { mock.restoreAll(); await clearAgentKey(); });

test('one pasted key discovers the live account without sending or saving the secret', async () => {
  const requests: object[] = [];
  setAgentKey(PREVIOUS_KEY);
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.hyperliquid.xyz/info');
    const body = JSON.parse(init.body as string);
    requests.push(body);
    assert.equal((init.body as string).includes(KEY.slice(2)), false);
    return Response.json(body.user === SIGNER
      ? { role: 'agent', data: { user: ACCOUNT } }
      : { role: 'user' });
  });
  assert.equal(await accountForApiKey(`  ${KEY.toUpperCase()}  `), ACCOUNT);
  assert.deepEqual(requests, [
    { type: 'userRole', user: SIGNER },
    { type: 'userRole', user: ACCOUNT },
  ]);
  assert.equal(getAgentKey(), PREVIOUS_KEY);
});

test('incomplete and invalid signing keys fail before contacting Hyperliquid', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request'); });
  await assert.rejects(accountForApiKey('incomplete-test-key'), /looks incomplete/);
  await assert.rejects(accountForApiKey(`0x${'0'.repeat(64)}`), /not valid/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('deleted, expired, master-wallet and unsupported keys cannot replace the saved key', async () => {
  setAgentKey(PREVIOUS_KEY);
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json({ role: 'missing' }));
  for (const role of ['missing', 'user', 'subAccount', 'vault']) {
    fetch.mock.mockImplementation(async () => Response.json({ role }));
    await assert.rejects(accountForApiKey(KEY), /not active/);
    assert.equal(getAgentKey(), PREVIOUS_KEY);
  }
});

test('invalid account mappings and unavailable verification leave the saved key unchanged', async () => {
  setAgentKey(PREVIOUS_KEY);
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json({ role: 'agent' }));
  await assert.rejects(accountForApiKey(KEY), /Could not verify/);
  fetch.mock.mockImplementation(async (_url: string, init: RequestInit) => Response.json(
    JSON.parse(init.body as string).user === SIGNER
      ? { role: 'agent', data: { user: ACCOUNT } }
      : { role: 'subAccount' },
  ));
  await assert.rejects(accountForApiKey(KEY), /Could not verify/);
  fetch.mock.mockImplementation(async () => new Response('', { status: 503 }));
  await assert.rejects(accountForApiKey(KEY), /Could not verify/);
  assert.equal(getAgentKey(), PREVIOUS_KEY);
});

test('saving requires working secure storage and preserves the previous key if unavailable', () => {
  setAgentKey(PREVIOUS_KEY);
  assert.throws(() => setAgentKey(KEY, true), /Secure storage is unavailable/);
  assert.equal(getAgentKey(), PREVIOUS_KEY);
});


test('key removal waits, prevents concurrent replacement and verifies the stored value', async () => {
  let saved: string | null = PREVIOUS_KEY;
  let finish!: () => void;
  let deletes = 0;
  const store = createApiKeyStore({
    read: () => saved,
    write: (key) => { saved = key; },
    remove: () => { deletes++; return new Promise<void>((resolve) => { finish = () => { saved = null; resolve(); }; }); },
  });
  const removing = store.clear();
  assert.equal(store.get(), null, 'cannot sign while disconnecting');
  assert.throws(() => store.set(KEY, true), /disconnecting/);
  assert.equal(store.clear(), removing, 'duplicate removal shares the existing operation');
  assert.equal(deletes, 1);
  finish();
  await removing;
  assert.equal(saved, null);
  store.set(KEY, true);
  assert.equal(store.get(), KEY);
});

test('a rejected or ineffective key removal remains retryable and cannot report success', async () => {
  for (const failure of ['reject', 'no-op']) {
    let saved: string | null = PREVIOUS_KEY;
    let failing = true;
    const store = createApiKeyStore({
      read: () => saved, write: (key) => { saved = key; },
      remove: async () => {
        if (failing && failure === 'reject') throw new Error('native failure');
        if (!failing) saved = null;
      },
    });
    await assert.rejects(store.clear(), /Could not remove your saved API key/);
    assert.equal(store.get(), PREVIOUS_KEY);
    failing = false;
    await store.clear();
    assert.equal(store.get(), null);
  }
});

test('memory-only removal completes and allows a later connection', async () => {
  const store = createApiKeyStore(null);
  store.set(PREVIOUS_KEY);
  await store.clear();
  store.set(KEY);
  assert.equal(store.get(), KEY);
});
