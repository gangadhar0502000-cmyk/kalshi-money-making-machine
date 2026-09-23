/**
 * Browser client for the local read-only Kalshi proxy (/local-api/*).
 * Never holds the private key.
 *
 * U2.10: parallel fetchLiveOrderbook calls coalesce into one
 * GET /local-api/orderbooks?tickers=… within LIVE_BOOK_COALESCE_MS so five
 * PaperMmEngines do not exhaust the browser’s ~6 connections/host and starve
 * /local-api/crypto15m.
 *
 * U2.12: browser URLs use getLocalApiBase() → http://127.0.0.1:8787 (separate
 * pool from Vite :5173). Batch flushes are single-flight serialized so N
 * parallel coalesces cannot re-saturate even the :8787 pool.
 */

import type { KalshiMarketRaw } from '../../../types/kalshi'
import { parseOrderbookFp, type OrderBookSnapshot } from './orderbook'
import { localApiUrl } from './localApiBase'

/** Debounce window before flushing pending L2 tickers into one batch GET. */
export const LIVE_BOOK_COALESCE_MS = 60

export interface LocalApiHealth {
  ok: boolean
  readOnly: boolean
  credentialsLoaded: boolean
  banner?: string
  /** U1: universe cache age in ms (null if never succeeded). */
  cacheAgeMs?: number | null
  /** U1: ISO of last successful crypto15m fan-out. */
  lastSuccessAt?: string | null
  refreshing?: boolean
  marketCount?: number
}

export interface LocalCrypto15mResponse {
  readOnly: boolean
  authenticated: boolean
  markets: KalshiMarketRaw[]
  errors?: string[]
  fetchedAt?: string
  banner?: string
  /** U1 cache metadata */
  cacheAgeMs?: number | null
  refreshing?: boolean
  stale?: boolean
}

type OrderbookRawPayload = {
  ticker?: string
  authenticated?: boolean
  orderbook_fp?: { yes_dollars?: [string, string][]; no_dollars?: [string, string][] }
  orderbook?: { yes?: [string | number, string | number][]; no?: [string | number, string | number][] }
  error?: string
}

type BatchOrderbooksResponse = {
  readOnly?: boolean
  depth?: number
  fetchedAt?: string
  books?: Record<string, OrderbookRawPayload>
  errors?: { ticker: string; message: string }[]
  error?: string
}

