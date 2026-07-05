/**
 * Testnet wire-format smoke test for TP/SL trigger orders.
 *
 * Posts the exact `action` JSON that buildTriggerWire + placeBracket/placePositionTpSl
 * produce to the Hyperliquid TESTNET /exchange endpoint, signed with a throwaway
 * key. The server deserializes the action into its typed order enum (validating
 * field names/types/grouping) BEFORE checking the account, so:
 *   - "does not exist" / "must deposit" / "insufficient" => wire parsed OK  ✓
 *   - "failed to deserialize" / "unknown variant" / "invalid type" => wire is WRONG ✗
 *
 * Run: npx tsx scripts/tpsl-testnet-smoke.mts
 */
import { randomBytes } from 'node:crypto';

import { buildTriggerWire } from '../src/lib/hyperliquid/exchange';
import { signL1Action } from '../src/lib/hyperliquid/sign';

const TESTNET = 'https://api.hyperliquid-testnet.xyz/exchange';
const KEY = '0x' + randomBytes(32).toString('hex'); // throwaway; no account exists for it

let nonce = Date.now();
const nextNonce = () => ++nonce;

// A well-formed entry wire (aggressive buy IOC) to head a normalTpsl bracket.
const entryWire = { a: 0, b: true, p: '52500', s: '0.001', r: false, t: { limit: { tif: 'Ioc' } } };

const ASSET = 0;
const SZD = 5;
// Long position (isBuy=false to close), tp above / sl below.
const tpLeg = buildTriggerWire({ assetIndex: ASSET, szDecimals: SZD, isBuy: false, reduceOnly: true, size: 0.001, leg: { tpsl: 'tp', triggerPx: 55000 }, slippage: 0.05 });
const slLeg = buildTriggerWire({ assetIndex: ASSET, szDecimals: SZD, isBuy: false, reduceOnly: true, size: 0.001, leg: { tpsl: 'sl', triggerPx: 45000 }, slippage: 0.05 });

const CASES: { name: string; action: object }[] = [
  { name: 'positionTpsl (tp+sl, reduce-only)', action: { type: 'order', orders: [tpLeg, slLeg], grouping: 'positionTpsl' } },
  { name: 'normalTpsl (entry + tp + sl)', action: { type: 'order', orders: [entryWire, tpLeg, slLeg], grouping: 'normalTpsl' } },
  { name: 'na (single reduce-only sl)', action: { type: 'order', orders: [slLeg], grouping: 'na' } },
];

const looksLikeFormatError = (s: string) =>
  /deserialize|unknown variant|invalid type|missing field|invalid value|expected/i.test(s);

let formatFail = 0;
for (const c of CASES) {
  const n = nextNonce();
  const signature = signL1Action(KEY, c.action, n, false /* testnet */);
  const res = await fetch(TESTNET, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: c.action, nonce: n, signature, vaultAddress: null }),
  });
  const text = await res.text();
  const bad = looksLikeFormatError(text);
  if (bad) formatFail++;
  console.log(`\n=== ${c.name} ===`);
  console.log(`HTTP ${res.status}  ${bad ? '✗ FORMAT ERROR' : '✓ wire parsed (account-level rejection expected)'}`);
  console.log(text.slice(0, 300));
}

console.log('');
if (formatFail === 0) {
  console.log('ALL TRIGGER ACTIONS ACCEPTED BY THE TESTNET DESERIALIZER ✓ (rejected only at the account check)');
  process.exit(0);
} else {
  console.log(`${formatFail}/${CASES.length} actions hit a WIRE-FORMAT error — do not ship`);
  process.exit(1);
}
