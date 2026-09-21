import type { KalshiMarketRaw, KalshiMarketsResponse } from '../../types/kalshi'
import type { Crypto15mMarket, FetchCrypto15mResult } from '../../types/crypto15m'
import { CRYPTO_15M_SERIES, isCrypto15mMarket } from './detect'
import { normalizeCrypto15m } from './normalize'
import { recordMid } from './midHistory'
import { fetchLocalCrypto15m } from './mm/liveBook'

const LIVE_BASES = ['/api/kalshi', '/api/kalshi-ext'] as const

/** Proxy gets its own budget — must not starve public fallback. */
export const PROXY_TIMEOUT_MS = 22_000
/** Fresh budget for public series + open-scan after proxy finishes (ok or not). */
export const PUBLIC_TIMEOUT_MS = 12_000
/** Single-market lookups (resolution). */
const MARKET_LOOKUP_TIMEOUT_MS = 12_000

export type FetchCrypto15mBudgets = {
  proxyMs?: number
  publicMs?: number
}

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

function formatFetchError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'AbortError' || /aborted/i.test(e.message)) return 'aborted'
    return e.message || e.name
  }
  return String(e)
}

/** Caller AbortSignal (Strict Mode / effect cleanup) — not a live outage. */
export function isAbortReason(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (e instanceof Error) {
    return e.name === 'AbortError' || /aborted/i.test(e.message)
  }
  return false
}

/** Quiet result when the caller aborted — never LIVE-ONLY FAILURE / never demo. */
function abortedFetchResult(seriesList: readonly string[]): FetchCrypto15mResult {
  return {
    markets: [],
    source: 'live',
    fetchedAt: new Date().toISOString(),
    seriesTried: [...seriesList],
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
    error: errors.length ? `${via}: ${errors.slice(0, 3).join(' | ')}` : undefined,
    seriesTried: [...seriesList],
  }
}

/**
 * Fetch open crypto 15m markets — proxy preferred, then public Kalshi API.
 * LIVE ONLY: no demo / offline fixtures. If proxy + public both fail, returns
 * empty markets with a loud error (UI shows LIVE-ONLY failure).
 *
 * Caller AbortSignal aborts (React Strict Mode / effect cleanup) are quiet:
 * no LIVE-ONLY FAILURE, no console.error, no demo fallback.
 *
 * Proxy and public use **separate** AbortSignal budgets so a slow/aborted proxy
 * cannot burn the public fallback timeout.
 */