type CoalesceWaiter = {
  ticker: string
  resolve: (book: OrderBookSnapshot | null) => void
  reject: (err: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

let pendingWaiters: CoalesceWaiter[] = []
let coalesceTimer: ReturnType<typeof setTimeout> | null = null
/** Single-flight: at most one batch flush HTTP in flight at a time. */
let flushInFlight: Promise<void> | null = null
let flushing = false
let flushAgain = false

/** Test helper — clear coalesce queue / timer (drop waiters without rejecting). */
export function __resetLiveBookCoalesceForTests(): void {
  if (coalesceTimer != null) {
    clearTimeout(coalesceTimer)
    coalesceTimer = null
  }
  for (const w of pendingWaiters) {
    if (w.signal && w.onAbort) {
      w.signal.removeEventListener('abort', w.onAbort)
    }
  }
  pendingWaiters = []
  flushInFlight = null
  flushing = false
  flushAgain = false
}

/** Test helper — whether a batch flush is currently in flight. */
export function __liveBookFlushInFlightForTests(): boolean {
  return flushInFlight != null || flushing
}

export async function fetchLocalHealth(signal?: AbortSignal): Promise<LocalApiHealth | null> {
  try {
    const res = await fetch(localApiUrl('/local-api/health'), {
      signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    return (await res.json()) as LocalApiHealth
  } catch {
    return null
  }
}

function parseBookFromPayload(
  ticker: string,
  data: OrderbookRawPayload,
): OrderBookSnapshot | null {
  if (data.error) throw new Error(data.error)
  return parseOrderbookFp(ticker, data, Boolean(data.authenticated))
}

/** Single-ticker GET — used as fail-loud fallback when batch fails entirely. */
async function fetchLiveOrderbookSingle(
  ticker: string,
  signal?: AbortSignal,
): Promise<OrderBookSnapshot | null> {
  const url = localApiUrl(
    `/local-api/orderbook?ticker=${encodeURIComponent(ticker)}&depth=25`,
  )
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`orderbook HTTP ${res.status}`)
  const data = (await res.json()) as OrderbookRawPayload
  return parseBookFromPayload(ticker, data)
}

/**
 * Batch L2 fetch via GET /local-api/orderbooks?tickers=…
 * Returns a map of ticker → parsed book (or null if empty/unparseable).
 * Throws if the batch HTTP call fails entirely (caller may fall back).
 * Per-ticker upstream errors are recorded in `errors` and omitted from `books`.
 */
export async function fetchLiveOrderbooks(
  tickers: string[],
  signal?: AbortSignal,
): Promise<{
  books: Record<string, OrderBookSnapshot | null>
  errors: Record<string, string>
}> {
  const unique = [...new Set(tickers.map((t) => String(t).trim()).filter(Boolean))]
  if (unique.length === 0) {
    return { books: {}, errors: {} }
  }
  const url = localApiUrl(
    `/local-api/orderbooks?tickers=${unique.map(encodeURIComponent).join(',')}&depth=25`,
  )
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`orderbooks HTTP ${res.status}`)
  const data = (await res.json()) as BatchOrderbooksResponse
  if (data.error) throw new Error(data.error)

  const errors: Record<string, string> = {}
  for (const e of data.errors ?? []) {
    if (e?.ticker) errors[e.ticker] = e.message || 'orderbook error'
  }

  const books: Record<string, OrderBookSnapshot | null> = {}
  const rawBooks = data.books ?? {}
  for (const ticker of unique) {
    if (errors[ticker]) continue
    const raw = rawBooks[ticker]
    if (!raw) {
      books[ticker] = null
      continue
    }
    books[ticker] = parseBookFromPayload(ticker, raw)
  }
  return { books, errors }
}

async function flushCoalescedOrderbooksBody(waiters: CoalesceWaiter[]): Promise<void> {
  for (const w of waiters) {
    if (w.signal && w.onAbort) {
      w.signal.removeEventListener('abort', w.onAbort)
    }
  }

  const tickers = [...new Set(waiters.map((w) => w.ticker))]

  let batch: { books: Record<string, OrderBookSnapshot | null>; errors: Record<string, string> } | null =
    null
  let batchErr: unknown = null
  try {
    // No shared AbortSignal — individual waiters may already be aborted.
    batch = await fetchLiveOrderbooks(tickers)
  } catch (e) {
    batchErr = e
  }

  if (batch) {
    for (const w of waiters) {
      if (w.signal?.aborted) {
        w.reject(new Error('aborted'))
        continue
      }
      const errMsg = batch.errors[w.ticker]
      if (errMsg) {
        w.reject(new Error(errMsg))
        continue
      }
      try {
        w.resolve(batch.books[w.ticker] ?? null)
      } catch (e) {
        w.reject(e)
      }
    }
    return
  }

  // Batch endpoint failed entirely — fail-loud single fallback per waiter.
  await Promise.all(
    waiters.map(async (w) => {
      if (w.signal?.aborted) {
        w.reject(new Error('aborted'))
        return
      }
      try {
        const book = await fetchLiveOrderbookSingle(w.ticker, w.signal)
        w.resolve(book)
      } catch (e) {
        w.reject(e instanceof Error ? e : new Error(String(e ?? batchErr)))
      }
    }),
  )
}

/**
 * Serialize batch flushes (single-flight). If a flush is already running,
 * mark flushAgain and return; the active flusher drains new waiters when done.
 * Prevents N parallel batch GETs re-saturating the :8787 connection pool.
 */
async function flushCoalescedOrderbooks(): Promise<void> {
  if (flushing) {
    flushAgain = true
    return
  }
  flushing = true
  const run = (async () => {
    try {
      do {
        flushAgain = false
        if (coalesceTimer != null) {
          clearTimeout(coalesceTimer)
          coalesceTimer = null
        }
        const waiters = pendingWaiters
        pendingWaiters = []
        if (waiters.length === 0) continue
        await flushCoalescedOrderbooksBody(waiters)
      } while (flushAgain || pendingWaiters.length > 0)
    } finally {
      flushing = false
    }
  })()
  flushInFlight = run
  try {
    await run
  } finally {
    if (flushInFlight === run) flushInFlight = null
  }
}

/**
 * Live L2 for one ticker. Coalesces concurrent callers into one batch GET
 * within LIVE_BOOK_COALESCE_MS. On total batch failure, falls back to single
 * /orderbook?ticker= (fail-loud). Flushes are single-flight (U2.12).
 */
export async function fetchLiveOrderbook(
  ticker: string,
  signal?: AbortSignal,
): Promise<OrderBookSnapshot | null> {
  if (signal?.aborted) throw new Error('aborted')
  return new Promise<OrderBookSnapshot | null>((resolve, reject) => {
    const waiter: CoalesceWaiter = { ticker, resolve, reject, signal }
    const onAbort = () => {
      const idx = pendingWaiters.indexOf(waiter)
      if (idx >= 0) pendingWaiters.splice(idx, 1)
      reject(new Error('aborted'))
    }
    waiter.onAbort = onAbort
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
    pendingWaiters.push(waiter)
    if (coalesceTimer == null) {
      coalesceTimer = setTimeout(() => {
        void flushCoalescedOrderbooks()
      }, LIVE_BOOK_COALESCE_MS)
    }
  })
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
  if (signal?.aborted) throw new Error('aborted')
  try {
    const res = await fetch(localApiUrl('/local-api/crypto15m'), {
      signal,
      cache: 'no-store',
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
