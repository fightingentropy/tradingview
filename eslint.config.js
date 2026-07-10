// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Reanimated shared values and gesture-time frozen refs are intentionally
    // mutable. React Compiler's generic rules cannot model worklet primitives.
    files: ["src/components/PriceChart.tsx"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
    },
  },
  {
    // Animated.Value is an external mutable object by design.
    files: ["src/app/(tabs)/index.tsx"],
    rules: {
      "react-hooks/refs": "off",
    },
  },
]);
