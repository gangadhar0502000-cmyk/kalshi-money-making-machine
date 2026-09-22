import { describe, expect, it } from 'vitest'
import {
  assetShortName,
  deriveV1FeedStatus,
  feedAgeSeconds,
  formatFeedAgeShort,
  formatFeedOkLabel,
  fmtMinutesLeft,
  fmtPrice,
  fmtSpreadCents,
  liveLabelFromTone,
  proxyHealthLabel,
  shortestMinutesLeft,
  timeUrgencyClass,
} from './feedStatus'
import type { ContinuousFeedSnapshot } from '../lib/crypto15m/mm/continuousFeed'
import type { Crypto15mMarket } from '../types/crypto15m'

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
    expect(formatFeedAgeShort(okAt, now)).toBe('3s ago')
    expect(formatFeedOkLabel(undefined, now)).toBe('Feed waiting…')
    expect(formatFeedAgeShort(undefined, now)).toBe('waiting…')
  })

  it('derives status row fields from snapshot', () => {
    const now = Date.parse('2026-09-22T18:00:05.000Z')
    const snap = baseSnap({
      everSucceeded: true,
      authenticated: true,
      lastSuccessAt: '2026-09-22T18:00:04.000Z',
      markets: [
        { ticker: 'A', minutesRemaining: 8 } as Crypto15mMarket,
        { ticker: 'B', minutesRemaining: 2.5 } as Crypto15mMarket,
      ],
      stale: true,
      refreshing: true,
      lastError: 'soft warn',
    })
    const s = deriveV1FeedStatus(snap, now)
    expect(s.marketCount).toBe(2)
    expect(s.proxyLabel).toContain('auth')
    expect(s.proxyShort).toBe('auth')
    expect(s.proxyOk).toBe(true)
    expect(s.feedAgeLabel).toBe('Feed ok 1s ago')
    expect(s.feedAgeShort).toBe('1s ago')
    expect(s.feedTone).toBe('ok')
    expect(s.liveLabel).toBe('Live feed')
    expect(s.nextCloseMins).toBe(2.5)
    expect(s.stale).toBe(true)
    expect(s.refreshing).toBe(true)
    expect(s.lastError).toBe('soft warn')
  })

  it('proxy connecting until first success', () => {
    const p = proxyHealthLabel(baseSnap())
    expect(p.ok).toBe(false)
    expect(p.label).toMatch(/connecting/i)
    expect(p.short).toBe('connecting')
  })

  it('formats minutes, cents, spread, urgency', () => {
    expect(fmtMinutesLeft(0)).toBe('closed')
    expect(fmtMinutesLeft(2.5)).toMatch(/2m/)
    expect(fmtPrice(0.42)).toBe('42¢')
    expect(fmtSpreadCents(0.4, 0.45)).toBe('5¢')
    expect(fmtSpreadCents(0.4, 0.45, 6)).toBe('6¢')
    expect(timeUrgencyClass(5)).toContain('slate')
    expect(timeUrgencyClass(2)).toContain('amber')
    expect(timeUrgencyClass(0.5)).toContain('rose')
  })

  it('live labels follow tone', () => {
    expect(liveLabelFromTone('ok')).toBe('Live feed')
    expect(liveLabelFromTone('amber')).toBe('Degraded')
    expect(liveLabelFromTone('red')).toBe('Offline')
    expect(liveLabelFromTone('unknown' as never)).toBe('Offline')
  })

  it('shortest minutes and asset names', () => {
    expect(shortestMinutesLeft([])).toBeNull()
    expect(
      shortestMinutesLeft([
        { minutesRemaining: 9 } as Crypto15mMarket,
        { minutesRemaining: 1.2 } as Crypto15mMarket,
      ]),
    ).toBe(1.2)
    expect(assetShortName('BTC')).toBe('Bitcoin')
    expect(assetShortName('ZZZ')).toBe('ZZZ')
  })
})
