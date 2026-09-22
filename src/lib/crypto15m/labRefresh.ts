import type { Crypto15mMarket, FetchCrypto15mResult } from '../../types/crypto15m'

export type LabSource = 'live' | 'demo' | null

export type LabRefreshDecision = 'apply' | 'keep-last' | 'ignore'

/**
 * True when an error string is only abort noise (timeout/race AbortError labels),
 * not a completed HTTP/network outage. Used to suppress sticky LIVE-ONLY FAILURE.
 */
export function isAbortOnlyError(error: string | undefined | null): boolean {
  if (error == null) return true // quiet abortedFetchResult — no error
  const trimmed = error.trim()
  if (!trimmed) return true
  // Strip soft UI suffixes Lab may append
  const core = trimmed
    .replace(/\s*[·|]\s*Empty feed[^|·]*$/i, '')
    .replace(/^Transient abort[^:]*:\s*/i, '')
    .trim()
  if (!core) return true
  // Loud LIVE-ONLY banner: only abort-only if the *detail* after the banner is abort noise.
  if (/LIVE-ONLY\s+FAILURE/i.test(core)) {
    const after = core.replace(/^.*?LIVE-ONLY\s+FAILURE:[^.]*\.\s*/i, '')
    if (after === core) return false // bare LIVE-ONLY / no parseable detail → real failure
    return isAbortOnlyError(after)
  }
  // Every segment must be "...: aborted" or bare "aborted"
  const parts = core.split(/\s*\|\s*/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return true
  return parts.every(
    (p) =>
      /^aborted$/i.test(p) ||
      /:\s*aborted\b/i.test(p) ||
      /^The operation was aborted$/i.test(p),
  )
}

/**
 * Decide whether a refresh should replace the Lab market universe.
 *
 * LIVE ONLY: demo fixtures are never applied from fetch. Empty live feeds keep
 * the last non-empty LIVE universe during rollover gaps — but only while that
 * universe still has open markets (minutesRemaining > 0). Settled-only keep-last
 * would glue the UI to dead books through window rollover.
 *
 * Abort-only / quiet empties never wipe a live universe and never cold-apply
 * empty (would sticky LIVE-ONLY after Strict Mode / overlapping poll aborts),
 * except when lastOpenCount is 0 (settled-only): then apply empty so the next
 * successful poll can replace the universe.
 */
export function shouldApplyLabRefresh(opts: {
  prevSource: LabSource
  next: Pick<FetchCrypto15mResult, 'source' | 'markets' | 'error'>
  lastMarketsLen: number
  /** Count of last markets still open (minutesRemaining > 0). When 0, do not keep-last. */
  lastOpenCount?: number
}): LabRefreshDecision {
  const { prevSource, next, lastMarketsLen } = opts
  const lastOpenCount =
    opts.lastOpenCount !== undefined ? opts.lastOpenCount : lastMarketsLen

  const abortOnlyEmpty =
    next.markets.length === 0 && isAbortOnlyError(next.error)

  // Abort races / timeout-labeled "aborted" — never wipe, never cold-apply empty
  // — unless the kept universe is settled-only (nothing open to preserve).
  if (abortOnlyEmpty) {
    if (lastMarketsLen > 0 && (prevSource === 'live' || prevSource === 'demo')) {
      // Settled-only: apply empty so UI can clear sticky dead books.
      if (lastOpenCount <= 0) return 'apply'
      return 'keep-last'
    }
    // Cold start abort: ignore so we do not stamp source=live + empty markets.
    return 'ignore'
  }

  // Never keep a stale DEMO universe once anything live arrives (incl. empty fail).
  if (prevSource === 'demo' && next.source === 'live') {
    return 'apply'
  }

  // Successful live refresh with markets always applies.
  if (next.source === 'live' && next.markets.length > 0) {
    return 'apply'
  }

  // Transient empty while we already have a live universe — keep last (rollover),
  // but only if some markets are still open. Settled-only → apply empty.
  if (next.markets.length === 0 && lastMarketsLen > 0 && prevSource === 'live') {
    if (lastOpenCount <= 0) return 'apply'
    return 'keep-last'
  }

  // Cold start / hard fail → apply empty (LIVE-ONLY failure UI, not fixtures).
  return 'apply'
}

export function pickMarketsForRefresh(
  decision: LabRefreshDecision,
  next: Crypto15mMarket[],
  last: Crypto15mMarket[],
): Crypto15mMarket[] {
  if (decision === 'keep-last' || decision === 'ignore') return last
  return next
}
