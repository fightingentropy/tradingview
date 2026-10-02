import { expect, test } from 'bun:test';
import { runBriefStorageCommand, type CommandResult } from './daily-brief-storage';

const success = (stdout = '{}'): CommandResult => ({ status: 0, stdout, stderr: '' });
const failure = (stderr: string): CommandResult => ({ status: 1, stdout: '', stderr });
const noWait = async () => {};

test('an unauthorized KV read checks auth and retries the same key', async () => {
  const calls: string[][] = [];
  const delays: number[] = [];
  const result = await runBriefStorageCommand(['get', 'index:v1', '--text'], (args) => {
    calls.push(args);
    return calls.length === 1 ? failure('Failed to fetch /values/index%3Av1 - 401: Unauthorized') : success();
  }, async (ms) => { delays.push(ms); });
  expect(result).toBe('{}');
  expect(calls).toEqual([['get', 'index:v1', '--text'], ['whoami', '--json'], ['get', 'index:v1', '--text']]);
  expect(delays).toEqual([1_000]);
});

test('persistent auth failure stops after bounded retries and never becomes an absent key', async () => {
  let reads = 0;
  await expect(runBriefStorageCommand(['get', 'index:v1'], (args) => {
    if (args[0] === 'whoami') return success();
    reads += 1;
    return failure('Failed to fetch /values/index%3Av1 - 401: Unauthorized');
  }, noWait)).rejects.toThrow('401');
  expect(reads).toBe(4);
});

test('only an explicit 404 for the requested value is missing', async () => {
  expect(await runBriefStorageCommand(['get', 'edition:v1:2026-09-30'], () => failure('Failed to fetch /values/edition%3Av1%3A2026-09-30 - 404: Not Found'), noWait)).toBeNull();
  await expect(runBriefStorageCommand(['get', 'index:v1'], () => failure('Failed to fetch /accounts/missing - 404: Not Found'), noWait)).rejects.toThrow('publication stopped');
  await expect(runBriefStorageCommand(['get', 'index:v1'], () => failure('403: Forbidden'), noWait)).rejects.toThrow('403');
});

test('an uncertain write retries the identical payload after transport or rate-limit failures', async () => {
  const calls: string[][] = [];
  const responses = [failure('fetch failed'), failure('429: Too Many Requests'), success('written')];
  const command = ['put', 'edition:v1:2026-09-30', '--path', '/private/staged-payload.json'];
  expect(await runBriefStorageCommand(command, (args) => { calls.push(args); return responses.shift()!; }, noWait)).toBe('written');
  expect(calls).toEqual([command, command, command]);
});
