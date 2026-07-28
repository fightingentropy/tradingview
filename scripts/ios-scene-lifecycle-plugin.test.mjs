import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { patchExpoModulesJsiSource } from './patch-expo-modules-jsi.mjs';

const require = createRequire(import.meta.url);
const plugin = require('../plugins/with-ios-scene-lifecycle.cjs');

const legacyAppDelegate = `internal import Expo
import React

class AppDelegate {
  func start() {
    let factory = ExpoReactNativeFactory()

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
}
`;

test('adds an idempotent iOS 27 scene lifecycle to the Expo 56 AppDelegate', () => {
  const updated = plugin.applySceneLifecycleToAppDelegate(legacyAppDelegate);

  assert.match(updated, /internal import ExpoModulesCore/);
  assert.match(updated, /class SceneDelegate: UIResponder, UIWindowSceneDelegate/);
  assert.doesNotMatch(updated, /UIWindow\(frame: UIScreen\.main\.bounds\)/);
  assert.equal(plugin.applySceneLifecycleToAppDelegate(updated), updated);
});

test('adds the single-window SceneDelegate manifest', () => {
  const updated = plugin.applySceneLifecycleToInfoPlist({ CFBundleName: 'TradingView' });

  assert.deepEqual(updated.UIApplicationSceneManifest, {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [
        {
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        },
      ],
    },
  });
  assert.equal(updated.CFBundleName, 'TradingView');
});

test('patches the Expo JSI setter for the Xcode 27 Swift compiler', () => {
  const original = `before
    let callbacks = expo.HostObjectCallbacks(
      context, getter, set == nil ? nil : setter, propertyNamesGetter, deallocate)
after`;
  const patched = patchExpoModulesJsiSource(original);

  assert.match(patched, /let setterPointer:/);
  assert.match(patched, /set == nil \? nil : setterPointer/);
  assert.equal(patchExpoModulesJsiSource(patched), patched);
});
