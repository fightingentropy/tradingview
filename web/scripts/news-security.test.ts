import { beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveConfig } from 'vite';

const webRoot = resolve(import.meta.dirname, '..');
const headers = readFileSync(resolve(webRoot, 'public/_headers'), 'utf8');
const policy = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m)![1];
const directives = new Map(policy.split(';').map(directive => {
  const [name, ...sources] = directive.trim().split(/\s+/);
  return [name, sources] as const;
}));

// Match the explicit HTTPS origins and CDN subdomain patterns used by this policy.
function allowsOrigin(directive: string, origin: string) {
  const url = new URL(origin);
  return directives.get(directive)?.some(source => {
    if (source === url.origin) return true;
    const wildcard = source.match(/^https:\/\/\*\.(.+)$/);
    return !!wildcard && url.protocol === 'https:' && !url.port && url.hostname.endsWith(`.${wildcard[1]}`);
  }) ?? false;
}

let defines: Record<string, unknown> = {};
beforeAll(async () => {
  const config = await resolveConfig({ root: webRoot, configFile: resolve(webRoot, 'vite.config.ts') }, 'build', 'production');
  defines = config.define ?? {};
});

test('news uses the same-origin feed, so the build carries no relay access token', () => {
  expect(Object.keys(defines).filter(key => /NEWS_(FEED_URL|RELAY_ACCESS_TOKEN)/.test(key))).toEqual([]);
  expect(readFileSync(resolve(webRoot, 'src/lib/newsFeed.ts'), 'utf8')).toContain("fetch('/api/news?");
  expect(allowsOrigin('connect-src', 'https://tradingview-news-relay.erlinhoxha.workers.dev')).toBe(false);
  expect(allowsOrigin('connect-src', 'https://unrelated.workers.dev')).toBe(false);
});

test('the site policy permits news avatars and previews without opening arbitrary image origins', () => {
  for (const origin of [
    'https://pbs.twimg.com',
    'https://cdn1.telesco.pe',
    'https://cdn4.telesco.pe',
    'https://cdn5.telesco.pe',
    'https://cdn4.cdn-telegram.org',
    'https://digg.com',
    'https://app.paste.trade',
    'https://i.ytimg.com',
  ]) expect(allowsOrigin('img-src', origin), origin).toBe(true);
  expect(allowsOrigin('img-src', 'https://telesco.pe.evil.example')).toBe(false);
  expect(allowsOrigin('img-src', 'http://cdn1.telesco.pe')).toBe(false);
  expect(directives.get('script-src')).toEqual(["'self'", 'https://challenges.cloudflare.com']);
});

test('the HTML policy matches the response policy so neither blocks the permitted feeds', () => {
  const html = readFileSync(resolve(webRoot, 'index.html'), 'utf8');
  const htmlPolicy = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)![1];
  const expected = policy.split(';').map(value => value.trim()).filter(value => !value.startsWith('frame-ancestors '));
  // frame-ancestors is enforced by response headers, not by an HTML meta policy.
  expect(htmlPolicy.split(';').map(value => value.trim())).toEqual(expected);
});
