/**
 * Shared continuous crypto15m universe feed — proxy-only, ~500ms poll.
 * Paper MM and Lab subscribe so they cannot diverge on universe freshness.
 */
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { normalizeCrypto15m } from '../normalize'
import { recordMid } from '../midHistory'
import { isCrypto15mMarket } from '../detect'
import { fetchLocalCrypto15m, type LocalCrypto15mResponse } from './liveBook'
import {
  CONTINUOUS_FEED_POLL_MS,
  feedFreshnessTone,
  type FeedFreshnessTone,
} from './universeCache'

/** Per-poll AbortSignal timeout — hung /local-api/crypto15m must not freeze inFlight. */
export const CONTINUOUS_FEED_FETCH_TIMEOUT_MS = 4_000

function isAbortReason(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (e instanceof Error) {
    return e.name === 'AbortError' || /aborted/i.test(e.message)
  }
  return false
}

export { CONTINUOUS_FEED_POLL_MS, feedFreshnessTone }
export type { FeedFreshnessTone }

export type ContinuousFeedSnapshot = {
  markets: Crypto15mMarket[]
  /** ISO — updated on every successful HTTP poll (including cache hits). */
  lastSuccessAt?: string
  lastAttemptAt?: string
  lastError?: string
  stale: boolean
  refreshing: boolean
  cacheAgeMs: number | null
  authenticated: boolean
  readOnly: boolean
  /** True once any non-abort poll completed (even empty). */
  everSucceeded: boolean
  fetchedAt?: string
}

type Listener = (snap: ContinuousFeedSnapshot) => void

const emptySnap = (): ContinuousFeedSnapshot => ({
  markets: [],
  stale: false,
  refreshing: false,
  cacheAgeMs: null,
  authenticated: false,
  readOnly: true,
  everSucceeded: false,
})

let snapshot: ContinuousFeedSnapshot = emptySnap()
const listeners = new Set<Listener>()
let pollTimer: ReturnType<typeof setInterval> | null = null
let inFlight = false
let subscriberCount = 0

function emit() {
  for (const l of listeners) {
    try {
      l(snapshot)
    } catch {
      /* listener errors must not kill the feed */
    }
  }
}

function normalizeProxyMarkets(raw: LocalCrypto15mResponse): Crypto15mMarket[] {
  const out: Crypto15mMarket[] = []
  for (const m of raw.markets) {
    if (!isCrypto15mMarket(m)) continue
    const n = normalizeCrypto15m(m)
    recordMid(n.ticker, n.midYes)
    out.push(n)
  }
  out.sort((a, b) => a.minutesRemaining - b.minutesRemaining)
  return out
}

function timeoutErrorMessage(): string {
  return `feed poll timeout (${CONTINUOUS_FEED_FETCH_TIMEOUT_MS / 1000}s) — needs mm-proxy :8787`
}

async function pollOnce(): Promise<void> {
  if (inFlight) return
  inFlight = true
  const attemptedAt = new Date().toISOString()
  snapshot = { ...snapshot, lastAttemptAt: attemptedAt }
  emit()

  const ac = new AbortController()
  const timeoutId = setTimeout(() => {
    ac.abort()
  }, CONTINUOUS_FEED_FETCH_TIMEOUT_MS)

  try {
    const raw = await fetchLocalCrypto15m(ac.signal)
    if (ac.signal.aborted) {
      // Timed out; do not advance lastSuccessAt.
      snapshot = {
        ...snapshot,
        lastAttemptAt: attemptedAt,
        lastError: timeoutErrorMessage(),
      }
      emit()
      return
    }
    const markets = normalizeProxyMarkets(raw)
    const nowIso = new Date().toISOString()
    const errParts = [...(raw.errors ?? [])]
    const keepLast =
      markets.length === 0 &&
      snapshot.markets.length > 0 &&
      (Boolean(raw.stale) || (errParts.length > 0 && Boolean(raw.refreshing)))

    snapshot = {
      markets: keepLast ? snapshot.markets : markets,
      lastSuccessAt: nowIso,
      lastAttemptAt: attemptedAt,
      lastError: errParts.length
        ? errParts.slice(0, 3).join(' | ')
        : keepLast
          ? 'Empty/stale proxy — keeping last markets'
          : undefined,
      stale: Boolean(raw.stale) || keepLast,
      refreshing: Boolean(raw.refreshing),
      cacheAgeMs: raw.cacheAgeMs ?? null,
      authenticated: Boolean(raw.authenticated),
      readOnly: raw.readOnly !== false,
      everSucceeded: true,
      fetchedAt: raw.fetchedAt,
    }
    emit()
  } catch (e) {
    if (isAbortReason(e, ac.signal)) {
      snapshot = {
        ...snapshot,
        lastAttemptAt: attemptedAt,
        lastError: timeoutErrorMessage(),
      }
      emit()
      return
    }
    snapshot = {
      ...snapshot,
      lastAttemptAt: attemptedAt,
      lastError: e instanceof Error ? e.message : String(e),
    }
    emit()
  } finally {
    clearTimeout(timeoutId)
    inFlight = false
  }
}

function ensurePolling() {
  if (pollTimer != null) return
  void pollOnce()
  pollTimer = setInterval(() => {
    void pollOnce()
  }, CONTINUOUS_FEED_POLL_MS)
}

function maybeStopPolling() {
  if (subscriberCount > 0) return
  if (pollTimer != null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** Current snapshot (sync). */
export function getContinuousFeedSnapshot(): ContinuousFeedSnapshot {
  return snapshot
}

/**
 * Subscribe to continuous proxy feed. Starts the 500ms poller on first subscriber;
 * stops when the last unsubscribes.
 */
export function subscribeContinuousFeed(listener: Listener): () => void {
  listeners.add(listener)
  subscriberCount++
  listener(snapshot)
  ensurePolling()
  return () => {
    listeners.delete(listener)
    subscriberCount = Math.max(0, subscriberCount - 1)
    maybeStopPolling()
  }
}

/** Test helper — reset singleton state. */
export function __resetContinuousFeedForTests(): void {
  if (pollTimer != null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  inFlight = false
  subscriberCount = 0
  listeners.clear()
  snapshot = emptySnap()
}

/** Test helper — whether a poll is currently in flight. */
export function __continuousFeedInFlightForTests(): boolean {
  return inFlight
}
