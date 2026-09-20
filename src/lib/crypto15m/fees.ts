/**
 * Kalshi-style trading fee estimate.
 *
 * Formula (cents, then dollars):
 *   fee_dollars = ceil(0.07 * C * P * (1 - P) * 100) / 100
 *
 * where C = contracts, P = price in dollars (0–1).
 * This matches the common "ceil(0.07·C·P·(1−P))" schedule expressed to the cent.
 *
 * Research estimate only — live fees may differ by product / promo.
 */
export function estimateKalshiFeeDollars(contracts: number, price: number): number {
  const C = Math.max(0, contracts)
  const P = Math.min(1, Math.max(0, price))
  if (C === 0) return 0
  const rawDollars = 0.07 * C * P * (1 - P)
  return Math.ceil(rawDollars * 100) / 100
}

/** Fee for a 1-contract round at given price (entry side only). */
export function feePerContract(price: number): number {
  return estimateKalshiFeeDollars(1, price)
}
