import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';

import { useAlerts } from '@/store/alerts';
import { useChartSettings } from '@/store/chartSettings';
import { usePreferences } from '@/store/preferences';
import { useWatchlists } from '@/store/watchlists';

function WebSwitch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="web-switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} />
      <span><i /></span>
    </label>
  );
}

function SettingRow({ icon, title, detail, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; children: ReactNode }) {
  return (
    <div className="web-setting-row">
      <span className="web-setting-icon"><Ionicons name={icon} size={17} color="currentColor" /></span>
      <div><strong>{title}</strong><p>{detail}</p></div>
      <div className="web-setting-action">{children}</div>
    </div>
  );
}

export default function WebSettingsScreen() {
  const showClobOrderBook = usePreferences((state) => state.showClobOrderBook);
  const setShowClobOrderBook = usePreferences((state) => state.setShowClobOrderBook);
  const privacy = usePreferences((state) => state.privacyMode);
  const setPrivacy = usePreferences((state) => state.setPrivacyMode);
  const hideSmall = usePreferences((state) => state.hideSmallBalances);
  const setHideSmall = usePreferences((state) => state.setHideSmallBalances);
  const volume = useChartSettings((state) => state.volume);
  const toggleVolume = useChartSettings((state) => state.toggleVolume);
  const resetDefaults = useWatchlists((state) => state.resetDefaults);
  const alerts = useAlerts((state) => state.alerts);
  const removeAlert = useAlerts((state) => state.remove);

  const reset = () => {
    if (window.confirm('Restore the default watchlist? Your custom market order will be replaced.')) resetDefaults();
  };

  return (
    <div className="web-settings-layout web-xyz-settings-page">
      <section className="web-settings-intro">
        <div>
          <h1>Settings</h1>
          <p>Workspace, chart and local data preferences for this browser.</p>
        </div>
        <span className="web-xyz-settings-save"><i /> Saved locally</span>
      </section>

      <div className="web-settings-grid">
        <section>
          <div className="web-settings-section-title"><span>Workspace</span><small>3 preferences</small></div>
          <div className="web-settings-card web-panel">
            <SettingRow icon="grid-outline" title="CLOB order book" detail="Show live bid and ask depth beside the trading chart."><WebSwitch checked={showClobOrderBook} onChange={setShowClobOrderBook} label="Show CLOB order book" /></SettingRow>
            <SettingRow icon="eye-off-outline" title="Privacy mode" detail="Mask portfolio balances and position amounts."><WebSwitch checked={privacy} onChange={setPrivacy} label="Privacy mode" /></SettingRow>
            <SettingRow icon="layers-outline" title="Hide small balances" detail="Keep spot balances worth less than $1 out of the portfolio."><WebSwitch checked={hideSmall} onChange={setHideSmall} label="Hide small balances" /></SettingRow>
          </div>

          <div className="web-settings-section-title"><span>Chart defaults</span><small>Saved locally</small></div>
          <div className="web-settings-card web-panel">
            <SettingRow icon="bar-chart-outline" title="Volume" detail="Show market volume below the price series."><WebSwitch checked={volume} onChange={() => toggleVolume()} label="Show chart volume" /></SettingRow>
          </div>
        </section>

        <aside>
          <div className="web-settings-section-title"><span>Data sources</span><small>Coverage</small></div>
          <div className="web-source-card web-panel">
            <div><span className="web-source-orb"><Ionicons name="pulse" size={16} color="currentColor" /></span><span><strong>Hyperliquid</strong><small>Perps, spot and portfolio</small></span><em>Streamed</em></div>
            <div><span className="web-source-orb"><Ionicons name="trending-up" size={16} color="currentColor" /></span><span><strong>trade.xyz</strong><small>Equities, indices, FX</small></span><em>Streamed</em></div>
            <div><span className="web-source-orb is-delayed"><Ionicons name="time-outline" size={16} color="currentColor" /></span><span><strong>Cboe</strong><small>VIX index</small></span><em>Delayed</em></div>
          </div>

          <div className="web-settings-section-title"><span>Price alerts</span><small>{alerts.length} saved</small></div>
          <div className="web-alerts-card web-panel">
            {alerts.length ? alerts.slice(0, 5).map((alert) => (
              <div key={alert.id}><span><strong>{alert.symbol}</strong><small>{alert.direction} {alert.pct}% from anchor</small></span><button type="button" onClick={() => removeAlert(alert.id)} aria-label={`Remove ${alert.symbol} alert`}><Ionicons name="close" size={15} color="currentColor" /></button></div>
            )) : <p>No price alerts yet. Create one from a market detail page.</p>}
            <small className="web-alert-note"><Ionicons name="phone-portrait-outline" size={14} color="currentColor" /> Saved in this browser. Configure monitored alerts separately in the iPhone app.</small>
          </div>

          <div className="web-settings-section-title"><span>Watchlist</span><small>Local data</small></div>
          <button className="web-reset-card web-panel" type="button" onClick={reset}>
            <span className="web-setting-icon"><Ionicons name="refresh" size={17} color="currentColor" /></span>
            <span><strong>Restore defaults</strong><small>Reset the watchlist to the original market set.</small></span>
            <Ionicons name="chevron-forward" size={16} color="currentColor" />
          </button>
        </aside>
      </div>
    </div>
  );
}
