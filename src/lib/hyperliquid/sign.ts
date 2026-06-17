/**
 * Hyperliquid L1-action signing (the "phantom agent" EIP-712 scheme used by the
 * /exchange endpoint). Pure JS so it runs in the RN bundle with no native crypto:
 *   connectionId = keccak256( msgpack(action) ++ nonce(8B BE) ++ vaultByte )
 *   digest       = keccak256( 0x1901 ++ domainSeparator ++ hashStruct(Agent) )
 *   {r,s,v}      = secp256k1(digest, agentKey)        // RFC-6979 deterministic
 *
 * Mirrors the reference Python SDK (hyperliquid-python-sdk `sign_l1_action`).
 * Numeric order fields are sent as strings (p, s) and small ints (a) so msgpack
 * bytes match the SDK exactly — the hash is byte-sensitive.
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { encode as msgpackEncode } from '@msgpack/msgpack';

export interface Signature {
  r: string;
  s: string;
  v: number;
}

const strip0x = (h: string) => (h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h);

function uintBE(value: number | bigint, bytes: number): Uint8Array {
  let v = BigInt(value);
  const out = new Uint8Array(bytes);
  for (let i = bytes - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Left-pad a 20-byte address to a 32-byte ABI word. */
function address32(addr: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(hexToBytes(strip0x(addr).toLowerCase()), 12);
  return out;
}

/**
 * keccak256 of msgpack(action) ++ nonce ++ vault marker. This is the EIP-712
 * `connectionId` (bytes32) that the phantom agent commits to.
 */
export function actionHash(action: unknown, vaultAddress: string | null, nonce: number): Uint8Array {
  const parts: Uint8Array[] = [msgpackEncode(action), uintBE(nonce, 8)];
  if (vaultAddress) {
    parts.push(Uint8Array.of(0x01), hexToBytes(strip0x(vaultAddress).toLowerCase()));
  } else {
    parts.push(Uint8Array.of(0x00));
  }
  return keccak_256(concatBytes(...parts));
}

const DOMAIN_TYPEHASH = keccak_256(
  utf8ToBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
);
const AGENT_TYPEHASH = keccak_256(utf8ToBytes('Agent(string source,bytes32 connectionId)'));

// domain = { name:"Exchange", version:"1", chainId:1337, verifyingContract:0x0 }
const DOMAIN_SEPARATOR = keccak_256(
  concatBytes(
    DOMAIN_TYPEHASH,
    keccak_256(utf8ToBytes('Exchange')),
    keccak_256(utf8ToBytes('1')),
    uintBE(1337, 32),
    address32('0x0000000000000000000000000000000000000000'),
  ),
);

function eip712Digest(source: 'a' | 'b', connectionId: Uint8Array): Uint8Array {
  const structHash = keccak_256(concatBytes(AGENT_TYPEHASH, keccak_256(utf8ToBytes(source)), connectionId));
  return keccak_256(concatBytes(Uint8Array.of(0x19, 0x01), DOMAIN_SEPARATOR, structHash));
}

/** Sign an L1 action with the agent key → {r,s,v} for the /exchange payload. */
export function signL1Action(
  privateKey: string,
  action: unknown,
  nonce: number,
  isMainnet: boolean,
  vaultAddress: string | null = null,
): Signature {
  const connectionId = actionHash(action, vaultAddress, nonce);
  const digest = eip712Digest(isMainnet ? 'a' : 'b', connectionId);
  const sig = secp256k1.sign(digest, strip0x(privateKey), { lowS: true });
  return {
    r: '0x' + sig.r.toString(16).padStart(64, '0'),
    s: '0x' + sig.s.toString(16).padStart(64, '0'),
    v: 27 + sig.recovery,
  };
}

/** The Ethereum/Hyperliquid address (0x, lowercase) for a private key. */
export function addressFromPrivateKey(privateKey: string): string {
  const pub = secp256k1.getPublicKey(strip0x(privateKey), false); // 65B: 0x04 ++ X ++ Y
  const hash = keccak_256(pub.slice(1)); // hash X||Y
  return '0x' + bytesToHex(hash.slice(-20));
}

/**
 * EIP-55 checksummed form of a 0x address: each hex letter is upper-cased when
 * the matching nibble of keccak256(lowercase-hex) is ≥ 8. Accepts any input
 * case and returns the canonical mixed-case `0x…` for display.
 */
export function toChecksumAddress(address: string): string {
  const lower = strip0x(address).toLowerCase();
  const hashHex = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i];
    out += c >= 'a' && c <= 'f' && parseInt(hashHex[i], 16) >= 8 ? c.toUpperCase() : c;
  }
  return out;
}

// ─── Wire formatting ─────────────────────────────────────────────────────────
// Hyperliquid order prices/sizes are decimal strings with strict precision:
//   sizes  → at most szDecimals decimals
//   prices → ≤5 significant figures AND ≤ (6 - szDecimals) decimals (perps);
//            integer prices are always allowed.

/** Decimal string with no exponent and no trailing zeros. */
function trimNum(x: number): string {
  if (!isFinite(x)) return '0';
  let s = x.toFixed(8);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

function roundSigFigs(x: number, sig: number): number {
  if (x === 0) return 0;
  const mag = Math.ceil(Math.log10(Math.abs(x)));
  const factor = Math.pow(10, sig - mag);
  return Math.round(x * factor) / factor;
}

export function sizeToWire(size: number, szDecimals: number): string {
  const f = Math.pow(10, szDecimals);
  return trimNum(Math.round(size * f) / f);
}

export function priceToWire(px: number, szDecimals: number, isPerp = true): string {
  if (Number.isInteger(px)) return String(px); // integer prices always valid
  const maxDecimals = (isPerp ? 6 : 8) - szDecimals;
  const capped = Math.pow(10, Math.max(0, maxDecimals));
  return trimNum(Math.round(roundSigFigs(px, 5) * capped) / capped);
}
