import type { Crypto15mMarket } from '../../../types/crypto15m'
import { CONTINUOUS_FEED_POLL_MS } from './universeCache'

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
  /** ISO time of last successful poll (client clock — includes cache hits). */
  lastOkAt?: string
  /** Soft error from last attempt (abort/transient); never implies Lab LIVE-ONLY. */
  lastError?: string
  /** True once any non-abort MM poll completed (even if markets empty). */
  everSucceeded: boolean
  stale?: boolean
  cacheAgeMs?: number | null
}

/** @deprecated U1 uses CONTINUOUS_FEED_POLL_MS (500ms); kept for any legacy imports. */
export const MM_MARKET_POLL_MS = CONTINUOUS_FEED_POLL_MS
