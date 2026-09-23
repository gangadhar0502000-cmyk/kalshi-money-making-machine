import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  __resetContinuousFeedForTests,
  __continuousFeedInFlightForTests,
  __continuousFeedGenerationForTests,
  getContinuousFeedSnapshot,
  subscribeContinuousFeed,
  kickContinuousFeedPoll,
  CONTINUOUS_FEED_POLL_MS,
  CONTINUOUS_FEED_FETCH_TIMEOUT_MS,
} from './continuousFeed'
import * as liveBook from './liveBook'

const sampleMarket = {
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
} as never

const okPayload = {
  readOnly: true,
  authenticated: true,
  markets: [sampleMarket],
  fetchedAt: '2026-09-22T12:00:00.000Z',
  cacheAgeMs: 50,
  stale: false,
  refreshing: false,
}

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
      markets: [sampleMarket],
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
    expect(CONTINUOUS_FEED_POLL_MS).toBe(500)
    expect(CONTINUOUS_FEED_FETCH_TIMEOUT_MS).toBe(2500)

    // Second poll ~500ms later — lastSuccessAt must advance (cache hit still counts)
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
        markets: [sampleMarket],
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

  it('times out hung fetch: clears inFlight, leaves lastSuccessAt, allows next poll', async () => {
    let mode: 'ok' | 'hang' | 'ok-again' = 'ok'
    const spy = vi.spyOn(liveBook, 'fetchLocalCrypto15m').mockImplementation((signal) => {
      if (mode === 'hang') {
        return new Promise((_resolve, reject) => {
          const onAbort = () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          }
          if (signal?.aborted) {
            onAbort()
            return
          }
          signal?.addEventListener('abort', onAbort, { once: true })
        })
      }
      return Promise.resolve(okPayload)
    })

    subscribeContinuousFeed(() => {})
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()

    const first = getContinuousFeedSnapshot()
    expect(first.everSucceeded).toBe(true)
    const prevOk = first.lastSuccessAt!
    expect(prevOk).toBeTruthy()

    // Next poll hangs until self-abort (2.5s)
    mode = 'hang'
    await vi.advanceTimersByTimeAsync(CONTINUOUS_FEED_POLL_MS)
    await Promise.resolve()
    expect(__continuousFeedInFlightForTests()).toBe(true)
    expect(getContinuousFeedSnapshot().lastSuccessAt).toBe(prevOk)

    await vi.advanceTimersByTimeAsync(CONTINUOUS_FEED_FETCH_TIMEOUT_MS)
    await Promise.resolve()
    await Promise.resolve()

    const afterTimeout = getContinuousFeedSnapshot()
    expect(afterTimeout.lastSuccessAt).toBe(prevOk)
    expect(afterTimeout.lastError).toMatch(/feed poll timeout \(2\.5s\)/)

    mode = 'ok-again'
    if (__continuousFeedInFlightForTests()) {
      await vi.advanceTimersByTimeAsync(CONTINUOUS_FEED_FETCH_TIMEOUT_MS)
      await Promise.resolve()
      await Promise.resolve()
    }
    await vi.advanceTimersByTimeAsync(CONTINUOUS_FEED_POLL_MS)
    await Promise.resolve()
    await Promise.resolve()

    const afterNext = getContinuousFeedSnapshot()
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(afterNext.everSucceeded).toBe(true)
    expect(afterNext.lastSuccessAt).toBeTruthy()
    expect(Date.parse(afterNext.lastSuccessAt!) >= Date.parse(prevOk)).toBe(true)
    expect(__continuousFeedInFlightForTests()).toBe(false)
  })

  it('overlapping polls: abort-previous lets second write; late first cannot mutate', async () => {
    type Pending = {
      signal?: AbortSignal
      resolve: (v: typeof okPayload) => void
    }
    const pending: Pending[] = []
    let call = 0

    vi.spyOn(liveBook, 'fetchLocalCrypto15m').mockImplementation((signal) => {
      call++
      if (call === 1) {
        return Promise.resolve(okPayload)
      }
      // Ignore AbortSignal — simulates a hung browser fetch that does not reject on abort.
      return new Promise((resolve) => {
        pending.push({ signal, resolve: resolve as (v: typeof okPayload) => void })
      })
    })

    subscribeContinuousFeed(() => {})
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()

    const afterFirst = getContinuousFeedSnapshot()
    expect(afterFirst.everSucceeded).toBe(true)
    const prevOk = afterFirst.lastSuccessAt!
    const genAfterFirst = __continuousFeedGenerationForTests()

    // Scheduled tick starts hung poll (gen N) that ignores abort
    await vi.advanceTimersByTimeAsync(CONTINUOUS_FEED_POLL_MS)
    await Promise.resolve()
    expect(pending.length).toBe(1)
    expect(__continuousFeedInFlightForTests()).toBe(true)
    const genHung = __continuousFeedGenerationForTests()
    expect(genHung).toBeGreaterThan(genAfterFirst)

    // Overlapping poll via kick — aborts previous controller, starts gen N+1 (also pending)
    kickContinuousFeedPoll()
    await Promise.resolve()
    await Promise.resolve()

    expect(pending[0]!.signal?.aborted).toBe(true)
    expect(pending.length).toBe(2)
    const genSecond = __continuousFeedGenerationForTests()
    expect(genSecond).toBeGreaterThan(genHung)
    // inFlight tracks the *current* gen, which is still outstanding
    expect(__continuousFeedInFlightForTests()).toBe(true)

    // Second gen succeeds
    pending[1]!.resolve({
      ...okPayload,
      fetchedAt: '2026-09-22T12:00:01.000Z',
      cacheAgeMs: 10,
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const afterSecond = getContinuousFeedSnapshot()
    expect(afterSecond.lastSuccessAt).toBeTruthy()
    expect(Date.parse(afterSecond.lastSuccessAt!) >= Date.parse(prevOk)).toBe(true)
    expect(afterSecond.fetchedAt).toBe('2026-09-22T12:00:01.000Z')
    expect(__continuousFeedInFlightForTests()).toBe(false)

    // Late response from aborted gen must not mutate snapshot / stick inFlight
    const frozen = afterSecond.lastSuccessAt!
    pending[0]!.resolve({
      ...okPayload,
      fetchedAt: 'STALE-SHOULD-NOT-WRITE',
      cacheAgeMs: 99999,
    })
    await Promise.resolve()
    await Promise.resolve()

    const afterLate = getContinuousFeedSnapshot()
    expect(afterLate.lastSuccessAt).toBe(frozen)
    expect(afterLate.fetchedAt).not.toBe('STALE-SHOULD-NOT-WRITE')
    expect(__continuousFeedInFlightForTests()).toBe(false)
  })
})
