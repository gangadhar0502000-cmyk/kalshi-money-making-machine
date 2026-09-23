/**
 * Extreme-mid toxicity guards for paper MM (U3.1.1).
 * Refuse *opens* into pinned books: no new longs at mid≈1, no new shorts at mid≈0.
 * Flatten/reduce fills remain allowed when inventory ≠ 0 and the side reduces.
 */

/** Default: refuse short opens / adverse bids when mid at or below this. */
export const DEFAULT_TOXIC_MID_LOW = 0.05
/** Default: refuse long opens / adverse asks when mid at or above this. */
export const DEFAULT_TOXIC_MID_HIGH = 0.95

export type ToxicFillSide = 'buy_yes' | 'sell_yes'

/**
 * True when filling `side` at this mid would *open or add* into an extreme book.
 * Reduce/flatten (buy while short, sell while long) is never toxic here.
 *
 * U3.1.1 symmetric open refuse:
 * - buy_yes open toxic when mid < low OR mid ≥ high
 * - sell_yes open toxic when mid > high OR mid ≤ low
 */
export function isToxicExtremeMid(
  side: ToxicFillSide,
  mid: number,
  low = DEFAULT_TOXIC_MID_LOW,
  high = DEFAULT_TOXIC_MID_HIGH,
  inventory = 0,
): boolean {
  if (!Number.isFinite(mid)) return true
  const reducing =
    (side === 'buy_yes' && inventory < 0) || (side === 'sell_yes' && inventory > 0)
  if (reducing) return false

  if (side === 'buy_yes') return mid < low || mid >= high
  if (side === 'sell_yes') return mid > high || mid <= low
  return false
}

/**
 * Should we arm a YES bid as an *open* at this mid?
 * Inventory-aware arming lives in decideQuoteSides; this is the flat/open gate.
 */
export function allowBidAtMid(
  mid: number,
  low = DEFAULT_TOXIC_MID_LOW,
  high = DEFAULT_TOXIC_MID_HIGH,
): boolean {
  return Number.isFinite(mid) && mid >= low && mid < high
}

/**
 * Should we arm a YES ask as an *open* at this mid?
 */
export function allowAskAtMid(
  mid: number,
  low = DEFAULT_TOXIC_MID_LOW,
  high = DEFAULT_TOXIC_MID_HIGH,
): boolean {
  return Number.isFinite(mid) && mid > low && mid <= high
}
