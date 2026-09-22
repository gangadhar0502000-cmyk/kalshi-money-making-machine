import type { Crypto15mMarket } from '../../../types/crypto15m'

/**
 * Paper MM universe: prefer MM-owned poll results; Lab prop only until the first
 * successful MM poll (any completed response — including empty).
 */
export function pickMmUniverse(
  mmOwned: Crypto15mMarket[] | null,
  labFallback: Crypto15mMarket[],
): Crypto15mMarket[] {
  if (mmOwned !== null) return mmOwned
  return labFallback
}

export type MmFeedStatus = {
  /** ISO time of last successful poll that returned markets (or empty open set). */
  lastOkAt?: string
  /** Soft error from last attempt (abort/transient); never implies Lab LIVE-ONLY. */
  lastError?: string
  /** True once any non-abort MM poll completed (even if markets empty). */
  everSucceeded: boolean
}

export const MM_MARKET_POLL_MS = 8_000
