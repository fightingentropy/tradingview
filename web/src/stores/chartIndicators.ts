import { createEffect, createRoot, createSignal } from "solid-js";
import { restoreMaSettings, type MaPeriod } from "../lib/movingAverages";

// Retain the Trade page's existing saved choices in both chart views.
const STORAGE_KEY = "trade-xyz-chart-ma";
function load() {
  try { return restoreMaSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")); }
  catch { return restoreMaSettings(null); }
}

export const { maEnabled, toggleMa } = createRoot(() => {
  const [maEnabled, setMaEnabled] = createSignal(load());
  createEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(maEnabled())); } catch { /* storage unavailable */ }
  });
  return { maEnabled, toggleMa: (period: MaPeriod) => setMaEnabled(prev => ({ ...prev, [period]: !prev[period] })) };
});
