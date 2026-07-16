export type TradeSizeMode = 'usd' | 'coin' | 'risk';

/** New and prefilled trade tickets open in the asset's native unit. */
export function defaultTradeSizeMode(): TradeSizeMode {
  return 'coin';
}
