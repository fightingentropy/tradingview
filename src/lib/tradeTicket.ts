export type TradeSizeMode = 'usd' | 'coin' | 'risk';

const SHEET_DRAG_SLOP = 12;
const SHEET_DISMISS_DISTANCE = 72;
const SHEET_DISMISS_FLICK_DISTANCE = 24;
const SHEET_DISMISS_VELOCITY = 1;

/** New and prefilled trade tickets open in the asset's native unit. */
export function defaultTradeSizeMode(): TradeSizeMode {
  return 'coin';
}

/** Only claim a downward gesture when the ticket's inner scroller is already at the top. */
export function shouldStartTradeTicketDismiss(
  dx: number,
  dy: number,
  scrollOffset: number,
  submissionPending: boolean,
): boolean {
  return (
    !submissionPending &&
    scrollOffset <= 1 &&
    dy > SHEET_DRAG_SLOP &&
    Math.abs(dy) > Math.abs(dx) * 1.2
  );
}

/** Dismiss on a committed pull or a shorter, intentional downward flick. */
export function shouldDismissTradeTicket(dy: number, velocityY: number): boolean {
  return (
    dy >= SHEET_DISMISS_DISTANCE ||
    (dy >= SHEET_DISMISS_FLICK_DISTANCE && velocityY >= SHEET_DISMISS_VELOCITY)
  );
}
