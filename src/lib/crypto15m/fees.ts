/**
 * Kalshi-style trading fee estimate.
 *
 * Taker formula (cents, then dollars):
 *   fee_dollars = ceil(0.07 * C * P * (1 - P) * 100) / 100
 *
 * where C = contracts, P = price in dollars (0–1).
 *
 * Maker fee on crypto 15m series: modeled as **$0** when the fill is a resting maker
 * (unless Kalshi schedule says otherwise for a specific product).
 * Crossing the spread immediately → taker fee formula above.
 *
 * Research estimate only — live fees may differ by product / promo.
 */

import { asDollarPrice } from './mm/prices'

export function estimateKalshiFeeDollars(contracts: number, price: number): number {
  const C = Math.max(0, contracts)
  const P = asDollarPrice(price, 'fee.price')
  if (C === 0) return 0
  const rawDollars = 0.07 * C * P * (1 - P)
  return Math.ceil(rawDollars * 100) / 100
}

/** Resting maker on 15m crypto series — $0 by default schedule assumption. */
export function estimateMakerFeeDollars(_contracts: number, _price: number): number {
  return 0
}

export function estimateFillFeeDollars(
  contracts: number,
  price: number,
  opts: { taker: boolean; applyFees: boolean },
): number {
  if (!opts.applyFees) return 0
  if (opts.taker) return estimateKalshiFeeDollars(contracts, price)
  return estimateMakerFeeDollars(contracts, price)
}

/** Fee for a 1-contract round at given price (entry side only, taker schedule). */
export function feePerContract(price: number): number {
  return estimateKalshiFeeDollars(1, price)
}
