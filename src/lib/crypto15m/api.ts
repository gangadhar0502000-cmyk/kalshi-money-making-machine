import type { KalshiMarketRaw, KalshiMarketsResponse } from '../../types/kalshi'
import type { Crypto15mMarket, FetchCrypto15mResult } from '../../types/crypto15m'
import { getDemoCrypto15m } from '../../fixtures/demoCrypto15m'
import { CRYPTO_15M_SERIES, isCrypto15mMarket } from './detect'
import { normalizeCrypto15m } from './normalize'
import { recordMid } from './midHistory'
import { seedDemoMidHistory } from './seedDemoHistory'
import { fetchLocalCrypto15m } from './mm/liveBook'

const LIVE_BASES = ['/api/kalshi', '/api/kalshi-ext'] as const

/** Hard cap so Lab never sits on "Refreshing…" for minutes. */
const FETCH_TIMEOUT_MS = 12_000

function mergeAbort(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal
  clear: () => void
} {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const onAbort = () => {
    clearTimeout(timer)
    ac.abort()
  }
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      ac.abort()
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }
  return {
    signal: ac.signal,
    clear: () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    },
  }
}

async function fetchSeries(
  base: string,
  seriesTicker: string,
  signal?: AbortSignal,
): Promise<KalshiMarketRaw[]> {
  const url = `${base}/markets?series_ticker=${encodeURIComponent(seriesTicker)}&status=open&limit=20&mve_filter=exclude`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${seriesTicker}: HTTP ${res.status}`)
  const data = (await res.json()) as KalshiMarketsResponse
  return Array.isArray(data.markets) ? data.markets : []
}

function finalizeLive(
  byTicker: Map<string, KalshiMarketRaw>,
  errors: string[],
  seriesList: readonly string[],
  via: string,
): FetchCrypto15mResult {
  const markets: Crypto15mMarket[] = [...byTicker.values()]
    .map((m) => {
      const n = normalizeCrypto15m(m)
      recordMid(n.ticker, n.midYes)
      return n
    })
    .sort(byRemaining)

  return {
    markets,
    source: 'live',
    fetchedAt: new Date().toISOString(),
    error:
      errors.length
        ? `${via}: ${errors.slice(0, 3).join(' | ')}`
        : via !== 'public'
          ? undefined
          : undefined,
    seriesTried: [...seriesList],
  }
}

/**
 * Fetch open crypto 15m markets — proxy preferred, public fallback, demo last.
 * Always times out so UI never hangs on "Refreshing…" for minutes.
 */
export async function fetchCrypto15mMarkets(
  signal?: AbortSignal,
  seriesList: readonly string[] = CRYPTO_15M_SERIES,
): Promise<FetchCrypto15mResult> {
  const { signal: timed, clear } = mergeAbort(signal, FETCH_TIMEOUT_MS)
  const errors: string[] = []
  const byTicker = new Map<string, KalshiMarketRaw>()

  try {
    // 1) Local mm-proxy (preferred while RUNNING / near-real)
    try {
      const proxy = await fetchLocalCrypto15m(timed)
      if (proxy && proxy.markets.length > 0) {
        for (const m of proxy.markets) {
          if (isCrypto15mMarket(m)) byTicker.set(m.ticker, m)
        }
        if (byTicker.size > 0) {
          if (proxy.errors?.length) errors.push(...proxy.errors.slice(0, 3))
          return finalizeLive(byTicker, errors, seriesList, 'proxy')
        }
      } else if (proxy && proxy.markets.length === 0) {
        // Proxy reachable but between windows — do not fall through to stale demo yet;
        // still try public in case proxy series list lagged.
        errors.push('proxy: empty open set')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`proxy: ${msg}`)
    }

    // 2) Public Kalshi Trade API via Vite proxies
    for (const base of LIVE_BASES) {
      if (timed.aborted) break
      let anyOk = false
      for (const series of seriesList) {
        if (timed.aborted) break
        try {
          const markets = await fetchSeries(base, series, timed)
          anyOk = true
          for (const m of markets) {
            if (isCrypto15mMarket(m)) byTicker.set(m.ticker, m)
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push(`${base}/${series}: ${msg}`)
        }
      }
      if (anyOk && byTicker.size > 0) break
    }

    if (byTicker.size === 0) {
      // Last resort: broad open scrape filtered client-side
      for (const base of LIVE_BASES) {
        if (timed.aborted) break
        try {
          const url = `${base}/markets?status=open&limit=200&mve_filter=exclude`
          const res = await fetch(url, { signal: timed, headers: { Accept: 'application/json' } })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = (await res.json()) as KalshiMarketsResponse
          for (const m of data.markets ?? []) {
            if (isCrypto15mMarket(m)) byTicker.set(m.ticker, m)
          }
          if (byTicker.size > 0) break
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push(`${base}/open-scan: ${msg}`)
        }
      }
    }

    if (byTicker.size > 0) {
      return finalizeLive(byTicker, errors, seriesList, 'public')
    }

    // 3) Demo fixtures (offline / all sources empty)
    const markets = getDemoCrypto15m().map((m) => {
      const n = normalizeCrypto15m(m)
      recordMid(n.ticker, n.midYes)
      return n
    }).sort(byRemaining)
    seedDemoMidHistory(markets)
    return {
      markets,
      source: 'demo',
      fetchedAt: new Date().toISOString(),
      error: errors.join(' | ') || 'Live crypto 15m fetch failed',
      seriesTried: [...seriesList],
    }
  } finally {
    clear()
  }
}

function byRemaining(a: Crypto15mMarket, b: Crypto15mMarket): number {
  return a.minutesRemaining - b.minutesRemaining
}

/** Fetch a single market by ticker (for resolution checks). */
export async function fetchMarketByTicker(
  ticker: string,
  signal?: AbortSignal,
): Promise<KalshiMarketRaw | null> {
  const { signal: timed, clear } = mergeAbort(signal, FETCH_TIMEOUT_MS)
  try {
    for (const base of LIVE_BASES) {
      try {
        const res = await fetch(`${base}/markets/${encodeURIComponent(ticker)}`, {
          signal: timed,
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) continue
        const data = (await res.json()) as { market?: KalshiMarketRaw }
        if (data.market) return data.market
      } catch {
        /* try next */
      }
    }
    return null
  } finally {
    clear()
  }
}
