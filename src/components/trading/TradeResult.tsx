import { AppText } from '@/components/ui/AppText';
import { Colors } from '@/constants/theme';
import { formatPrice } from '@/lib/format';
import type { OrderResult } from '@/lib/hyperliquid/exchange';
import { compactNumber, lotQuantized, type TradeSubmission } from '@/lib/tradeTicketModel';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { styles } from './tradeTicketStyles';

export function ResultView({
  coin,
  submission,
  priceDecimals,
  onDone,
  onAgain,
}: {
  coin: string;
  submission: TradeSubmission;
  priceDecimals: number;
  onDone: () => void;
  onAgain: () => void;
}) {
  const primary = submission.results[0] ?? { status: 'unknown' as const };
  const requestedSize = lotQuantized(submission.requestedSize, submission.szDecimals);
  const hasReportedFillSize =
    primary.status === 'filled' &&
    primary.totalSz != null &&
    Number.isFinite(primary.totalSz) &&
    primary.totalSz >= 0;
  const reportedFillSize = hasReportedFillSize
    ? lotQuantized(primary.totalSz ?? 0, submission.szDecimals)
    : null;
  const isPartialFill = reportedFillSize != null && reportedFillSize < requestedSize;
  const isExactFill = reportedFillSize != null && reportedFillSize === requestedSize;
  const remainingPosition = submission.remainingPosition;
  const remainingSize = remainingPosition
    ? lotQuantized(remainingPosition.size, submission.szDecimals)
    : 0;
  const presentation: Record<
    OrderResult['status'],
    { title: string; icon: 'checkmark-circle' | 'time-outline' | 'alert-circle-outline'; color: string }
  > = {
    filled: { title: 'Fill reported', icon: 'checkmark-circle', color: Colors.up },
    resting: { title: 'Order resting', icon: 'time-outline', color: Colors.warning },
    waitingForFill: { title: 'Waiting for fill', icon: 'time-outline', color: Colors.warning },
    waitingForTrigger: { title: 'Waiting for trigger', icon: 'time-outline', color: Colors.warning },
    success: { title: 'Request accepted', icon: 'checkmark-circle', color: Colors.accent },
    error: { title: 'Order rejected', icon: 'alert-circle-outline', color: Colors.down },
    unknown: { title: 'Check order status', icon: 'alert-circle-outline', color: Colors.warning },
  };
  let primaryUi = presentation[primary.status];
  if (primary.status === 'filled') {
    if (!hasReportedFillSize || (reportedFillSize != null && reportedFillSize > requestedSize)) {
      primaryUi = {
        title: 'Fill size needs verification',
        icon: 'alert-circle-outline',
        color: Colors.warning,
      };
    } else if (isPartialFill) {
      primaryUi = {
        title: submission.fullClose
          ? 'Position partially closed'
          : `${submission.action} partially filled`,
        icon: 'time-outline',
        color: Colors.warning,
      };
    } else if (submission.fullClose) {
      primaryUi =
        remainingPosition === null
          ? { title: 'Position closed', icon: 'checkmark-circle', color: Colors.up }
          : remainingPosition
            ? {
                title: 'Close fill reported · position remains open',
                icon: 'alert-circle-outline',
                color: Colors.warning,
              }
            : {
                title: 'Close fill reported · verify position',
                icon: 'alert-circle-outline',
                color: Colors.warning,
              };
    } else if (isExactFill) {
      primaryUi = {
        title: `${submission.action} fully filled`,
        icon: 'checkmark-circle',
        color: Colors.up,
      };
    }
  }
  const describe = (order: OrderResult, child = false) => {
    switch (order.status) {
      case 'filled':
        return child
          ? `${order.totalSz ?? '—'} ${coin} @ $${formatPrice(order.avgPx ?? 0, priceDecimals)}`
          : reportedFillSize == null
            ? `Exchange reported a fill @ $${formatPrice(order.avgPx ?? 0, priceDecimals)} but omitted the size`
            : `Filled ${compactNumber(reportedFillSize, submission.szDecimals)} of ${compactNumber(
                requestedSize,
                submission.szDecimals,
              )} ${coin} @ $${formatPrice(order.avgPx ?? 0, priceDecimals)}`;
      case 'resting':
        return `Resting on the book${order.oid ? ` · #${order.oid}` : ''}`;
      case 'waitingForFill':
        return child
          ? 'Accepted · waiting for the parent entry to fill'
          : 'Exchange reports that this order is waiting for fill';
      case 'waitingForTrigger':
        return 'Accepted · exchange reports waiting for trigger';
      case 'success':
        return 'Exchange returned success without an order id';
      case 'error':
        return order.error ?? 'Hyperliquid rejected this order leg';
      case 'unknown':
        return 'Unrecognized acknowledgement · refresh Open Orders';
    }
  };
  let livePositionCopy: string | null = null;
  let livePositionColor: string = Colors.textMuted;
  if (primary.status === 'filled' && submission.fullClose) {
    if (remainingPosition === undefined) {
      livePositionCopy = 'Remaining live position is unavailable. Verify Account and Open Orders now.';
      livePositionColor = Colors.warning;
    } else if (remainingPosition) {
      livePositionCopy = `Position remains open: ${remainingPosition.side === 'long' ? 'Long' : 'Short'} ${compactNumber(
        remainingSize,
        submission.szDecimals,
      )} ${coin}.`;
      livePositionColor = Colors.warning;
    } else if (isPartialFill) {
      livePositionCopy =
        'A partial close was reported, while the refreshed account currently shows flat. Verify fills before trading again.';
      livePositionColor = Colors.warning;
    } else {
      livePositionCopy = 'Refreshed account shows this position is flat.';
    }
  } else if (primary.status === 'filled' && isPartialFill) {
    if (remainingPosition === undefined) {
      livePositionCopy = 'The refreshed live position is unavailable. Verify Account before trading again.';
      livePositionColor = Colors.warning;
    } else if (remainingPosition) {
      livePositionCopy = `Refreshed position: ${remainingPosition.side === 'long' ? 'Long' : 'Short'} ${compactNumber(
        remainingSize,
        submission.szDecimals,
      )} ${coin}.`;
    } else {
      livePositionCopy = 'Refreshed account currently shows no open position.';
    }
  }
  return (
    <View style={styles.result}>
      <Ionicons name={primaryUi.icon} size={40} color={primaryUi.color} />
      <AppText variant="heading">{primaryUi.title}</AppText>
      <AppText variant="body" muted numeric>
        {describe(primary)}
      </AppText>
      {livePositionCopy ? (
        <AppText variant="caption" color={livePositionColor} numeric>
          {livePositionCopy}
        </AppText>
      ) : null}
      {submission.legTypes.length > 0 ? (
        <View style={styles.resultLegs}>
          {submission.legTypes.map((leg, index) => {
            const child = submission.results[index + 1] ?? ({ status: 'unknown' } as const);
            return (
              <View key={`${leg}-${index}`} style={styles.resultLegRow}>
                <View
                  style={[
                    styles.tpslDot,
                    { backgroundColor: leg === 'tp' ? Colors.up : Colors.down },
                  ]}
                />
                <View style={styles.resultLegCopy}>
                  <AppText variant="label">{leg === 'tp' ? 'Take profit' : 'Stop loss'}</AppText>
                  <AppText
                    variant="caption"
                    color={child.status === 'error' ? Colors.down : Colors.textMuted}>
                    {describe(child, true)}
                  </AppText>
                </View>
              </View>
            );
          })}
          <AppText
            variant="caption"
            color={
              submission.results.slice(1).some((child) => child.status === 'error')
                ? Colors.down
                : Colors.warning
            }>
            {submission.results.slice(1).some((child) => child.status === 'error')
              ? 'At least one protection leg was rejected. Treat the position as unprotected and review Open Orders now.'
              : 'These are exchange acknowledgements, not proof that protection is active. Verify TP/SL under Open Orders.'}
          </AppText>
        </View>
      ) : null}
      <View style={styles.resultBtns}>
        <Pressable style={[styles.resultBtn, styles.resultBtnGhost]} onPress={onAgain}>
          <AppText variant="label" color={Colors.text}>
            New order
          </AppText>
        </Pressable>
        <Pressable style={[styles.resultBtn, { backgroundColor: Colors.accent }]} onPress={onDone}>
          <AppText variant="label" color={Colors.background}>Done</AppText>
        </Pressable>
      </View>
    </View>
  );
}
