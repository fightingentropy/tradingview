import { formatPrice } from '@/lib/format';
import { compactNumber, lotQuantized, type TradeSubmission } from '@/lib/tradeTicketModel';

export interface TradeReceipt {
  title: string;
  detail: string;
  tone: 'success' | 'pending' | 'warning' | 'error';
  /** Only a definitive, complete acknowledgement may dismiss the ticket. */
  dismiss: boolean;
  protection?: string;
}

export function tradeReceipt(submission: TradeSubmission, symbol: string, priceDecimals: number): TradeReceipt {
  const parent = submission.results[0];
  const requested = lotQuantized(submission.requestedSize, submission.szDecimals);
  const size = (value: number) => `${compactNumber(value, submission.szDecimals)} ${symbol}`;
  const price = (value: number) => `$${formatPrice(value, priceDecimals)}`;
  let receipt: TradeReceipt = { title: 'Check order status', detail: 'Your order may be live. Check Account before trying again.', tone: 'warning', dismiss: false };

  if (parent?.status === 'filled') {
    const filled = parent.totalSz != null && Number.isFinite(parent.totalSz) && parent.totalSz > 0
      ? lotQuantized(parent.totalSz, submission.szDecimals) : null;
    const fillPrice = parent.avgPx != null && Number.isFinite(parent.avgPx) && parent.avgPx > 0 ? parent.avgPx : null;
    if (filled != null && filled <= requested && fillPrice != null) {
      const complete = filled === requested;
      const title = submission.action === 'Buy' ? `Bought ${symbol}`
        : submission.action === 'Sell' ? `Sold ${symbol}` : `${symbol} order filled`;
      receipt = {
        title: complete ? title : 'Partially filled',
        detail: complete ? `${size(filled)} · ${price(fillPrice)}` : `${compactNumber(filled, submission.szDecimals)} of ${size(requested)} · ${price(fillPrice)}`,
        tone: complete ? 'success' : 'warning',
        dismiss: complete,
      };
    }
  } else if (parent?.status === 'resting' && submission.orderType === 'limit' && Number.isSafeInteger(parent.oid) && parent.oid! > 0) {
    receipt = {
      title: `Limit ${submission.action.toLowerCase()} placed`,
      detail: `${size(requested)}${submission.limitPrice != null ? ` · ${price(submission.limitPrice)}` : ''}`,
      tone: 'pending', dismiss: true,
    };
  } else if (parent?.status === 'error') {
    receipt = { title: 'Order not placed', detail: parent.error ?? 'The exchange rejected this order.', tone: 'error', dismiss: false };
  }

  if (submission.legTypes.length) {
    const children = submission.legTypes.map((_, index) => submission.results[index + 1]);
    const failed = children.some((child) => child?.status === 'error');
    const confirmed = children.every((child) => child && ['filled', 'resting', 'waitingForFill', 'waitingForTrigger'].includes(child.status));
    if (failed || !confirmed) {
      receipt = { ...receipt, tone: 'warning', dismiss: false,
        protection: failed ? 'A take-profit or stop-loss was rejected. Check your open orders.' : 'Take-profit or stop-loss is not confirmed. Check your open orders.' };
    }
  }
  return receipt;
}
