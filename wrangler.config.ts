import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig((ctx) => ({
  types: { generate: false },
  ...(ctx.mode === "web"
    ? {
        build: { command: "npm run web:export" },
        assetsDirectory: "web/dist",
        // The daily brief Workflow bundles docs/BRIEF.md as its editorial contract.
        rules: [{ type: "Text", globs: ["**/*.md"], fallthrough: true }],
      }
    : {}),
}));