export async function fetchCrypto15mMarkets(
  signal?: AbortSignal,
  seriesList: readonly string[] = CRYPTO_15M_SERIES,
  budgets?: FetchCrypto15mBudgets,
): Promise<FetchCrypto15mResult> {
  if (signal?.aborted) return abortedFetchResult(seriesList)

  const proxyMs = budgets?.proxyMs ?? PROXY_TIMEOUT_MS
  const publicMs = budgets?.publicMs ?? PUBLIC_TIMEOUT_MS
  const errors: string[] = []
  const byTicker = new Map<string, KalshiMarketRaw>()

  // 1) Local mm-proxy — own timeout (preferred while RUNNING / near-real)
  {
    const { signal: proxyTimed, clear } = mergeAbort(signal, proxyMs)
    try {
      const proxy = await fetchLocalCrypto15m(proxyTimed)
      if (signal?.aborted) return abortedFetchResult(seriesList)
      if (proxy.markets.length > 0) {
        for (const m of proxy.markets) {
          if (isCrypto15mMarket(m)) byTicker.set(m.ticker, m)
        }
        if (byTicker.size > 0) {
          if (proxy.errors?.length) errors.push(...proxy.errors.slice(0, 3))
          return finalizeLive(byTicker, errors, seriesList, 'proxy')
        }
        errors.push('proxy: markets filtered to empty')
      } else {
        // Proxy reachable but between windows — still try public.
        errors.push('proxy: empty open set')
      }
    } catch (e) {
      // Caller abort (Strict Mode) — quiet exit. Proxy-budget timeout continues to public.
      if (signal?.aborted) return abortedFetchResult(seriesList)
      errors.push(`proxy: ${formatFetchError(e)}`)
    } finally {
      clear()
    }
  }

  if (signal?.aborted) return abortedFetchResult(seriesList)

  // 2) Public Kalshi Trade API via Vite proxies — fresh timeout (never inherits proxy abort)
  {
    const { signal: publicTimed, clear } = mergeAbort(signal, publicMs)
    try {
      for (const base of LIVE_BASES) {
        if (signal?.aborted || publicTimed.aborted) break
        let anyOk = false
        for (const series of seriesList) {
          if (signal?.aborted || publicTimed.aborted) break
          try {
            const markets = await fetchSeries(base, series, publicTimed)
            anyOk = true
            for (const m of markets) {
              if (isCrypto15mMarket(m)) byTicker.set(m.ticker, m)
            }
          } catch (e) {
            const msg = formatFetchError(e)
            errors.push(`${base}/${series}: ${msg}`)
          }
        }
        if (anyOk && byTicker.size > 0) break
      }

      if (byTicker.size === 0) {
        // Last resort: broad open scrape filtered client-side
        for (const base of LIVE_BASES) {
          if (signal?.aborted || publicTimed.aborted) break
          try {
            const url = `${base}/markets?status=open&limit=200&mve_filter=exclude`
            const res = await fetch(url, {
              signal: publicTimed,
              headers: { Accept: 'application/json' },
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = (await res.json()) as KalshiMarketsResponse
            for (const m of data.markets ?? []) {
              if (isCrypto15mMarket(m)) byTicker.set(m.ticker, m)
            }
            if (byTicker.size > 0) break
          } catch (e) {
            errors.push(`${base}/open-scan: ${formatFetchError(e)}`)
          }
        }
      }

      if (byTicker.size > 0) {
        return finalizeLive(byTicker, errors, seriesList, 'public')
      }
    } finally {
      clear()
    }
  }

  // Caller abort / Strict Mode cleanup — never treat as live outage
  if (signal?.aborted) return abortedFetchResult(seriesList)

  // 3) Empty result — distinguish abort-only noise from real completed outages.
  // Timeout AbortErrors are labeled "aborted"; overlapping poll / Strict Mode races
  // must NOT sticky LIVE-ONLY FAILURE or console.error.
  const detail =
    errors.join(' | ') ||
    'proxy and public both returned no markets'
  if (errorsAreAbortOnly(errors)) {
    return {
      markets: [],
      source: 'live',
      fetchedAt: new Date().toISOString(),
      // Soft — Lab keeps last universe; UI must not treat as LIVE-ONLY FAILURE.
      error: `Transient abort (retrying): ${detail}`,
      seriesTried: [...seriesList],
    }
  }

  // Real completed failure (HTTP/network/empty) — loud LIVE-ONLY, no demo.
  const loud =
    `LIVE-ONLY FAILURE: no crypto 15m markets (online sources only — demo removed). ${detail}`
  console.error(`[crypto15m] ${loud}`)
  return {
    markets: [],
    source: 'live',
    fetchedAt: new Date().toISOString(),
    error: loud,
    seriesTried: [...seriesList],
  }
}

/** True when every collected error is only an AbortError/"aborted" label. */
function errorsAreAbortOnly(errors: string[]): boolean {
  if (errors.length === 0) return false
  return errors.every(
    (e) =>
      /^aborted$/i.test(e.trim()) ||
      /:\s*aborted\b/i.test(e) ||
      /^The operation was aborted$/i.test(e.trim()),
  )
}

function byRemaining(a: Crypto15mMarket, b: Crypto15mMarket): number {
  return a.minutesRemaining - b.minutesRemaining
}

/** Fetch a single market by ticker (for resolution checks). */
export async function fetchMarketByTicker(
  ticker: string,
  signal?: AbortSignal,
): Promise<KalshiMarketRaw | null> {
  const { signal: timed, clear } = mergeAbort(signal, MARKET_LOOKUP_TIMEOUT_MS)
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
