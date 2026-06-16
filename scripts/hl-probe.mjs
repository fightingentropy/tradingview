// Dev probe: inspect live Hyperliquid Info-endpoint response shapes.
// Run: node scripts/hl-probe.mjs
const INFO = 'https://api.hyperliquid.xyz/info';

async function info(body) {
  const res = await fetch(INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${body.type} -> HTTP ${res.status}`);
  return res.json();
}

function preview(label, value) {
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(value, null, 2).slice(0, 1400));
}

const now = Date.now();

const [perp, spot, mids, dexs] = await Promise.all([
  info({ type: 'metaAndAssetCtxs' }),
  info({ type: 'spotMetaAndAssetCtxs' }),
  info({ type: 'allMids' }),
  info({ type: 'perpDexs' }).catch((e) => ({ error: String(e) })),
]);

console.log('perp: [meta, ctxs] lengths =', perp[0]?.universe?.length, perp[1]?.length);
preview('perp universe[0]', perp[0].universe[0]);
preview('perp ctx[0]', perp[1][0]);

console.log('\nspot: universe len =', spot[0]?.universe?.length, 'tokens len =', spot[0]?.tokens?.length);
preview('spot universe[0]', spot[0].universe[0]);
preview('spot ctx[0]', spot[1][0]);
preview('spot tokens[0..2]', spot[0].tokens.slice(0, 3));

const midKeys = Object.keys(mids);
console.log('\nallMids count =', midKeys.length, 'sample =', midKeys.slice(0, 6).map((k) => [k, mids[k]]));

preview('perpDexs', dexs);

// Candles for BTC perp
const candles = await info({
  type: 'candleSnapshot',
  req: { coin: 'BTC', interval: '1h', startTime: now - 6 * 3600_000, endTime: now },
});
console.log('\nBTC 1h candles returned =', candles.length);
preview('candle[last]', candles[candles.length - 1]);
