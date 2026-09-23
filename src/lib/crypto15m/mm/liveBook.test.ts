import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_BOOK_COALESCE_MS,
  __resetLiveBookCoalesceForTests,
  __liveBookFlushInFlightForTests,
  fetchLiveOrderbook,
  fetchLiveOrderbooks,
} from './liveBook'

const bookPayload = (ticker: string) => ({
  ticker,
  authenticated: true,
  orderbook_fp: {
    yes_dollars: [['0.40', '10']] as [string, string][],
    no_dollars: [['0.55', '8']] as [string, string][],
  },
})

describe('liveBook coalescing (U2.10 / U2.12)', () => {
  beforeEach(() => {
    __resetLiveBookCoalesceForTests()
    vi.useFakeTimers()
  })
  afterEach(() => {
    __resetLiveBookCoalesceForTests()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exports LIVE_BOOK_COALESCE_MS in 50–75ms band', () => {
    expect(LIVE_BOOK_COALESCE_MS).toBeGreaterThanOrEqual(50)
    expect(LIVE_BOOK_COALESCE_MS).toBeLessThanOrEqual(75)
  })

  it('two parallel fetchLiveOrderbook → one batch HTTP', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/local-api/orderbooks?tickers=')
      expect(url).toMatch(/T-A/)
      expect(url).toMatch(/T-B/)
      expect(url).not.toContain('/local-api/orderbook?ticker=')
      return {
        ok: true,
        json: async () => ({
          readOnly: true,
          depth: 25,
          fetchedAt: '2026-09-22T12:00:00.000Z',
          books: {
            'T-A': bookPayload('T-A'),
            'T-B': bookPayload('T-B'),
          },
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const p1 = fetchLiveOrderbook('T-A')
    const p2 = fetchLiveOrderbook('T-B')

    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(LIVE_BOOK_COALESCE_MS)
    const [a, b] = await Promise.all([p1, p2])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a?.ticker).toBe('T-A')
    expect(b?.ticker).toBe('T-B')
    expect(a?.bestBid).toBeCloseTo(0.4)
    expect(b?.authenticated).toBe(true)
  })

  it('batch total failure falls back to single /orderbook per caller', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/local-api/orderbooks?')) {
        throw new Error('batch down')
      }
      if (url.includes('/local-api/orderbook?ticker=')) {
        const u = new URL(url, 'http://localhost')
        const ticker = u.searchParams.get('ticker') || 'X'
        return {
          ok: true,
          json: async () => bookPayload(ticker),
        }
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const p1 = fetchLiveOrderbook('T-A')
    const p2 = fetchLiveOrderbook('T-B')
    await vi.advanceTimersByTimeAsync(LIVE_BOOK_COALESCE_MS)
    const [a, b] = await Promise.all([p1, p2])

    expect(a?.ticker).toBe('T-A')
    expect(b?.ticker).toBe('T-B')
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.filter((u) => u.includes('/orderbooks?')).length).toBe(1)
    expect(urls.filter((u) => u.includes('/orderbook?ticker=')).length).toBe(2)
  })

  it('fetchLiveOrderbooks parses books + per-ticker errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          readOnly: true,
          depth: 25,
          fetchedAt: '2026-09-22T12:00:00.000Z',
          books: { 'T-OK': bookPayload('T-OK') },
          errors: [{ ticker: 'T-BAD', message: 'Kalshi 404' }],
        }),
      })),
    )

    const { books, errors } = await fetchLiveOrderbooks(['T-OK', 'T-BAD'])
    expect(books['T-OK']?.ticker).toBe('T-OK')
    expect(books['T-BAD']).toBeUndefined()
    expect(errors['T-BAD']).toBe('Kalshi 404')
  })

  it('U2.12 serialize: second flush waits until prior batch completes (single-flight)', async () => {
    let batchReleases: Array<() => void> = []
    let batchStarts = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.includes('/local-api/orderbooks?')) {
        throw new Error(`unexpected ${url}`)
      }
      batchStarts++
      await new Promise<void>((resolve) => {
        batchReleases.push(resolve)
      })
      const tickers = new URL(url, 'http://localhost').searchParams.get('tickers')!.split(',')
      const books: Record<string, ReturnType<typeof bookPayload>> = {}
      for (const t of tickers) books[t] = bookPayload(t)
      return {
        ok: true,
        json: async () => ({
          readOnly: true,
          depth: 25,
          fetchedAt: '2026-09-22T12:00:00.000Z',
          books,
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const p1 = fetchLiveOrderbook('T-A')
    await vi.advanceTimersByTimeAsync(LIVE_BOOK_COALESCE_MS)
    await Promise.resolve()
    expect(batchStarts).toBe(1)
    expect(__liveBookFlushInFlightForTests()).toBe(true)

    // New waiters while first flush in flight — must not start a second HTTP yet
    const p2 = fetchLiveOrderbook('T-B')
    await vi.advanceTimersByTimeAsync(LIVE_BOOK_COALESCE_MS)
    await Promise.resolve()
    expect(batchStarts).toBe(1)

    // Release first batch
    batchReleases[0]!()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    // Drain of T-B should start (or complete) after prior finishes
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()

    // Allow second batch if pending
    if (batchReleases.length > 1) {
      batchReleases[1]!()
    }
    const [a, b] = await Promise.all([p1, p2])
    expect(a?.ticker).toBe('T-A')
    expect(b?.ticker).toBe('T-B')
    // Never more than one overlapping batch start before prior release
    expect(batchStarts).toBeGreaterThanOrEqual(1)
    expect(batchStarts).toBeLessThanOrEqual(2)
    // Critical: while first was blocked, second must not have started
    // (asserted above at batchStarts === 1 before release)
  })

  it('U2.13 coalesce: waiters with different sides re-parse same batch raw', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/local-api/orderbooks?tickers=')
      return {
        ok: true,
        json: async () => ({
          readOnly: true,
          depth: 25,
          fetchedAt: '2026-09-22T12:00:00.000Z',
          books: {
            'T-A': bookPayload('T-A'),
          },
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const pYes = fetchLiveOrderbook('T-A', { side: 'yes' })
    const pNo = fetchLiveOrderbook('T-A', { side: 'no' })
    await vi.advanceTimersByTimeAsync(LIVE_BOOK_COALESCE_MS)
    const [yesBook, noBook] = await Promise.all([pYes, pNo])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // YES-primary: bid 0.40, ask 1-0.55=0.45
    expect(yesBook?.bestBid).toBeCloseTo(0.4)
    expect(yesBook?.bestAsk).toBeCloseTo(0.45)
    // NO-primary: bid 0.55, ask 1-0.40=0.60
    expect(noBook?.bestBid).toBeCloseTo(0.55)
    expect(noBook?.bestAsk).toBeCloseTo(0.6)
  })
})
