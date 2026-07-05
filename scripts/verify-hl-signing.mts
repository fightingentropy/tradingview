/**
 * Signing regression gate for the Hyperliquid L1-action signer (src/lib/hyperliquid/sign.ts).
 *
 * Reproduces the two known signing vectors from the reference Python SDK
 * (hyperliquid-python-sdk tests/signing_test.py) BYTE-FOR-BYTE:
 *   - a plain limit order  (test_l1_action_signing_order_matches)
 *   - a trigger/tp-sl order (test_l1_action_signing_tpsl_order_matches)
 *
 * If either fails, the msgpack encoding / action-hash / phantom-agent / EIP-712
 * pipeline has drifted from the SDK and orders would be rejected or misplaced.
 * The trigger vector specifically guards the TP/SL wire shape and its exact
 * key order (isMarket, triggerPx, tpsl) — load-bearing because the action is
 * msgpack-packed and hashed.
 *
 * Run: npx tsx scripts/verify-hl-signing.mts
 */
import { encode as msgpackEncode } from '@msgpack/msgpack';

import { buildTriggerWire } from '../src/lib/hyperliquid/exchange';
import { signL1Action } from '../src/lib/hyperliquid/sign';

// Reference key from the SDK test (NOT a real account).
const KEY = '0x0123456789012345678901234567890123456789012345678901234567890123';

// The SDK builds these exact order wires (asset index = literal 1, not derived
// from "ETH"); nonce = 0; vault = None; expires_after = None.
const limitWire = { a: 1, b: true, p: '100', s: '100', r: false, t: { limit: { tif: 'Gtc' } } };
// Key order inside trigger MUST be isMarket, triggerPx, tpsl.
const tpslWire = { a: 1, b: true, p: '100', s: '100', r: false, t: { trigger: { isMarket: true, triggerPx: '103', tpsl: 'sl' } } };

const limitAction = { type: 'order', orders: [limitWire], grouping: 'na' };
const tpslAction = { type: 'order', orders: [tpslWire], grouping: 'na' };

interface Vector {
  name: string;
  action: unknown;
  isMainnet: boolean;
  r: string;
  s: string;
  v: number;
}

const VECTORS: Vector[] = [
  {
    name: 'plain-limit · mainnet',
    action: limitAction,
    isMainnet: true,
    r: '0xd65369825a9df5d80099e513cce430311d7d26ddf477f5b3a33d2806b100d78e',
    s: '0x2b54116ff64054968aa237c20ca9ff68000f977c93289157748a3162b6ea940e',
    v: 28,
  },
  {
    name: 'plain-limit · testnet',
    action: limitAction,
    isMainnet: false,
    r: '0x82b2ba28e76b3d761093aaded1b1cdad4960b3af30212b343fb2e6cdfa4e3d54',
    s: '0x6b53878fc99d26047f4d7e8c90eb98955a109f44209163f52d8dc4278cbbd9f5',
    v: 27,
  },
  {
    name: 'trigger/tpsl · mainnet',
    action: tpslAction,
    isMainnet: true,
    r: '0x98343f2b5ae8e26bb2587daad3863bc70d8792b09af1841b6fdd530a2065a3f9',
    s: '0x6b5bb6bb0633b710aa22b721dd9dee6d083646a5f8e581a20b545be6c1feb405',
    v: 27,
  },
  {
    name: 'trigger/tpsl · testnet',
    action: tpslAction,
    isMainnet: false,
    r: '0x971c554d917c44e0e1b6cc45d8f9404f32172a9d3b3566262347d0302896a2e4',
    s: '0x206257b104788f80450f8e786c329daa589aa0b32ba96948201ae556d5637eac',
    v: 28,
  },
];

