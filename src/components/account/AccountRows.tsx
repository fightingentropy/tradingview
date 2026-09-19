import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';

import { SymbolLogo } from '@/components/SymbolLogo';
import { AppText } from '@/components/ui/AppText';
import { Colors } from '@/constants/theme';
import type { Instrument } from '@/domain/types';
import { accountReadState } from '@/lib/accountReadState';
import {
  type AccountRiskSummary
} from '@/lib/accountRisk';
import { formatPercent, formatPrice, priceDecimalsFor, signedUsd, usd } from '@/lib/format';
import { formatFundingRatePercent } from '@/lib/fundingHistory';
import type {
  HlBorrowLendInterest,
  HlFill,
  HlOpenOrder,
  HlPosition,
  HlSpotBalance,
  HlUserFunding,
} from '@/lib/hyperliquid/info';
import { fillNetPnl } from '@/lib/portfolioMetrics';

import { cleanCoin, displayPriceDecimals, fullWhen, historyTokenAmount, MASK, PositionProtectionLevels, qty, signMoneyExact, tokenAmt, usdExact, whenLabel } from '@/lib/accountPresentation';
import { styles } from './accountStyles';

export function OverviewMetric({ label, value, color, note }: { label: string; value: string; color?: string; note?: string }) {
  return <View style={styles.overviewMetric}><AppText variant="caption" muted>{label}</AppText><AppText numeric style={styles.overviewValue} color={color} numberOfLines={1} adjustsFontSizeToFit>{value}</AppText>{note ? <AppText style={styles.overviewNote} color={Colors.textFaint}>{note}</AppText> : null}</View>;
}

export const MAINTENANCE_WARNING_PCT = 50;
export const MAINTENANCE_URGENT_PCT = 75;
export const LIQUIDATION_WARNING_PCT = 20;
export const LIQUIDATION_URGENT_PCT = 10;
export const LEVERAGE_WARNING = 5;

export function RiskStrip({
  summary,
  hidden,
  compact = false,
  showWarnings = true,
}: {
  summary: AccountRiskSummary;
  hidden: boolean;
  compact?: boolean;
  showWarnings?: boolean;
}) {
  const maintenance = summary.maintenanceUsagePct;
  const maintenanceUrgent = maintenance != null && maintenance >= MAINTENANCE_URGENT_PCT;
  const maintenanceWarning = maintenance != null && maintenance >= MAINTENANCE_WARNING_PCT;
  const liquidation = summary.closestLiquidation;
  const liquidationUrgent =
    liquidation != null && liquidation.distancePct <= LIQUIDATION_URGENT_PCT;
  const liquidationWarning =
    liquidation != null && liquidation.distancePct <= LIQUIDATION_WARNING_PCT;
  const mask = (value: string) => (hidden ? MASK : value);
  if (compact && !maintenanceWarning && !liquidationWarning && (summary.effectiveLeverage ?? 0) < LEVERAGE_WARNING) return null;

  return (
    <View style={styles.riskCard}>
      {!compact && <View style={styles.riskMetrics}>
        <RiskMetric label="Margin usage" value={maintenance == null ? '—' : mask(`${maintenance.toFixed(1)}%`)} color={maintenanceUrgent ? Colors.down : maintenanceWarning ? Colors.warning : undefined} />
        <RiskMetric label="Leverage" value={summary.effectiveLeverage == null ? '—' : mask(`${summary.effectiveLeverage.toFixed(1)}×`)} />
        <RiskMetric label="Closest liq." value={liquidation ? mask(`${liquidation.distancePct.toFixed(1)}%`) : '—'} sub={liquidation ? (hidden ? MASK : cleanCoin(liquidation.coin)) : undefined} color={liquidationUrgent ? Colors.down : liquidationWarning ? Colors.warning : undefined} />
      </View>}

      {showWarnings && maintenanceWarning ? (
        <RiskWarning
          urgent={maintenanceUrgent}
          text={
            hidden
              ? 'Maintenance usage is elevated.'
              : `Maintenance uses ${maintenance!.toFixed(1)}% of perp equity${maintenanceUrgent ? ' — liquidation risk is high.' : '.'}`
          }
        />
      ) : null}
      {showWarnings && liquidationWarning ? (
        <RiskWarning
          urgent={liquidationUrgent}
          text={
            hidden
              ? 'A position is close to liquidation.'
              : `${cleanCoin(liquidation!.coin)} is ${liquidation!.distancePct.toFixed(1)}% from liquidation.`
          }
        />
      ) : null}
      {showWarnings && (summary.effectiveLeverage ?? 0) >= LEVERAGE_WARNING ? (
        <RiskWarning
          text={
            hidden
              ? 'Gross account leverage is elevated.'
              : `Gross exposure is ${summary.effectiveLeverage!.toFixed(1)}× perp equity.`
          }
        />
      ) : null}
    </View>
  );
}

