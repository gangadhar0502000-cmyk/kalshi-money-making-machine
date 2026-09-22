import { describe, expect, it } from 'vitest'
import {
  deriveV1FeedStatus,
  feedAgeSeconds,
  formatFeedOkLabel,
  fmtMinutesLeft,
  fmtPrice,
  proxyHealthLabel,
} from './feedStatus'
import type { ContinuousFeedSnapshot } from '../lib/crypto15m/mm/continuousFeed'

function baseSnap(
  over: Partial<ContinuousFeedSnapshot> = {},
): ContinuousFeedSnapshot {
  return {
    markets: [],
    stale: false,
    refreshing: false,
    cacheAgeMs: null,
    authenticated: false,
    readOnly: true,
    everSucceeded: false,
    ...over,
  }
}

describe('v1 feedStatus', () => {
  it('formats Feed ok Xs ago from lastSuccessAt', () => {
    const now = Date.parse('2026-09-22T18:00:10.000Z')
    const okAt = '2026-09-22T18:00:07.000Z'
    expect(feedAgeSeconds(okAt, now)).toBe(3)
    expect(formatFeedOkLabel(okAt, now)).toBe('Feed ok 3s ago')
    expect(formatFeedOkLabel(undefined, now)).toBe('Feed waiting…')
  })

  it('derives status row fields from snapshot', () => {
    const now = Date.parse('2026-09-22T18:00:05.000Z')
    const snap = baseSnap({
      everSucceeded: true,
      authenticated: true,
      lastSuccessAt: '2026-09-22T18:00:04.000Z',
      markets: [{ ticker: 'A' } as never, { ticker: 'B' } as never],
      stale: true,
      refreshing: true,
      lastError: 'soft warn',
    })
    const s = deriveV1FeedStatus(snap, now)
    expect(s.marketCount).toBe(2)
    expect(s.proxyLabel).toContain('auth')
    expect(s.proxyOk).toBe(true)
    expect(s.feedAgeLabel).toBe('Feed ok 1s ago')
    expect(s.feedTone).toBe('ok')
    expect(s.stale).toBe(true)
    expect(s.refreshing).toBe(true)
    expect(s.lastError).toBe('soft warn')
  })

  it('proxy connecting until first success', () => {
    const p = proxyHealthLabel(baseSnap())
    expect(p.ok).toBe(false)
    expect(p.label).toMatch(/connecting/i)
  })

  it('formats minutes and cents', () => {
    expect(fmtMinutesLeft(0)).toBe('closed')
    expect(fmtMinutesLeft(2.5)).toMatch(/2m/)
    expect(fmtPrice(0.42)).toBe('42¢')
  })
})
