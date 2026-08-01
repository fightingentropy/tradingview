import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ORIGINAL_SOURCE_SHA256,
  PATCHED_SOURCE_SHA256,
  patchExpoModulesJsiSource,
  sourceSha256,
} from './patch-expo-modules-jsi.mjs';

const runtimePath = new URL(
  '../node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/JavaScriptRuntime.swift',
  import.meta.url,
);
const patchedSnippet = `    let setterPointer:
      (@convention(c) (UnsafeMutableRawPointer, UnsafePointer<CChar>, UnsafeMutableRawPointer) -> Void)? = setter
    let callbacks = expo.HostObjectCallbacks(
      context, getter, set == nil ? nil : setterPointer, propertyNamesGetter, deallocate)`;
const originalSnippet = `    let callbacks = expo.HostObjectCallbacks(
      context, getter, set == nil ? nil : setter, propertyNamesGetter, deallocate)`;

test('patch is pinned to the exact package source and exact output', async () => {
  const installedPatched = await readFile(runtimePath, 'utf8');
  assert.equal(sourceSha256(installedPatched), PATCHED_SOURCE_SHA256);
  const original = installedPatched.replace(patchedSnippet, originalSnippet);
  assert.equal(sourceSha256(original), ORIGINAL_SOURCE_SHA256);
  assert.equal(sourceSha256(patchExpoModulesJsiSource(original)), PATCHED_SOURCE_SHA256);
});

test('unexpected patch no-ops and source drift fail closed', async () => {
  const installedPatched = await readFile(runtimePath, 'utf8');
  assert.throws(() => patchExpoModulesJsiSource(installedPatched), /unexpectedly became a no-op/);
  assert.throws(() => patchExpoModulesJsiSource(`${installedPatched}\n// upstream drift`), /Unsupported/);
  assert.equal(
    patchExpoModulesJsiSource(installedPatched, { allowAlreadyPatched: true }),
    installedPatched,
  );
});
