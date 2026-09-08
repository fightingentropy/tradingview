#!/usr/bin/env bun
/**
 * Push CUSTOM_AUTH_* variables from .env.local to the Convex deployment.
 * Run from project root. Requires CONVEX_DEPLOYMENT in .env.local.
 *
 *   bun run scripts/set-convex-auth-env.ts
 */
import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";

const envPath = join(import.meta.dir, "..", ".env.local");
const raw = readFileSync(envPath, "utf-8");

const vars: Record<string, string> = {};
for (const line of raw.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (key === "CONVEX_DEPLOYMENT" || key.startsWith("CUSTOM_AUTH_")) {
    vars[key] = value;
  }
}

const deployment = vars.CONVEX_DEPLOYMENT;
if (!deployment) {
  console.error("CONVEX_DEPLOYMENT not found in .env.local");
  process.exit(1);
}

const authVars = Object.entries(vars).filter(([k]) => k !== "CONVEX_DEPLOYMENT" && k.startsWith("CUSTOM_AUTH_"));
if (authVars.length === 0) {
  console.error("No CUSTOM_AUTH_* variables found in .env.local");
  process.exit(1);
}

process.env.CONVEX_DEPLOYMENT = deployment;

for (const [name, value] of authVars) {
  console.log(`Setting ${name}...`);
  // Values starting with ----- (e.g. PEM keys) are passed via stdin so the CLI doesn't treat them as options
  const useStdin = value.startsWith("-----");
  const r = useStdin
    ? spawnSync("bun", ["x", "convex", "env", "set", name], {
        input: value,
        stdio: ["pipe", "inherit", "inherit"],
        env: { ...process.env, CONVEX_DEPLOYMENT: deployment },
      })
    : spawnSync("bun", ["x", "convex", "env", "set", name, value], {
        stdio: "inherit",
        env: { ...process.env, CONVEX_DEPLOYMENT: deployment },
      });
  if (r.status !== 0) {
    console.error(`Failed to set ${name}`);
    process.exit(1);
  }
}

console.log("Done. Auth env vars are set for", deployment);
