/**
 * Browser client for the local read-only Kalshi proxy (/local-api/*).
 * Never holds the private key.
 */

import { parseOrderbookFp, type OrderBookSnapshot } from './orderbook'

export interface LocalApiHealth {
  ok: boolean
  readOnly: boolean
  credentialsLoaded: boolean
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
