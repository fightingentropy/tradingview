import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

import { storeTelegramCredentials } from './telegram-keychain.mjs';

const input = createInterface({ input: stdin, output: stdout });
const apiId = Number(await input.question('Telegram API ID: '));
const apiHash = (await input.question('Telegram API hash: ')).trim();
if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) throw new Error('Invalid API ID or hash');

const session = new StringSession('');
const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
try {
  await client.start({
    phoneNumber: () => input.question('Telegram phone number (international format): '),
    phoneCode: () => input.question('Login code: '),
    password: () => input.question('Two-step verification password (if requested): '),
    onError: (error) => console.error(error.message),
  });
  await storeTelegramCredentials({ apiId, apiHash, session: client.session.save() });
  console.log('Telegram session stored in macOS Keychain.');
} finally {
  input.close();
  await client.disconnect();
}
