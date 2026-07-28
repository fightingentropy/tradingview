import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ORIGINAL = `    let callbacks = expo.HostObjectCallbacks(
      context, getter, set == nil ? nil : setter, propertyNamesGetter, deallocate)`;

const PATCHED = `    let setterPointer:
      (@convention(c) (UnsafeMutableRawPointer, UnsafePointer<CChar>, UnsafeMutableRawPointer) -> Void)? = setter
    let callbacks = expo.HostObjectCallbacks(
      context, getter, set == nil ? nil : setterPointer, propertyNamesGetter, deallocate)`;

export function patchExpoModulesJsiSource(source) {
  if (source.includes(PATCHED)) return source;
  if (!source.includes(ORIGINAL)) {
    throw new Error('Unsupported expo-modules-jsi JavaScriptRuntime.swift layout');
  }
  return source.replace(ORIGINAL, PATCHED);
}

async function main() {
  const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const runtimePath = path.join(
    projectRoot,
    'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/JavaScriptRuntime.swift',
  );
  const source = await readFile(runtimePath, 'utf8');
  const patched = patchExpoModulesJsiSource(source);
  if (patched !== source) await writeFile(runtimePath, patched);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
