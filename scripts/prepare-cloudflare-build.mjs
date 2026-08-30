import { writeFile } from 'node:fs/promises';

const assetsIgnore = `server/
.openai/
`;

await writeFile('dist/.assetsignore', assetsIgnore);

console.log('Prepared the Expo export for Cloudflare Workers.');
