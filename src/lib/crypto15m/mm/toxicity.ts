/**
 * Extreme-mid toxicity guards for paper MM.
 * Refuse accumulating YES when mid≈0 or shorting YES when mid≈1.
 */

/** Default: pull bid / refuse buy_yes when mid below this. */
export const DEFAULT_TOXIC_MID_LOW = 0.05
/** Default: pull ask / refuse sell_yes when mid above this. */
export const DEFAULT_TOXIC_MID_HIGH = 0.95

export type ToxicFillSide = 'buy_yes' | 'sell_yes'

/**
 * True when filling `side` at this mid would walk inventory into near-certain loss.
 * buy_yes @ mid≈0 → settles ~0; sell_yes @ mid≈1 → covers near 1.
 */
export function isToxicExtremeMid(
  side: ToxicFillSide,
  mid: number,
  low = DEFAULT_TOXIC_MID_LOW,
  high = DEFAULT_TOXIC_MID_HIGH,
): boolean {
  if (!Number.isFinite(mid)) return true
  if (side === 'buy_yes' && mid < low) return true
  if (side === 'sell_yes' && mid > high) return true
  return false
}

/** Should we quote a YES bid at this mid? */
export function allowBidAtMid(mid: number, low = DEFAULT_TOXIC_MID_LOW): boolean {
  return Number.isFinite(mid) && mid >= low
}

/** Should we quote a YES ask at this mid? */
export function allowAskAtMid(mid: number, high = DEFAULT_TOXIC_MID_HIGH): boolean {
  return Number.isFinite(mid) && mid <= high
}
