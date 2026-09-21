/**
 * Browser client for the local read-only Kalshi proxy (/local-api/*).
 * Never holds the private key.
 */

import type { KalshiMarketRaw } from '../../../types/kalshi'
import { parseOrderbookFp, type OrderBookSnapshot } from './orderbook'

export interface LocalApiHealth {
  ok: boolean
  readOnly: boolean
  credentialsLoaded: boolean
  banner?: string
}

export interface LocalCrypto15mResponse {
  readOnly: boolean
  authenticated: boolean
  markets: KalshiMarketRaw[]
  errors?: string[]
  fetchedAt?: string
  banner?: string
}

export async function fetchLocalHealth(signal?: AbortSignal): Promise<LocalApiHealth | null> {
  try {
    const res = await fetch('/local-api/health', { signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as LocalApiHealth
  } catch {
    return null
  }
}

export async function fetchLiveOrderbook(
  ticker: string,
  signal?: AbortSignal,
): Promise<OrderBookSnapshot | null> {
  const url = `/local-api/orderbook?ticker=${encodeURIComponent(ticker)}&depth=25`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`orderbook HTTP ${res.status}`)
  const data = (await res.json()) as {
    ticker?: string
    authenticated?: boolean
    orderbook_fp?: { yes_dollars?: [string, string][]; no_dollars?: [string, string][] }
    error?: string
  }
  if (data.error) throw new Error(data.error)
  return parseOrderbookFp(ticker, data, Boolean(data.authenticated))
}

function formatLocalError(e: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) return new Error('aborted')
  if (e instanceof Error) {
    if (e.name === 'AbortError' || /aborted/i.test(e.message)) return new Error('aborted')
    return e
  }
  return new Error(String(e))
}

/**
 * Prefer proxy path for open crypto 15m universe (authenticated when keys loaded).
 * Throws with a real reason (HTTP status, abort, network) so callers can surface
 * proxy failures instead of silently falling through with an empty error list.
 */
export async function fetchLocalCrypto15m(
  signal?: AbortSignal,
): Promise<LocalCrypto15mResponse> {
  try {
    const res = await fetch('/local-api/crypto15m', {
      signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const data = (await res.json()) as LocalCrypto15mResponse
    if (!Array.isArray(data.markets)) {
      throw new Error('invalid markets payload')
    }
    return data
  } catch (e) {
    throw formatLocalError(e, signal)
  }
}
