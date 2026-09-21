import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldApplyLabRefresh } from './labRefresh'

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

  it('proxy HTTP failure surfaces real reason in demo error (not bare default)', async () => {
    const { fetchCrypto15mMarkets } = await import('./api')

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/local-api/crypto15m')) {
          return { ok: false, status: 502, json: async () => ({}) } as Response
        }
        // Public also fails → demo
        throw new Error('network down')
      }),
    )

    const result = await fetchCrypto15mMarkets(undefined, ['KXBTC15M'], {
      proxyMs: 500,
      publicMs: 500,
    })

    expect(result.source).toBe('demo')
    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/proxy:\s*HTTP 502/i)
    // Must not be only the misleading bare default with no detail
    expect(result.error).not.toBe('Live crypto 15m fetch failed')
  })

  it('proxy abort surfaces aborted reason', async () => {
    const { fetchCrypto15mMarkets } = await import('./api')

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
        throw new Error('public also down')
      }),
    )

    const result = await fetchCrypto15mMarkets(undefined, ['KXBTC15M'], {
      proxyMs: 30,
      publicMs: 30,
    })
    expect(result.source).toBe('demo')
    expect(result.error ?? '').toMatch(/proxy:\s*aborted/i)
  })
})

describe('Lab demo → live recovery', () => {
  it('demo is not sticky when live returns markets', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: 'demo',
        next: { source: 'live', markets: [{ ticker: 'X' } as never] },
        lastMarketsLen: 5,
      }),
    ).toBe('apply')
  })

  it('keeps last universe on empty refresh', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: 'live',
        next: { source: 'live', markets: [] },
        lastMarketsLen: 3,
      }),
    ).toBe('keep-last')
  })

  it('applies demo when nothing else available and last is empty', () => {
    expect(
      shouldApplyLabRefresh({
        prevSource: null,
        next: { source: 'demo', markets: [{ ticker: 'D' } as never] },
        lastMarketsLen: 0,
      }),
    ).toBe('apply')
  })
})
