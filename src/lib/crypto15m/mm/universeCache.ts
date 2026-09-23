/**
 * Pure helpers for mm-proxy crypto15m universe cache + UI freshness tones.
 * Kept free of Node/http so vitest can cover TTL / keep-last / stale serve.
 */

/** Default in-memory TTL before a background Kalshi fan-out refresh. */
export const CRYPTO15M_CACHE_TTL_MS = 2_500

/** Client continuous-feed poll interval (U2.10: 500ms; safe because proxy caches). */
export const CONTINUOUS_FEED_POLL_MS = 500

/** UI: lastSuccessAt older than this → amber. */
export const FEED_AMBER_AFTER_MS = 8_000

/** UI: lastSuccessAt older than this → red. */
export const FEED_RED_AFTER_MS = 60_000

export type FeedFreshnessTone = 'ok' | 'amber' | 'red' | 'none'

export function cacheAgeMs(
  lastSuccessMs: number | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (lastSuccessMs == null || !Number.isFinite(lastSuccessMs)) return null
  return Math.max(0, nowMs - lastSuccessMs)
}

/** True when a last-good cache exists and is younger than TTL. */
export function isCacheFresh(
  ageMs: number | null,
  ttlMs: number = CRYPTO15M_CACHE_TTL_MS,
): boolean {
  return ageMs != null && ageMs < ttlMs
}

export type UniverseRefreshDecision = 'apply' | 'keep-last'

/**
 * Whether to replace the cached universe with the refresh result.
 * Keep last-good open set when refresh fails transiently or returns empty
 * with series errors (never wipe a known-good open set on flaky upstream).
 */
export function decideUniverseRefreshApply(opts: {
  lastGoodCount: number
  nextMarketsCount: number
  refreshFailed: boolean
  seriesErrorCount: number
}): UniverseRefreshDecision {
  const hadOpen = opts.lastGoodCount > 0
  if (opts.refreshFailed && hadOpen) return 'keep-last'
  if (
    hadOpen &&
    opts.nextMarketsCount === 0 &&
    opts.seriesErrorCount > 0
  ) {
    return 'keep-last'
  }
  return 'apply'
}

export type CachedCrypto15mPayload = {
  markets: unknown[]
  fetchedAt: string | null
  cacheAgeMs: number | null
  refreshing: boolean
  stale: boolean
  authenticated: boolean
  readOnly: true
  errors: string[]
  banner: string
}

/** Build the JSON body for GET /local-api/crypto15m from cache state. */
export function buildCachedCrypto15mPayload(opts: {
  markets: unknown[] | null
  fetchedAt: string | null
  lastSuccessMs: number | null
  refreshing: boolean
  authenticated: boolean
  errors?: string[]
  nowMs?: number
  ttlMs?: number
}): CachedCrypto15mPayload {
  const now = opts.nowMs ?? Date.now()
  const ttl = opts.ttlMs ?? CRYPTO15M_CACHE_TTL_MS
  const age = cacheAgeMs(opts.lastSuccessMs, now)
  const markets = opts.markets ?? []
  const fresh = isCacheFresh(age, ttl)
  const hasGood = opts.markets != null
  return {
    markets,
    fetchedAt: opts.fetchedAt,
    cacheAgeMs: age,
    refreshing: opts.refreshing,
    // Stale when we are serving past-TTL (or cold empty while refreshing).
    stale: hasGood ? !fresh : opts.refreshing,
    authenticated: opts.authenticated,
    readOnly: true,
    errors: opts.errors?.slice(0, 5) ?? [],
    banner: 'Read-only API · never places trades',
  }
}

/** Honest feed badge tone from lastSuccessAt (proxy data time / fetchedAt). */
export function feedFreshnessTone(
  lastSuccessAt: string | undefined | null,
  nowMs: number = Date.now(),
): FeedFreshnessTone {
  if (!lastSuccessAt) return 'none'
  const t = Date.parse(lastSuccessAt)
  if (!Number.isFinite(t)) return 'none'
  const age = nowMs - t
  if (age > FEED_RED_AFTER_MS) return 'red'
  if (age > FEED_AMBER_AFTER_MS) return 'amber'
  return 'ok'
}

export type HealthCacheMeta = {
  cacheAgeMs: number | null
  lastSuccessAt: string | null
  refreshing: boolean
  marketCount: number
}

export function buildHealthCacheMeta(opts: {
  lastSuccessMs: number | null
  fetchedAt: string | null
  refreshing: boolean
  marketCount: number
  nowMs?: number
}): HealthCacheMeta {
  return {
    cacheAgeMs: cacheAgeMs(opts.lastSuccessMs, opts.nowMs ?? Date.now()),
    lastSuccessAt: opts.fetchedAt,
    refreshing: opts.refreshing,
    marketCount: opts.marketCount,
  }
}
