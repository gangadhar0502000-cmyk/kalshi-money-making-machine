import type { Crypto15mMarket, FetchCrypto15mResult } from '../../types/crypto15m'

export type LabSource = 'live' | 'demo' | null

/**
 * Decide whether a refresh should replace the Lab market universe.
 *
 * Explicit preference: if we were on DEMO and the new result is LIVE with
 * markets, always apply (demo must never stick once live data is available).
 * Empty feeds keep the last non-empty universe (rollover gap).
 */
export function shouldApplyLabRefresh(opts: {
  prevSource: LabSource
  next: Pick<FetchCrypto15mResult, 'source' | 'markets'>
  lastMarketsLen: number
}): 'apply' | 'keep-last' {
  const { prevSource, next, lastMarketsLen } = opts

  // Demo → live with markets: always replace DEMO universe.
  if (prevSource === 'demo' && next.source === 'live' && next.markets.length > 0) {
    return 'apply'
  }

  // Any successful live refresh with markets always applies.
  if (next.source === 'live' && next.markets.length > 0) {
    return 'apply'
  }

  // Transient empty — keep last universe (do not wipe).
  if (next.markets.length === 0 && lastMarketsLen > 0) {
    return 'keep-last'
  }

  return 'apply'
}

export function pickMarketsForRefresh(
  decision: 'apply' | 'keep-last',
  next: Crypto15mMarket[],
  last: Crypto15mMarket[],
): Crypto15mMarket[] {
  return decision === 'keep-last' ? last : next
}
