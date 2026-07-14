/**
 * Return true when the executable midpoint moved far enough that the user
 * should review the order again.
 *
 * The signed IOC price remains capped at the price shown during review, so a
 * slow refresh cannot worsen the user's accepted bound. We therefore allow the
 * full reviewed slippage window, with a 10–50 bp guardrail, instead of expiring
 * a review based on elapsed wall-clock time.
 */
export function materiallyDifferentMid(
  reviewed: number,
  fresh: number,
  slippage: number,
): boolean {
  if (!(reviewed > 0) || !(fresh > 0)) return true;
  const allowedFraction = Math.min(0.005, Math.max(0.001, slippage));
  return Math.abs(fresh - reviewed) / reviewed > allowedFraction;
}
