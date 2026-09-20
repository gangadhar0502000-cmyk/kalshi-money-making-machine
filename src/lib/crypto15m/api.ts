import type { KalshiMarketRaw, KalshiMarketsResponse } from '../../types/kalshi'
import type { Crypto15mMarket, FetchCrypto15mResult } from '../../types/crypto15m'
import { DEMO_CRYPTO_15M } from '../../fixtures/demoCrypto15m'
import { CRYPTO_15M_SERIES, isCrypto15mMarket } from './detect'
import { normalizeCrypto15m } from './normalize'
import { recordMid } from './midHistory'
import { seedDemoMidHistory } from './seedDemoHistory'

const LIVE_BASES = ['/api/kalshi', '/api/kalshi-ext'] as const

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

/**
 * Fetch open crypto 15m markets from known series, with demo fallback.
 * Also records mid samples for rule lookbacks.
 */
export async function fetchCrypto15mMarkets(
  signal?: AbortSignal,
  seriesList: readonly string[] = CRYPTO_15M_SERIES,
): Promise<FetchCrypto15mResult> {
  const errors: string[] = []
  const byTicker = new Map<string, KalshiMarketRaw>()

  for (const base of LIVE_BASES) {
    let anyOk = false
    // Sequential with small batches to reduce 429s
    for (const series of seriesList) {
      if (signal?.aborted) break
      try {
        const markets = await fetchSeries(base, series, signal)
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
      try {
        const url = `${base}/markets?status=open&limit=200&mve_filter=exclude`
        const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
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

  if (byTicker.size === 0) {
    const markets = DEMO_CRYPTO_15M.map((m) => {
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
  }

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
    error: errors.length ? errors.slice(0, 3).join(' | ') : undefined,
    seriesTried: [...seriesList],
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
  for (const base of LIVE_BASES) {
    try {
      const res = await fetch(`${base}/markets/${encodeURIComponent(ticker)}`, {
        signal,
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
}
