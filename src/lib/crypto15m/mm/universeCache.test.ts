import { describe, expect, it } from 'vitest'
import {
  CRYPTO15M_CACHE_TTL_MS,
  buildCachedCrypto15mPayload,
  buildHealthCacheMeta,
  cacheAgeMs,
  decideUniverseRefreshApply,
  feedFreshnessTone,
  isCacheFresh,
  FEED_AMBER_AFTER_MS,
  FEED_RED_AFTER_MS,
} from './universeCache'

describe('universeCache TTL / age', () => {
  it('computes cacheAgeMs from lastSuccessMs', () => {
    expect(cacheAgeMs(1000, 3500)).toBe(2500)
    expect(cacheAgeMs(null, 3500)).toBeNull()
  })

  it('isCacheFresh only under TTL', () => {
    expect(isCacheFresh(0)).toBe(true)
    expect(isCacheFresh(CRYPTO15M_CACHE_TTL_MS - 1)).toBe(true)
    expect(isCacheFresh(CRYPTO15M_CACHE_TTL_MS)).toBe(false)
    expect(isCacheFresh(null)).toBe(false)
  })
})

describe('decideUniverseRefreshApply keep-last', () => {
  it('applies successful non-empty refresh', () => {
    expect(
      decideUniverseRefreshApply({
        lastGoodCount: 3,
        nextMarketsCount: 4,
        refreshFailed: false,
        seriesErrorCount: 0,
      }),
    ).toBe('apply')
  })

  it('keeps last-good when refresh throws and open set exists', () => {
    expect(
      decideUniverseRefreshApply({
        lastGoodCount: 5,
        nextMarketsCount: 0,
        refreshFailed: true,
        seriesErrorCount: 0,
      }),
    ).toBe('keep-last')
  })

  it('keeps last-good when empty result has series errors', () => {
    expect(
      decideUniverseRefreshApply({
        lastGoodCount: 2,
        nextMarketsCount: 0,
        refreshFailed: false,
        seriesErrorCount: 3,
      }),
    ).toBe('keep-last')
  })

  it('applies true empty open set (no errors) even if had last-good', () => {
    expect(
      decideUniverseRefreshApply({
        lastGoodCount: 2,
        nextMarketsCount: 0,
        refreshFailed: false,
        seriesErrorCount: 0,
      }),
    ).toBe('apply')
  })

  it('applies empty on cold start failure (no last-good)', () => {
    expect(
      decideUniverseRefreshApply({
        lastGoodCount: 0,
        nextMarketsCount: 0,
        refreshFailed: true,
        seriesErrorCount: 1,
      }),
    ).toBe('apply')
  })
})

describe('buildCachedCrypto15mPayload', () => {
  it('serves fresh cache as stale:false', () => {
    const body = buildCachedCrypto15mPayload({
      markets: [{ ticker: 'A' }],
      fetchedAt: '2026-09-22T12:00:00.000Z',
      lastSuccessMs: 10_000,
      refreshing: false,
      authenticated: true,
      nowMs: 10_000 + 500,
    })
    expect(body.stale).toBe(false)
    expect(body.refreshing).toBe(false)
    expect(body.cacheAgeMs).toBe(500)
    expect(body.markets).toHaveLength(1)
    expect(body.readOnly).toBe(true)
  })

  it('marks stale when past TTL while refreshing', () => {
    const body = buildCachedCrypto15mPayload({
      markets: [{ ticker: 'A' }],
      fetchedAt: '2026-09-22T12:00:00.000Z',
      lastSuccessMs: 10_000,
      refreshing: true,
      authenticated: true,
      nowMs: 10_000 + CRYPTO15M_CACHE_TTL_MS + 100,
    })
    expect(body.stale).toBe(true)
    expect(body.refreshing).toBe(true)
    expect(body.markets).toHaveLength(1)
  })
})

describe('feedFreshnessTone', () => {
  it('ok / amber / red thresholds from lastSuccessAt', () => {
    const now = 1_000_000
    expect(feedFreshnessTone(new Date(now - 1_000).toISOString(), now)).toBe('ok')
    expect(
      feedFreshnessTone(new Date(now - FEED_AMBER_AFTER_MS - 1).toISOString(), now),
    ).toBe('amber')
    expect(
      feedFreshnessTone(new Date(now - FEED_RED_AFTER_MS - 1).toISOString(), now),
    ).toBe('red')
    expect(feedFreshnessTone(undefined, now)).toBe('none')
  })
})

describe('buildHealthCacheMeta', () => {
  it('exposes cache age and last success ISO', () => {
    const meta = buildHealthCacheMeta({
      lastSuccessMs: 5_000,
      fetchedAt: '2026-09-22T12:00:00.000Z',
      refreshing: false,
      marketCount: 7,
      nowMs: 5_800,
    })
    expect(meta.cacheAgeMs).toBe(800)
    expect(meta.lastSuccessAt).toBe('2026-09-22T12:00:00.000Z')
    expect(meta.marketCount).toBe(7)
  })
})
