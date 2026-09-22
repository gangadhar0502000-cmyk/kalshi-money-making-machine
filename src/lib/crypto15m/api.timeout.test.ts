import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAbortOnlyError, shouldApplyLabRefresh } from './labRefresh'

function liveMarket(ticker = 'KXBTC15M-26SEP211600') {
  return {
    ticker,
    event_ticker: 'KXBTC15M-26SEP211600',
    title: 'BTC price up in next 15 mins?',
    status: 'open',
    close_time: new Date(Date.now() + 10 * 60_000).toISOString(),
    open_time: new Date(Date.now() - 5 * 60_000).toISOString(),
    yes_bid_dollars: '0.48',
    yes_ask_dollars: '0.52',
    floor_strike: 94000,
    rules_primary: 'YES if up',
  }
}

describe('fetchCrypto15mMarkets · timeout isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('slow/aborted proxy + fast public → live (not demo)', async () => {
    const { fetchCrypto15mMarkets } = await import('./api')
    const publicM = liveMarket('KXBTC15M-PUBLIC-FAST')

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/local-api/crypto15m')) {
          // Hang until the proxy AbortSignal fires — must NOT prevent public fallback.
          await new Promise<never>((_resolve, reject) => {
            const s = init?.signal
            const fail = () => {
              const err = new Error('The operation was aborted')
              err.name = 'AbortError'
              reject(err)
            }
            if (s?.aborted) return fail()
            s?.addEventListener('abort', fail, { once: true })
          })
        }
        if (url.includes('/markets') && url.includes('series_ticker=')) {
          return {
            ok: true,
            json: async () => ({ markets: [publicM] }),
          } as Response
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response
      }),
    )

    const result = await fetchCrypto15mMarkets(undefined, ['KXBTC15M'], {
      proxyMs: 40,
      publicMs: 2_000,
    })

    expect(result.source).toBe('live')
    expect(result.markets.some((m) => m.ticker === 'KXBTC15M-PUBLIC-FAST')).toBe(true)
    expect(result.error ?? '').toMatch(/proxy:\s*aborted/i)
  })

  it('proxy + public fail → LIVE-ONLY empty (not demo)', async () => {
    const { fetchCrypto15mMarkets } = await import('./api')

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/local-api/crypto15m')) {
          return { ok: false, status: 502, json: async () => ({}) } as Response
        }
        // Public also fails → empty live, not demo
        throw new Error('network down')
      }),
    )

    const result = await fetchCrypto15mMarkets(undefined, ['KXBTC15M'], {
      proxyMs: 500,
      publicMs: 500,
    })

    expect(result.source).not.toBe('demo')
    expect(result.source).toBe('live')
    expect(result.markets).toEqual([])
    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/LIVE-ONLY FAILURE/i)
    expect(result.error).toMatch(/proxy:\s*HTTP 502/i)
  })

  it('proxy+public abort-only → soft transient (NOT LIVE-ONLY, no console.error)', async () => {
    const { fetchCrypto15mMarkets } = await import('./api')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/local-api/crypto15m')) {
          await new Promise<never>((_resolve, reject) => {
            const s = init?.signal
            const fail = () => {
              const err = new Error('aborted')
              err.name = 'AbortError'
              reject(err)
            }
            if (s?.aborted) return fail()
            s?.addEventListener('abort', fail, { once: true })
          })
        }
        // Public also times out / aborts — abort-only path, not HTTP failure
        await new Promise<never>((_resolve, reject) => {
          const s = init?.signal
          const fail = () => {
            const err = new Error('The operation was aborted')
            err.name = 'AbortError'
            reject(err)
          }
          if (s?.aborted) return fail()
          s?.addEventListener('abort', fail, { once: true })
        })
      }),
    )

    const result = await fetchCrypto15mMarkets(undefined, ['KXBTC15M'], {
      proxyMs: 30,
      publicMs: 30,
    })
    expect(result.source).toBe('live')
    expect(result.markets).toEqual([])
    expect(result.error ?? '').not.toMatch(/LIVE-ONLY FAILURE/i)
    expect(result.error ?? '').toMatch(/Transient abort|aborted/i)
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('caller AbortSignal abort → no LIVE-ONLY FAILURE / no demo / no console.error', async () => {
    const { fetchCrypto15mMarkets } = await import('./api')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        await new Promise<never>((_resolve, reject) => {
          const s = init?.signal
          const fail = () => {
            const err = new Error('The operation was aborted')
            err.name = 'AbortError'
            reject(err)
          }
          if (s?.aborted) return fail()
          s?.addEventListener('abort', fail, { once: true })
        })
      }),
    )

    const ac = new AbortController()
    const pending = fetchCrypto15mMarkets(ac.signal, ['KXBTC15M'], {
      proxyMs: 5_000,
      publicMs: 5_000,
    })
    ac.abort()
    const result = await pending

    expect(result.source).toBe('live')
    expect(result.source).not.toBe('demo')
    expect(result.error ?? '').not.toMatch(/LIVE-ONLY FAILURE/i)
    expect(result.error).toBeUndefined()
    expect(errSpy).not.toHaveBeenCalled()
    // Must not look like a completed outage with a loud failure string
    expect(errSpy.mock.calls.flat().join(' ')).not.toMatch(/LIVE-ONLY FAILURE/i)
  })

  it('already-aborted signal → quiet empty (no LIVE-ONLY / no demo)', async () => {
    const { fetchCrypto15mMarkets } = await import('./api')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const ac = new AbortController()
    ac.abort()
    const result = await fetchCrypto15mMarkets(ac.signal, ['KXBTC15M'])

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.source).not.toBe('demo')
    expect(result.markets).toEqual([])
    expect(result.error ?? '').not.toMatch(/LIVE-ONLY FAILURE/i)
    expect(errSpy).not.toHaveBeenCalled()
  })
})