export function RiskMetric({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <View style={styles.riskMetric}>
      <AppText variant="caption" muted numberOfLines={1}>
        {label}
      </AppText>
      <AppText
        numeric
        color={color}
        numberOfLines={1}
        style={styles.riskMetricValue}>
        {value}
      </AppText>
      {sub ? (
        <AppText variant="caption" color={Colors.textFaint} numberOfLines={1}>
          {sub}
        </AppText>
      ) : null}
    </View>
  );
}

export function RiskWarning({ text, urgent = false }: { text: string; urgent?: boolean }) {
  return (
    <View style={[styles.riskWarning, urgent && styles.riskWarningUrgent]}>
      <Ionicons
        name={urgent ? 'alert-circle' : 'warning'}
        size={13}
        color={urgent ? Colors.down : Colors.warning}
      />
      <AppText variant="caption" color={urgent ? Colors.down : Colors.warning} style={styles.riskWarningText}>
        {text}
      </AppText>
    </View>
  );
}

export function TabButton({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable testID={`account-tab-${label.toLowerCase().replaceAll(' ', '-')}`} accessibilityRole="tab" accessibilityState={{ selected: active }} style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <AppText variant="label" color={active ? Colors.text : Colors.textMuted}>
        {label}
      </AppText>
      {count != null ? (
        <View style={[styles.tabCount, active && styles.tabCountActive]}>
          <AppText variant="caption" color={active ? Colors.text : Colors.textFaint}>
            {count}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

// Memoized so a 5s account refetch only re-renders positions whose data actually
// changed (React Query structural-shares unchanged rows). The inline callbacks close
// over stable ids, so their identity is deliberately excluded from the comparison.
export const PositionCard = memo(PositionCardImpl, (prev, next) =>
  prev.p === next.p &&
  prev.instrument?.id === next.instrument?.id &&
  prev.protection === next.protection &&
  prev.expanded === next.expanded &&
  prev.busy === next.busy &&
  prev.hidden === next.hidden,
);

export function PositionCardImpl({
  p,
  instrument,
  protection,
  expanded,
  busy,
  hidden,
  onToggle,
  onChart,
  onLimitClose,
  onMarketClose,
  onReverse,
  onAdjustMargin,
  onSetTpSl,
}: {
  p: HlPosition;
  instrument: Instrument | undefined;
  protection: PositionProtectionLevels | undefined;
  expanded: boolean;
  busy: boolean;
  hidden: boolean;
  onToggle: () => void;
  onChart: () => void;
  onLimitClose: () => void;
  onMarketClose: () => void;
  onReverse: () => void;
  onAdjustMargin: () => void;
  onSetTpSl: () => void;
}) {
  const pnlColor = p.unrealizedPnl >= 0 ? Colors.up : Colors.down;
  const sideColor = p.side === 'long' ? Colors.up : Colors.down;
  const symbol = instrument?.symbol ?? cleanCoin(p.coin);
  const decimals = priceDecimalsFor(instrument?.priceDecimals ?? 6, p.markPx);
  const m = (s: string) => (hidden ? MASK : s);
  const tp = protection?.takeProfitPx;
  const sl = protection?.stopLossPx;
  const protectionLabel = hidden
    ? MASK
    : `${tp != null ? formatPrice(tp, decimals) : '—'} / ${
        sl != null ? formatPrice(sl, decimals) : '—'
      }`;

  return (
    <View style={styles.positionCard}>
      <View style={styles.positionBody}>
        <View style={styles.positionSummary}>
          <Pressable
            style={({ pressed }) => [
              styles.positionSummaryTapTarget,
              pressed && styles.positionSummaryPressed,
            ]}
            onPress={onToggle}
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${symbol} position`}
            accessibilityState={{ expanded }}>
            <View style={[styles.positionSummaryCell, styles.positionMarketCell]}>
              <AppText style={styles.positionColumnLabel}>Market</AppText>
              <View style={styles.marketValueRow}>
                <AppText
                  style={[styles.positionSymbol, { color: sideColor }]}
                  numberOfLines={1}>
                  {symbol}
                </AppText>
                <View style={[styles.positionLeverageBadge, { backgroundColor: sideColor + '16' }]}>
                  <AppText style={[styles.positionLeverageText, { color: sideColor }]} numeric>
                    {p.leverage}×
                  </AppText>
                </View>
              </View>
            </View>
            <PositionMetric
              label="Size"
              value={m(`${qty(p.size)} ${symbol}`)}
              color={sideColor}
            />
            <View style={[styles.positionSummaryCell, styles.positionPnlCell]}>
              <AppText style={styles.positionColumnLabel}>PNL (ROE %)</AppText>
              <View style={styles.pnlValueRow}>
                {busy ? (
                  <ActivityIndicator size="small" color={Colors.textMuted} />
                ) : (
                  <View style={styles.positionPnlText}>
                    <AppText
                      numeric
                      color={pnlColor}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.78}
                      style={styles.positionPnlAmount}>
                      {m(signedUsd(p.unrealizedPnl))}
                    </AppText>
                    <AppText
                      numeric
                      color={pnlColor}
                      numberOfLines={1}
                      style={styles.positionRoeText}>
                      {m(formatPercent(p.roe * 100))}
                    </AppText>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
          <Pressable
            onPress={onChart}
            hitSlop={8}
            style={({ pressed }) => [
              styles.positionChartButton,
              pressed && styles.actionBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${symbol} chart`}>
            <Ionicons name="open-outline" size={15} color={Colors.accent} />
          </Pressable>
        </View>

        {expanded ? (
          <View style={styles.positionDetails}>
          <View style={styles.gridRow}>
            <Cell label="Entry Price" value={formatPrice(p.entryPx, decimals)} />
            <Cell label="Mark Price" value={formatPrice(p.markPx, decimals)} />
            <Cell
              label="Liq. Price"
              value={p.liquidationPx != null ? formatPrice(p.liquidationPx, decimals) : '—'}
              color={p.liquidationPx != null ? Colors.warning : undefined}
            />
          </View>
          <View style={styles.gridRow}>
            <Cell label="Position Value" value={m(`${formatPrice(p.positionValue, 2)} USDC`)} />
            <Cell
              label="Margin"
              value={m(`${usd(p.marginUsed)} (${p.leverageType === 'isolated' ? 'Isolated' : 'Cross'})`)}
              onEdit={p.leverageType === 'isolated' ? onAdjustMargin : undefined}
            />
            <Cell label="TP / SL" value={protectionLabel} onEdit={onSetTpSl} />
          </View>
          <View style={styles.gridRow}>
            <Cell
              label="Funding"
              value={m(signedUsd(p.funding))}
              color={p.funding > 0 ? Colors.up : p.funding < 0 ? Colors.down : undefined}
            />
            <View style={styles.cell} />
            <View style={styles.cell} />
          </View>
        </View>
      ) : null}

      </View>

      <View style={styles.positionDivider} />
      <View style={styles.positionActions}>
        <PositionQuickAction label="Limit Close" onPress={onLimitClose} disabled={busy} />
        <PositionQuickAction label="Market Close" onPress={onMarketClose} disabled={busy} />
        <PositionQuickAction label="Reverse" onPress={onReverse} disabled={busy} />
        <Pressable
          style={({ pressed }) => [styles.collapseAction, pressed && styles.actionBtnPressed]}
          onPress={onToggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse position' : 'Expand position'}>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={Colors.text}
          />
        </Pressable>
      </View>
    </View>
  );
}

export function PositionMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.positionSummaryCell}>
      <AppText style={styles.positionColumnLabel}>{label}</AppText>
      <AppText
        numeric
        color={color}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.76}
        style={styles.positionPrimaryValue}>
        {value}
      </AppText>
    </View>
  );
}

