import { DEMO_MARKETS } from '../fixtures/demoMarkets'
import type { FetchMarketsResult, KalshiMarketRaw, KalshiMarketsResponse } from '../types/kalshi'

const LIVE_PATHS = [
  '/api/kalshi/markets?status=open&limit=200&mve_filter=exclude',
  '/api/kalshi-ext/markets?status=open&limit=200&mve_filter=exclude',
]

async function tryFetch(url: string, signal?: AbortSignal): Promise<KalshiMarketRaw[]> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }
  const data = (await res.json()) as KalshiMarketsResponse | { error?: { message?: string } }
  if ('error' in data && data.error) {
    throw new Error(data.error.message || 'API error')
  }
  const markets = (data as KalshiMarketsResponse).markets
  if (!Array.isArray(markets) || markets.length === 0) {
    throw new Error('Empty markets payload')
  }
  return markets
}

/**
 * Fetch open markets via Vite proxy → Kalshi public Trade API.
 * Falls back to bundled demo fixtures on any failure.
 */
export async function fetchOpenMarkets(signal?: AbortSignal): Promise<FetchMarketsResult> {
  const errors: string[] = []

  for (const path of LIVE_PATHS) {
    try {
      const markets = await tryFetch(path, signal)
      return {
        markets,
        source: 'live',
        fetchedAt: new Date().toISOString(),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${path}: ${msg}`)
    }
  }

  return {
    markets: DEMO_MARKETS,
    source: 'demo',
    fetchedAt: new Date().toISOString(),
    error: errors.join(' | ') || 'Live fetch failed',
  }
}
