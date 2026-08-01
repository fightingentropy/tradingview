import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ORIGINAL = `    let callbacks = expo.HostObjectCallbacks(
      context, getter, set == nil ? nil : setter, propertyNamesGetter, deallocate)`;

const PATCHED = `    let setterPointer:
      (@convention(c) (UnsafeMutableRawPointer, UnsafePointer<CChar>, UnsafeMutableRawPointer) -> Void)? = setter
    let callbacks = expo.HostObjectCallbacks(
      context, getter, set == nil ? nil : setterPointer, propertyNamesGetter, deallocate)`;

export const SUPPORTED_EXPO_MODULES_JSI_VERSION = '56.0.12';
export const ORIGINAL_SOURCE_SHA256 = 'c9752a40dd1236cb73b00c701d07398648480c8f4ae8ad8ea4bc655cc78a65a7';
export const PATCHED_SOURCE_SHA256 = '8f5ca3a5624c9403e7542fd5f521934941eab2d05ee234151fedc03afc22f0b8';

export function sourceSha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

export function patchExpoModulesJsiSource(source, { allowAlreadyPatched = false } = {}) {
  const inputHash = sourceSha256(source);
  if (inputHash === PATCHED_SOURCE_SHA256) {
    if (allowAlreadyPatched) return source;
    throw new Error('expo-modules-jsi patch unexpectedly became a no-op: source is already patched');
  }
  if (inputHash !== ORIGINAL_SOURCE_SHA256 || !source.includes(ORIGINAL) || source.includes(PATCHED)) {
    throw new Error(`Unsupported expo-modules-jsi JavaScriptRuntime.swift input (${inputHash})`);
  }
  const patched = source.replace(ORIGINAL, PATCHED);
  const outputHash = sourceSha256(patched);
  if (outputHash !== PATCHED_SOURCE_SHA256) {
    throw new Error(`expo-modules-jsi patch produced an unexpected output (${outputHash})`);
  }
  return patched;
}

async function main() {
  const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const runtimePath = path.join(
    projectRoot,
    'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/JavaScriptRuntime.swift',
  );
  const packagePath = path.join(projectRoot, 'node_modules/expo-modules-jsi/package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  if (packageJson.version !== SUPPORTED_EXPO_MODULES_JSI_VERSION) {
    throw new Error(
      `Unsupported expo-modules-jsi version ${String(packageJson.version)}; expected ${SUPPORTED_EXPO_MODULES_JSI_VERSION}`,
    );
  }
  const source = await readFile(runtimePath, 'utf8');
  if (process.argv.includes('--verify')) {
    const hash = sourceSha256(source);
    if (hash !== PATCHED_SOURCE_SHA256) {
      throw new Error(`expo-modules-jsi patch verification failed (${hash})`);
    }
    return;
  }
  const patched = patchExpoModulesJsiSource(source, {
    allowAlreadyPatched: process.argv.includes('--allow-already-patched'),
  });
  if (patched !== source) await writeFile(runtimePath, patched);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
