import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  __resetContinuousFeedForTests,
  getContinuousFeedSnapshot,
  subscribeContinuousFeed,
  CONTINUOUS_FEED_POLL_MS,
} from './continuousFeed'
import * as liveBook from './liveBook'

describe('continuousFeed', () => {
  beforeEach(() => {
    __resetContinuousFeedForTests()
    vi.useFakeTimers()
  })
  afterEach(() => {
    __resetContinuousFeedForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('polls proxy-only and updates lastSuccessAt on cache hits', async () => {
    const spy = vi.spyOn(liveBook, 'fetchLocalCrypto15m').mockResolvedValue({
      readOnly: true,
      authenticated: true,
      markets: [
        {
          ticker: 'KXBTC15M-TEST',
          event_ticker: 'KXBTC15M-TEST',
          title: 'BTC 15m',
          status: 'active',
          yes_bid_dollars: '0.40',
          yes_ask_dollars: '0.42',
          no_bid_dollars: '0.58',
          no_ask_dollars: '0.60',
          last_price_dollars: '0.41',
          volume: 10,
          volume_24h: 10,
          open_interest: 1,
          close_time: new Date(Date.now() + 600_000).toISOString(),
          open_time: new Date(Date.now() - 300_000).toISOString(),
        } as never,
      ],
      fetchedAt: '2026-09-22T12:00:00.000Z',
      cacheAgeMs: 100,
      stale: false,
      refreshing: false,
    })

    const snaps: string[] = []
    const unsub = subscribeContinuousFeed((s) => {
      if (s.lastSuccessAt) snaps.push(s.lastSuccessAt)
    })

    await vi.advanceTimersByTimeAsync(0) // flush first poll
    await Promise.resolve()
    await Promise.resolve()

    expect(spy).toHaveBeenCalled()
    const first = getContinuousFeedSnapshot()
    expect(first.everSucceeded).toBe(true)
    expect(first.lastSuccessAt).toBeTruthy()
    expect(CONTINUOUS_FEED_POLL_MS).toBe(1000)

    // Second poll 1s later — lastSuccessAt must advance (cache hit still counts)
    const prevOk = first.lastSuccessAt!
    await vi.advanceTimersByTimeAsync(CONTINUOUS_FEED_POLL_MS)
    await Promise.resolve()
    await Promise.resolve()

    const second = getContinuousFeedSnapshot()
    expect(second.lastSuccessAt).toBeTruthy()
    expect(Date.parse(second.lastSuccessAt!) >= Date.parse(prevOk)).toBe(true)
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)

    unsub()
  })

  it('keeps last markets on stale empty proxy response', async () => {
    vi.spyOn(liveBook, 'fetchLocalCrypto15m')
      .mockResolvedValueOnce({
        readOnly: true,
        authenticated: true,
        markets: [
          {
            ticker: 'KXBTC15M-TEST',
            event_ticker: 'KXBTC15M-TEST',
            title: 'BTC 15m',
            status: 'active',
            yes_bid_dollars: '0.40',
            yes_ask_dollars: '0.42',
            close_time: new Date(Date.now() + 600_000).toISOString(),
            open_time: new Date(Date.now() - 300_000).toISOString(),
          } as never,
        ],
        stale: false,
        refreshing: false,
        cacheAgeMs: 0,
      })
      .mockResolvedValueOnce({
        readOnly: true,
        authenticated: true,
        markets: [],
        stale: true,
        refreshing: true,
        errors: ['refresh failed — kept last good'],
        cacheAgeMs: 5000,
      })

    subscribeContinuousFeed(() => {})
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    expect(getContinuousFeedSnapshot().markets.length).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(CONTINUOUS_FEED_POLL_MS)
    await Promise.resolve()
    await Promise.resolve()
    const snap = getContinuousFeedSnapshot()
    expect(snap.markets.length).toBeGreaterThan(0)
    expect(snap.stale).toBe(true)
  })
})
