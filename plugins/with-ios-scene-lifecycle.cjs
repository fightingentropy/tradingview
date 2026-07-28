const {
  createRunOncePlugin,
  withAppDelegate,
  withInfoPlist,
} = require('@expo/config-plugins');

const LEGACY_WINDOW_START = `
#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;

const SCENE_DELEGATE = `
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    let browsingActivity = connectionOptions.userActivities.first {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: Self.launchOptions(
        url: connectionOptions.urlContexts.first?.url,
        userActivity: browsingActivity
      )
    )

    route(urlContexts: connectionOptions.urlContexts)
    connectionOptions.userActivities.forEach(route(userActivity:))
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    window = nil
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationDidEnterBackground(UIApplication.shared)
  }

  func scene(_ scene: UIScene, openURLContexts urlContexts: Set<UIOpenURLContext>) {
    route(urlContexts: urlContexts)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    route(userActivity: userActivity)
  }

  private static func launchOptions(
    url: URL?,
    userActivity: NSUserActivity?
  ) -> [UIApplication.LaunchOptionsKey: Any]? {
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url {
      launchOptions[
        UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsURLKey")
      ] = url
    }
    if let userActivity {
      launchOptions[
        UIApplication.LaunchOptionsKey(
          rawValue: "UIApplicationLaunchOptionsUserActivityDictionaryKey"
        )
      ] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": userActivity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": userActivity,
      ]
    }
    return launchOptions.isEmpty ? nil : launchOptions
  }

  private func route(urlContexts: Set<UIOpenURLContext>) {
    for context in urlContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace,
      ]
      if let sourceApplication = context.options.sourceApplication {
        options[.sourceApplication] = sourceApplication
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }

      _ = ExpoAppDelegateSubscriberManager.application(
        UIApplication.shared,
        open: context.url,
        options: options
      )
      _ = RCTLinkingManager.application(
        UIApplication.shared,
        open: context.url,
        options: options
      )
    }
  }

  private func route(userActivity: NSUserActivity) {
    _ = ExpoAppDelegateSubscriberManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}
`;

function applySceneLifecycleToAppDelegate(contents) {
  if (contents.includes('class SceneDelegate: UIResponder, UIWindowSceneDelegate')) {
    return contents;
  }

  if (!contents.includes(LEGACY_WINDOW_START)) {
    throw new Error('Could not find the Expo SDK 56 window-start block in AppDelegate.swift');
  }
  if (!contents.includes('\nclass ReactNativeDelegate: ExpoReactNativeFactoryDelegate')) {
    throw new Error('Could not find ReactNativeDelegate in AppDelegate.swift');
  }

  let next = contents;
  if (!next.includes('internal import ExpoModulesCore')) {
    next = next.replace(
      'internal import Expo\n',
      'internal import Expo\ninternal import ExpoModulesCore\n',
    );
  }
  next = next.replace(
    LEGACY_WINDOW_START,
    '\n    // SceneDelegate creates the window and starts React Native. The scene-based\n'
      + '    // lifecycle is required for apps linked with the iOS 27 SDK.\n',
  );
  return next.replace(
    '\nclass ReactNativeDelegate: ExpoReactNativeFactoryDelegate',
    `${SCENE_DELEGATE}\nclass ReactNativeDelegate: ExpoReactNativeFactoryDelegate`,
  );
}

function applySceneLifecycleToInfoPlist(infoPlist) {
  return {
    ...infoPlist,
    UIApplicationSceneManifest: {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    },
  };
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (configWithInfoPlist) => {
    configWithInfoPlist.modResults = applySceneLifecycleToInfoPlist(
      configWithInfoPlist.modResults,
    );
    return configWithInfoPlist;
  });

  return withAppDelegate(config, (configWithAppDelegate) => {
    if (configWithAppDelegate.modResults.language !== 'swift') {
      throw new Error('The iOS 27 scene lifecycle plugin requires a Swift AppDelegate');
    }
    configWithAppDelegate.modResults.contents = applySceneLifecycleToAppDelegate(
      configWithAppDelegate.modResults.contents,
    );
    return configWithAppDelegate;
  });
}

const plugin = createRunOncePlugin(
  withIosSceneLifecycle,
  'with-ios-scene-lifecycle',
  '1.0.0',
);

plugin.applySceneLifecycleToAppDelegate = applySceneLifecycleToAppDelegate;
plugin.applySceneLifecycleToInfoPlist = applySceneLifecycleToInfoPlist;

module.exports = plugin;
