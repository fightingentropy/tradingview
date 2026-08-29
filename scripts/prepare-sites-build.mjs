import { mkdir, writeFile } from 'node:fs/promises';

const workerSource = `const SITE_ORIGIN_PLACEHOLDER = 'https://site-origin.invalid';

const DYNAMIC_ROUTES = [
  { pattern: /^\\/symbol\\/[^/]+\\/?$/, asset: '/symbol/[id].html' },
  { pattern: /^\\/outcomes\\/[^/]+\\/?$/, asset: '/outcomes/[id].html' },
];

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

async function fetchAsset(request, assets, pathname) {
  return assets.fetch(assetRequest(request, pathname));
}

async function withSiteOrigin(response, request) {
  const contentType = response.headers.get('content-type') ?? '';
  if (request.method !== 'GET' || !contentType.includes('text/html')) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const html = (await response.text()).replaceAll(
    SITE_ORIGIN_PLACEHOLDER,
    new URL(request.url).origin,
  );

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const direct = await env.ASSETS.fetch(request);

    if (direct.status !== 404 || !['GET', 'HEAD'].includes(request.method)) {
      return withSiteOrigin(direct, request);
    }

    const cleanPath = url.pathname === '/' ? '/index' : url.pathname.replace(/\\/$/, '');
    const candidates = [\`\${cleanPath}.html\`, \`\${cleanPath}/index.html\`];
    const dynamicRoute = DYNAMIC_ROUTES.find(({ pattern }) => pattern.test(url.pathname));

    if (dynamicRoute) {
      candidates.unshift(dynamicRoute.asset);
    }

    for (const pathname of candidates) {
      const response = await fetchAsset(request, env.ASSETS, pathname);
      if (response.status !== 404) {
        return withSiteOrigin(response, request);
      }
    }

    const notFound = await fetchAsset(request, env.ASSETS, '/+not-found.html');
    const response = new Response(notFound.body, {
      status: 404,
      headers: notFound.headers,
    });
    return withSiteOrigin(response, request);
  },
};
`;

await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', workerSource);

console.log('Prepared dist/server/index.js for Sites hosting.');