describe('Lab live-only refresh', () => {
  it('stale demo is replaced when live returns markets', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: 'demo',
        next: { source: 'live', markets: [{ ticker: 'X' } as never] },
        lastMarketsLen: 5,
      }),
    ).toBe('apply')
  })

  it('keeps last LIVE universe on empty refresh (rollover)', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: 'live',
        next: { source: 'live', markets: [] },
        lastMarketsLen: 3,
        lastOpenCount: 3,
      }),
    ).toBe('keep-last')
  })

  it('settled-only non-abort empty → apply empty (do not glue dead books)', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: 'live',
        next: {
          source: 'live',
          markets: [],
          error: 'LIVE-ONLY FAILURE: proxy: HTTP 502 | public: network down',
        },
        lastMarketsLen: 14,
        lastOpenCount: 0,
      }),
    ).toBe('apply')
  })

  it('settled-only abort-only empty → keep-last (never apply empty)', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: 'live',
        next: {
          source: 'live',
          markets: [],
          error: 'Transient abort (retrying): proxy: aborted',
        },
        lastMarketsLen: 14,
        lastOpenCount: 0,
      }),
    ).toBe('keep-last')
  })

  it('cold abort-only empty → ignore (len 0)', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: null,
        next: {
          source: 'live',
          markets: [],
          error: 'Transient abort (retrying): proxy: aborted',
        },
        lastMarketsLen: 0,
        lastOpenCount: 0,
      }),
    ).toBe('ignore')
  })

  it('open markets still keep-last on abort-only empty', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: 'live',
        next: {
          source: 'live',
          markets: [],
          error: 'Transient abort (retrying): proxy: aborted',
        },
        lastMarketsLen: 14,
        lastOpenCount: 5,
      }),
    ).toBe('keep-last')
  })

  it('cold-start empty live applies empty (LIVE-ONLY failure, not fixtures)', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: null,
        next: { source: 'live', markets: [], error: 'LIVE-ONLY FAILURE' },
        lastMarketsLen: 0,
      }),
    ).toBe('apply')
  })

  it('wipes stale demo on live empty failure', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: 'demo',
        next: { source: 'live', markets: [], error: 'LIVE-ONLY FAILURE' },
        lastMarketsLen: 5,
      }),
    ).toBe('apply')
  })

  it('overlapping refresh / abort-only empty keeps last markets (not LIVE-ONLY apply)', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: 'live',
        next: {
          source: 'live',
          markets: [],
          error: 'Transient abort (retrying): proxy: aborted | /api/kalshi/KXBTC15M: aborted',
        },
        lastMarketsLen: 14,
      }),
    ).toBe('keep-last')
  })

  it('abort-only errors ≠ LIVE-ONLY FAILURE decision on cold start (ignore)', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: null,
        next: {
          source: 'live',
          markets: [],
          error: 'proxy: aborted | /api/kalshi/KXBTC15M: aborted',
        },
        lastMarketsLen: 0,
      }),
    ).toBe('ignore')
  })

  it('quiet abortedFetchResult (no error) is ignore on cold start', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: null,
        next: { source: 'live', markets: [] },
        lastMarketsLen: 0,
      }),
    ).toBe('ignore')
  })
})


describe('isAbortOnlyError', () => {
  it('treats aborted-only strings as abort-only (not LIVE-ONLY)', () => {
    expect(isAbortOnlyError('proxy: aborted | /api/kalshi/KXBTC15M: aborted')).toBe(true)
    expect(isAbortOnlyError('Transient abort (retrying): proxy: aborted')).toBe(true)
    expect(isAbortOnlyError(undefined)).toBe(true)
    expect(isAbortOnlyError('')).toBe(true)
  })

  it('real HTTP/network failures are not abort-only', () => {
    expect(isAbortOnlyError('proxy: HTTP 502 | network down')).toBe(false)
    expect(
      isAbortOnlyError(
        'LIVE-ONLY FAILURE: no crypto 15m markets (online sources only — demo removed). proxy: HTTP 502',
      ),
    ).toBe(false)
  })
})
