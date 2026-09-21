import type { Crypto15mMarket, FetchCrypto15mResult } from '../../types/crypto15m'

export type LabSource = 'live' | 'demo' | null

/**
 * Decide whether a refresh should replace the Lab market universe.
 *
 * LIVE ONLY: demo fixtures are never applied from fetch. Empty live feeds keep
 * the last non-empty LIVE universe during rollover gaps. Hard empty+error on a
 * cold start applies empty so the UI can show LIVE-ONLY failure (not fixtures).
 */
export function shouldApplyLabRefresh(opts: {
  prevSource: LabSource
  next: Pick<FetchCrypto15mResult, 'source' | 'markets' | 'error'>
  lastMarketsLen: number
}): 'apply' | 'keep-last' {
  const { prevSource, next, lastMarketsLen } = opts

  // Never keep a stale DEMO universe once anything live arrives (incl. empty fail).
  if (prevSource === 'demo' && next.source === 'live') {
    return 'apply'
  }

  // Successful live refresh with markets always applies.
  if (next.source === 'live' && next.markets.length > 0) {
    return 'apply'
  }

  // Transient empty while we already have a live universe — keep last (rollover).
  if (next.markets.length === 0 && lastMarketsLen > 0 && prevSource === 'live') {
    return 'keep-last'
  }

  // Cold start / hard fail → apply empty (LIVE-ONLY failure UI, not fixtures).
  return 'apply'
}

export function pickMarketsForRefresh(
  decision: 'apply' | 'keep-last',
  next: Crypto15mMarket[],
  last: Crypto15mMarket[],
): Crypto15mMarket[] {
  return decision === 'keep-last' ? last : next
}