let failed = 0;
for (const vec of VECTORS) {
  const sig = signL1Action(KEY, vec.action, 0, vec.isMainnet);
  const ok = sig.r === vec.r && sig.s === vec.s && sig.v === vec.v;
  if (ok) {
    console.log(`  ✓ ${vec.name}`);
  } else {
    failed++;
    console.log(`  ✗ ${vec.name}`);
    console.log(`      r  got ${sig.r}`);
    console.log(`         exp ${vec.r}`);
    console.log(`      s  got ${sig.s}`);
    console.log(`         exp ${vec.s}`);
    console.log(`      v  got ${sig.v}  exp ${vec.v}`);
  }
}

// ─── buildTriggerWire byte layout ────────────────────────────────────────────
// Prove the exchange.ts trigger-wire builder serializes to the canonical bytes:
// key order (a,b,p,s,r,t; isMarket,triggerPx,tpsl), the market-cross `p` bound,
// side, reduce-only, and price/size formatting — all in one msgpack byte-equality.
const hex = (v: unknown) => Buffer.from(msgpackEncode(v)).toString('hex');

interface WireCase {
  name: string;
  got: unknown;
  want: unknown;
}

const WIRE_CASES: WireCase[] = [
  {
    // Market SL closing a LONG: closing side = sell (b=false), reduce-only,
    // p = triggerPx*(1-0.05) = 2470 (aggressive bound below the trigger).
    name: 'buildTriggerWire · market SL closing long',
    got: buildTriggerWire({
      assetIndex: 5,
      szDecimals: 4,
      isBuy: false,
      reduceOnly: true,
      size: 2,
      leg: { tpsl: 'sl', triggerPx: 2600, isMarket: true },
      slippage: 0.05,
    }),
    want: { a: 5, b: false, p: '2470', s: '2', r: true, t: { trigger: { isMarket: true, triggerPx: '2600', tpsl: 'sl' } } },
  },
  {
    // Market TP closing a SHORT: closing side = buy (b=true),
    // p = triggerPx*(1+0.05) = 94.5 (aggressive bound above the trigger).
    name: 'buildTriggerWire · market TP closing short',
    got: buildTriggerWire({
      assetIndex: 5,
      szDecimals: 4,
      isBuy: true,
      reduceOnly: true,
      size: 1,
      leg: { tpsl: 'tp', triggerPx: 90, isMarket: true },
      slippage: 0.05,
    }),
    want: { a: 5, b: true, p: '94.5', s: '1', r: true, t: { trigger: { isMarket: true, triggerPx: '90', tpsl: 'tp' } } },
  },
  {
    // Limit trigger: p is the user's resting limit (no slippage padding); isMarket=false.
    name: 'buildTriggerWire · limit TP',
    got: buildTriggerWire({
      assetIndex: 5,
      szDecimals: 4,
      isBuy: true,
      reduceOnly: true,
      size: 1,
      leg: { tpsl: 'tp', triggerPx: 100, isMarket: false, limitPx: 101 },
    }),
    want: { a: 5, b: true, p: '101', s: '1', r: true, t: { trigger: { isMarket: false, triggerPx: '100', tpsl: 'tp' } } },
  },
];

for (const c of WIRE_CASES) {
  const ok = hex(c.got) === hex(c.want);
  if (ok) {
    console.log(`  ✓ ${c.name}`);
  } else {
    failed++;
    console.log(`  ✗ ${c.name}`);
    console.log(`      got  ${JSON.stringify(c.got)}`);
    console.log(`      want ${JSON.stringify(c.want)}`);
    console.log(`      bytes got  ${hex(c.got)}`);
    console.log(`      bytes want ${hex(c.want)}`);
  }
}

const total = VECTORS.length + WIRE_CASES.length;
console.log('');
if (failed === 0) {
  console.log(`ALL ${total} CHECKS PASS — signer + trigger wire match the SDK byte-for-byte ✓`);
  process.exit(0);
} else {
  console.log(`${failed}/${total} CHECKS FAILED — signer/wire has drifted from the SDK`);
  process.exit(1);
}