export function PositionQuickAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const color = disabled ? Colors.textFaint : Colors.accent;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.quickAction,
        pressed && !disabled && styles.actionBtnPressed,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <AppText color={color} numberOfLines={1} style={styles.quickActionText}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function Cell({
  label,
  value,
  sub,
  color,
  onEdit,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  /** When set, the value becomes tappable and shows a pencil (e.g. adjust margin). */
  onEdit?: () => void;
}) {
  const valueRow = (
    <View style={styles.cellValueRow}>
      <AppText
        variant="label"
        numeric
        color={color}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        style={styles.cellValue}>
        {value}
      </AppText>
      {onEdit ? <Ionicons name="pencil" size={13} color={Colors.accent} /> : null}
    </View>
  );
  return (
    <View style={styles.cell}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      {onEdit ? (
        <Pressable onPress={onEdit} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Adjust ${label}`}>
          {valueRow}
        </Pressable>
      ) : (
        valueRow
      )}
      {sub ? (
        <AppText variant="caption" muted numberOfLines={1}>
          {sub}
        </AppText>
      ) : null}
    </View>
  );
}

export const SpotCard = memo(SpotCardImpl, (prev, next) =>
  prev.b === next.b &&
  prev.instrument?.id === next.instrument?.id &&
  prev.symbol === next.symbol &&
  prev.expanded === next.expanded &&
  prev.hidden === next.hidden,
);

export function SpotCardImpl({
  b,
  instrument,
  symbol,
  expanded,
  hidden,
  onToggle,
  onChart,
}: {
  b: HlSpotBalance;
  instrument: Instrument | undefined;
  symbol: string;
  expanded: boolean;
  hidden: boolean;
  onToggle: () => void;
  onChart: () => void;
}) {
  // Derived per-token price; USDC ≈ $1, others off the spot mid.
  const price = Math.abs(b.total) > 1e-9 ? b.usdValue / b.total : 0;
  const m = (s: string) => (hidden ? MASK : s);
  const coinAmt = (v: number) => `${tokenAmt(v)} ${symbol}`;
  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardHead, pressed && styles.pressed]}
        onPress={onToggle}>
        <SymbolLogo instrument={instrument} coin={b.coin} size={40} />
        <View style={styles.mid}>
          <AppText style={styles.symbol} numberOfLines={1}>
            {symbol}
          </AppText>
          {/* Collapsed: just the token amount — "available" lives in the detail so nothing truncates. */}
          <AppText style={styles.sub} numeric numberOfLines={1}>
            {hidden ? `${MASK} ${symbol}` : coinAmt(b.total)}
          </AppText>
        </View>
        <AppText
          style={[styles.spotValue, b.usdValue < 0 && styles.spotLiability]}
          numeric
          numberOfLines={1}>
          {b.priceKnown !== true ? '—' : m(`${b.usdValue < 0 ? '−' : ''}${usd(b.usdValue)}`)}
        </AppText>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={Colors.textFaint}
          style={styles.chevron}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.spotDetail}>
          {/* Key→value list reads cleaner than a 3-col grid for long token amounts. */}
          <DetailRow label="Total" value={hidden ? `${MASK} ${symbol}` : coinAmt(b.total)} />
          <DetailRow label="Available" value={hidden ? `${MASK} ${symbol}` : coinAmt(b.available)} />
          {b.hold > 1e-8 ? (
            <DetailRow label="In Orders" value={hidden ? `${MASK} ${symbol}` : coinAmt(b.hold)} />
          ) : null}
          <DetailRow
            label="Price"
            value={b.priceKnown !== true ? 'Unavailable' : `$${formatPrice(price, displayPriceDecimals(b.coin, instrument, price))}`}
          />
          <DetailRow label="USD Value" value={b.priceKnown !== true ? 'Unavailable' : m(`${b.usdValue < 0 ? '−' : ''}${usd(b.usdValue)}`)} strong />
          {instrument ? (
            <Pressable style={styles.chartLink} onPress={onChart} hitSlop={6}>
              <AppText variant="caption" color={Colors.accent}>
                View chart
              </AppText>
              <Ionicons name="chevron-forward" size={13} color={Colors.accent} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A label-left / value-right row; values line up on the right edge. */
export function DetailRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="label" numeric color={strong ? Colors.text : Colors.textMuted}>
        {value}
      </AppText>
    </View>
  );
}

export const OrderCard = memo(OrderCardImpl, (prev, next) =>
  prev.o === next.o &&
  prev.instrument?.id === next.instrument?.id &&
  prev.symbol === next.symbol &&
  prev.tradable === next.tradable &&
  prev.busy === next.busy &&
  prev.hidden === next.hidden,
);

export function OrderCardImpl({
  o,
  instrument,
  symbol,
  tradable,
  busy,
  hidden,
  onCancel,
}: {
  o: HlOpenOrder;
  instrument: Instrument | undefined;
  symbol: string;
  tradable: boolean;
  busy: boolean;
  hidden: boolean;
  onCancel: () => void;
}) {
  const decimals = displayPriceDecimals(o.coin, instrument, o.limitPx);
  const sideColor = o.side === 'buy' ? Colors.up : Colors.down;
  const filledPct = o.origSize > o.size ? ((o.origSize - o.size) / o.origSize) * 100 : 0;
  const typeLabel = o.isTrigger ? `Stop ${o.orderType}`.trim() : o.orderType;
  const m = (s: string) => (hidden ? MASK : s);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        {instrument ? (
          <SymbolLogo instrument={instrument} size={40} />
        ) : (
          <View style={styles.coinFallback}>
            <AppText variant="label">{symbol.slice(0, 3)}</AppText>
          </View>
        )}
        <View style={styles.mid}>
          <View style={styles.titleRow}>
            <AppText style={styles.symbol} numberOfLines={1}>
              {symbol}
            </AppText>
            <View style={[styles.sideBadge, { backgroundColor: sideColor + '22' }]}>
              <AppText variant="caption" color={sideColor}>
                {o.side === 'buy' ? 'Buy' : 'Sell'}
              </AppText>
            </View>
            {o.reduceOnly ? (
              <View style={styles.xyzBadge}>
                <AppText variant="caption" muted>
                  Reduce
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText style={styles.sub} numeric numberOfLines={1}>
            {m(`${qty(o.size)} ${symbol}`)} @ ${formatPrice(o.limitPx, decimals)}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {typeLabel} · {whenLabel(o.timestamp)}
            {filledPct > 0.5 ? ` · ${filledPct.toFixed(0)}% filled` : ''}
          </AppText>
        </View>
        {busy ? (
          <ActivityIndicator color={Colors.textMuted} />
        ) : (
          <Pressable
            style={({ pressed }) => [styles.cancelBtn, pressed && tradable && styles.actionBtnPressed]}
            onPress={onCancel}
            disabled={!tradable}
            hitSlop={6}>
            <AppText variant="label" color={tradable ? Colors.down : Colors.textFaint}>
              Cancel
            </AppText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export const FillCard = memo(FillCardImpl, (prev, next) =>
  prev.f === next.f &&
  prev.instrument?.id === next.instrument?.id &&
  prev.symbol === next.symbol &&
  prev.hidden === next.hidden &&
  prev.expanded === next.expanded,
);

export function FillCardImpl({
  f,
  instrument,
  symbol,
  hidden,
  expanded,
  onToggle,
}: {
  f: HlFill;
  instrument: Instrument | undefined;
  symbol: string;
  hidden: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const decimals = displayPriceDecimals(f.coin, instrument, f.px);
  const sideColor = f.side === 'buy' ? Colors.up : Colors.down;
  const pnlColor = f.closedPnl >= 0 ? Colors.up : Colors.down;
  const m = (s: string) => (hidden ? MASK : s);

  const isXyz = f.coin.startsWith('xyz:');
  const tradeValue = f.px * f.size;
  const isRebate = f.fee < 0;
  // Fee shown as its P&L impact: a paid fee is negative, a maker rebate positive.
  const feeText = f.pnlKnown !== true ? '—' : f.feeToken?.toUpperCase() === 'USDC' ? signMoneyExact(-f.fee) : `${f.fee > 0 ? '−' : f.fee < 0 ? '+' : ''}${tokenAmt(Math.abs(f.fee))} ${f.feeToken ?? 'token'}`;
  const netPnl = f.pnlKnown === true ? fillNetPnl(f) : null;
  const netColor = netPnl == null ? Colors.textMuted : netPnl >= 0 ? Colors.up : Colors.down;
  // Only closing fills realize PnL; opens book 0. Show the gross→net split only then.
  const showPnl = f.closedPnl !== 0 || /close|reduce/i.test(f.dir);
  const hashValid = /^0x[0-9a-fA-F]{2,}$/.test(f.hash);

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardHead, pressed && styles.pressed]}
        onPress={onToggle}>
        {instrument ? (
          <SymbolLogo instrument={instrument} size={40} />
        ) : (
          <View style={styles.coinFallback}>
            <AppText variant="label">{symbol.slice(0, 3)}</AppText>
          </View>
        )}
        <View style={styles.mid}>
          <View style={styles.titleRow}>
            <AppText style={styles.symbol} numberOfLines={1}>
              {symbol}
            </AppText>
            <View style={[styles.sideBadge, { backgroundColor: sideColor + '22' }]}>
              <AppText variant="caption" color={sideColor}>
                {f.dir}
              </AppText>
            </View>
            {isXyz ? (
              <View style={styles.xyzBadge}>
                <AppText variant="caption" muted>
                  xyz
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText style={styles.sub} numeric numberOfLines={1}>
            {m(`${qty(f.size)} ${symbol}`)} @ ${formatPrice(f.px, decimals)} · {whenLabel(f.timestamp)}
          </AppText>
        </View>
        {/* At-a-glance figure is the NET realized PnL (after fees), matching HL's web
            "Closed PNL"; the gross→fee→net split lives in the expanded detail. */}
        {f.closedPnl !== 0 ? (
          <AppText style={[styles.pnl, { color: netColor }]} numeric numberOfLines={1}>
            {netPnl == null ? '—' : m(signedUsd(netPnl))}
          </AppText>
        ) : null}
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={Colors.textFaint}
          style={styles.chevron}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.detail}>
          <View style={styles.gridRow}>
            <Cell label="Trade Value" value={m(usdExact(tradeValue))} />
            <Cell
              label={isRebate ? 'Rebate' : 'Fee'}
              value={m(feeText)}
              color={isRebate ? Colors.up : undefined}
            />
            <Cell label="Type" value={f.crossed ? 'Taker' : 'Maker'} />
          </View>
          <View style={styles.gridRow}>
            <Cell
              label="Closed PnL"
              value={showPnl && f.pnlKnown === true ? m(signMoneyExact(f.closedPnl)) : '—'}
              color={showPnl ? pnlColor : undefined}
              sub={showPnl ? 'before fees' : undefined}
            />
            <Cell
              label="Net PnL"
              value={showPnl && netPnl != null ? m(signMoneyExact(netPnl)) : '—'}
              color={showPnl ? netColor : undefined}
              sub={showPnl ? netPnl == null ? 'USD fee unavailable' : 'after fees' : undefined}
            />
            <Cell label="Time" value={fullWhen(f.timestamp)} />
          </View>

          {hashValid ? (
            <Pressable
              style={styles.chartLink}
              onPress={() => Linking.openURL(`https://app.hyperliquid.xyz/explorer/tx/${f.hash}`)}
              hitSlop={6}>
              <AppText variant="caption" color={Colors.accent}>
                View on explorer
              </AppText>
              <Ionicons name="open-outline" size={13} color={Colors.accent} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function AccountReadStatus({ label, query, freshForMs }: {
  label: string;
  query: { data: unknown; isError: boolean; isFetching: boolean; dataUpdatedAt: number; refetch: () => Promise<unknown> };
  freshForMs: number;
}) {
  const state = accountReadState(query, freshForMs);
  const updated = query.dataUpdatedAt > 0 ? new Date(query.dataUpdatedAt).toLocaleTimeString() : null;
  if (state === 'ready' || state === 'refreshing') return null;
  if (state === 'loading') return <View style={styles.readStatus}><ActivityIndicator size="small" color={Colors.textMuted} accessibilityLabel={`Loading ${label}`} /></View>;
  return (
    <View style={styles.readStatus}>
      <Ionicons name="alert-circle-outline" size={15} color={Colors.warning} />
      <AppText variant="caption" color={Colors.warning} style={{ flex: 1 }}>
        {state === 'error' ? `Couldn’t load ${label}` : `${label[0].toUpperCase() + label.slice(1)} may be out of date${updated ? ` · ${updated}` : ''}`}
      </AppText>
        <Pressable accessibilityRole="button" accessibilityLabel={`Refresh ${label}`} accessibilityState={{ busy: query.isFetching }} hitSlop={10} disabled={query.isFetching} onPress={() => { void query.refetch(); }}>
          {query.isFetching ? <ActivityIndicator size="small" color={Colors.textMuted} /> : <Ionicons name="refresh-outline" size={18} color={Colors.accent} />}
        </Pressable>
    </View>
  );
}

export function HistoryLoading() {
  return (
    <View style={styles.historyState}>
      <ActivityIndicator color={Colors.accent} accessibilityLabel="Loading account history" />
    </View>
  );
}

export function HistoryError({ label, detail, onRetry }: { label: string; detail?: string; onRetry: () => void }) {
  return (
    <View style={styles.historyState}>
      <AppText variant="body" muted>{`Couldn’t load ${label}`}</AppText>
      {detail ? <AppText variant="caption" muted style={styles.historyEmptyDetail}>{detail}</AppText> : null}
      <Pressable onPress={onRetry} hitSlop={8}>
        <AppText variant="label" color={Colors.accent}>Retry</AppText>
      </Pressable>
    </View>
  );
}

export function HistoryEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.historyState}>
      <View style={styles.historyEmptyIcon}>
        <Ionicons name="receipt-outline" size={22} color={Colors.textFaint} />
      </View>
      <AppText variant="body">{title}</AppText>
      <AppText variant="caption" muted style={styles.historyEmptyDetail}>
        {detail}
      </AppText>
    </View>
  );
}

export function HistoryIntro({
  icon,
  title,
  detail,
}: {
  icon: 'swap-vertical-outline' | 'time-outline';
  title: string;
  detail: string;
}) {
  return (
    <View style={styles.historyIntro}>
      <View style={styles.historyIntroIcon}>
        <Ionicons name={icon} size={16} color={Colors.accent} />
      </View>
      <View style={styles.historyIntroCopy}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption" muted>{detail}</AppText>
      </View>
    </View>
  );
}

export const FundingHistoryCard = memo(function FundingHistoryCard({
  row,
  hidden,
}: {
  row: HlUserFunding;
  hidden: boolean;
}) {
  const side = row.signedSize >= 0 ? 'Long' : 'Short';
  const sideColor = row.signedSize >= 0 ? Colors.up : Colors.down;
  const paymentColor = row.payment > 0 ? Colors.up : row.payment < 0 ? Colors.down : Colors.textMuted;
  const symbol = cleanCoin(row.coin);
  return (
    <View style={styles.historyCard}>
      <View style={styles.historyCardTop}>
        <View style={styles.historyMarket}>
          <View style={styles.historyTitleRow}>
            <AppText style={styles.historySymbol}>{symbol}</AppText>
            <View style={[styles.historySideBadge, { backgroundColor: sideColor + '18' }]}>
              <AppText variant="caption" color={sideColor}>{side}</AppText>
            </View>
          </View>
          <AppText variant="caption" muted numeric>{fullWhen(row.timestamp)}</AppText>
        </View>
        <View style={styles.historyPayment}>
          <AppText variant="caption" muted>Payment</AppText>
          <AppText numeric color={paymentColor} style={styles.historyPaymentValue}>
            {hidden ? `${MASK} USDC` : `${historyTokenAmount(row.payment)} USDC`}
          </AppText>
        </View>
      </View>
      <View style={styles.historyMetaRow}>
        <View style={styles.historyMetaCell}>
          <AppText variant="caption" muted>Size</AppText>
          <AppText variant="label" numeric numberOfLines={1}>
            {hidden ? `${MASK} ${symbol}` : `${qty(Math.abs(row.signedSize))} ${symbol}`}
          </AppText>
        </View>
        <View style={styles.historyMetaCell}>
          <AppText variant="caption" muted>Rate</AppText>
          <AppText variant="label" numeric>{formatFundingRatePercent(row.rate)}</AppText>
        </View>
        <View style={[styles.historyMetaCell, styles.historyMetaRight]}>
          <AppText variant="caption" muted>Interval</AppText>
          <AppText variant="label" numeric>
            {row.sampleCount && row.sampleCount > 1 ? `${row.sampleCount}h grouped` : 'Hourly'}
          </AppText>
        </View>
      </View>
    </View>
  );
});

export const InterestHistoryCard = memo(function InterestHistoryCard({
  row,
  hidden,
}: {
  row: HlBorrowLendInterest;
  hidden: boolean;
}) {
  const paid = row.paid > 0;
  const earned = row.earned > 0;
  return (
    <View style={styles.historyCard}>
      <View style={styles.interestHead}>
        <View style={styles.interestAssetIcon}>
          <AppText variant="label">{row.token.slice(0, 1)}</AppText>
        </View>
        <View style={styles.interestAssetCopy}>
          <AppText style={styles.historySymbol}>{row.token}</AppText>
          <AppText variant="caption" muted numeric>{fullWhen(row.timestamp)}</AppText>
        </View>
      </View>
      <View style={styles.interestValues}>
        <View style={styles.interestValueCell}>
          <AppText variant="caption" muted>Paid</AppText>
          <AppText
            numeric
            color={paid ? Colors.down : Colors.textFaint}
            style={styles.interestValue}>
            {hidden ? MASK : paid ? historyTokenAmount(row.paid, '-') : '—'}
          </AppText>
          <AppText variant="caption" color={Colors.textFaint}>{row.token}</AppText>
        </View>
        <View style={styles.interestValueDivider} />
        <View style={styles.interestValueCell}>
          <AppText variant="caption" muted>Earned</AppText>
          <AppText
            numeric
            color={earned ? Colors.up : Colors.textFaint}
            style={styles.interestValue}>
            {hidden ? MASK : earned ? historyTokenAmount(row.earned, '+') : '—'}
          </AppText>
          <AppText variant="caption" color={Colors.textFaint}>{row.token}</AppText>
        </View>
      </View>
    </View>
  );
});
