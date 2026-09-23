/**
 * Shared continuous crypto15m universe feed — proxy-only, ~500ms poll.
 * Paper MM and Lab subscribe so they cannot diverge on universe freshness.
 *
 * U2.11: abort-previous (not skip-if-inFlight) so a hung browser fetch cannot
 * freeze lastSuccessAt while the UI clock ages to 8–10s+.
 *
 * U2.12: lastSuccessAt = proxy `fetchedAt` (Kalshi universe data time), never
 * wall-clock HTTP RTT / cache-hit time. Browser polls :8787 directly.
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

/** Per-poll AbortSignal timeout — direct :8787; hung fetch must not freeze age. */
export const CONTINUOUS_FEED_FETCH_TIMEOUT_MS = 5_000

function isAbortReason(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (e instanceof Error) {
    return e.name === 'AbortError' || /aborted/i.test(e.message)
  }
  return false
}

function isValidFetchedAt(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  const t = Date.parse(value)
  return Number.isFinite(t)
}

export { CONTINUOUS_FEED_POLL_MS, feedFreshnessTone }
export type { FeedFreshnessTone }

export type ContinuousFeedSnapshot = {
  markets: Crypto15mMarket[]
  /**
   * ISO — proxy universe data time (`fetchedAt`), not HTTP success time.
   * Stale cache hits do not advance this beyond the proxy's fetchedAt.
   */
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
/** Chained setTimeout handle (not setInterval). */
let pollTimer: ReturnType<typeof setTimeout> | null = null
/** True while the current generation's fetch is outstanding. */
let inFlight = false
let subscriberCount = 0
/** Active fetch controller — aborted when a newer poll supersedes it. */
let activeAbort: AbortController | null = null
/** Monotonic generation; late responses from older gens must not mutate snapshot. */
let pollGeneration = 0
/** True once the chained poll loop has been started for current subscribers. */
let loopStarted = false

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

function clearPollTimer() {
  if (pollTimer != null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

/**
 * One poll tick. Always starts — aborts any previous in-flight fetch
 * (reason superseded) so inFlight cannot stick across generations.
 */
async function pollOnce(): Promise<void> {
  if (activeAbort) {
    try {
      activeAbort.abort('superseded')
    } catch {
      /* ignore */
    }
  }

  const gen = ++pollGeneration
  const ac = new AbortController()
  activeAbort = ac
  inFlight = true

  const attemptedAt = new Date().toISOString()
  snapshot = { ...snapshot, lastAttemptAt: attemptedAt }
  emit()

  const timeoutId = setTimeout(() => {
    try {
      ac.abort('timeout')
    } catch {
      /* ignore */
    }
  }, CONTINUOUS_FEED_FETCH_TIMEOUT_MS)

  try {
    const raw = await fetchLocalCrypto15m(ac.signal)
    if (gen !== pollGeneration) return

    if (ac.signal.aborted) {
      snapshot = {
        ...snapshot,
        lastAttemptAt: attemptedAt,
        lastError: timeoutErrorMessage(),
      }
      emit()
      return
    }

    const markets = normalizeProxyMarkets(raw)
    const errParts = [...(raw.errors ?? [])]
    const keepLast =
      markets.length === 0 &&
      snapshot.markets.length > 0 &&
      (Boolean(raw.stale) || (errParts.length > 0 && Boolean(raw.refreshing)))

    const fetchedOk = isValidFetchedAt(raw.fetchedAt)
    // Honest age: stamp from proxy data time only — never Date.now() / HTTP RTT.
    const lastSuccessAt = fetchedOk ? raw.fetchedAt : snapshot.lastSuccessAt
    let lastError: string | undefined
    if (!fetchedOk) {
      lastError = 'proxy missing fetchedAt — not claiming fresh'
    } else if (errParts.length) {
      lastError = errParts.slice(0, 3).join(' | ')
    } else if (keepLast) {
      lastError = 'Empty/stale proxy — keeping last markets'
    } else {
      lastError = undefined
    }

    snapshot = {
      markets: keepLast ? snapshot.markets : markets,
      lastSuccessAt,
      lastAttemptAt: attemptedAt,
      lastError,
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
    if (gen !== pollGeneration) return
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
    if (gen === pollGeneration) {
      inFlight = false
      if (activeAbort === ac) activeAbort = null
    }
  }
}

function scheduleNextPoll() {
  clearPollTimer()
  if (subscriberCount <= 0) {
    loopStarted = false
    return
  }
  pollTimer = setTimeout(() => {
    pollTimer = null
    void pollOnce().finally(() => {
      scheduleNextPoll()
    })
  }, CONTINUOUS_FEED_POLL_MS)
}

function ensurePolling() {
  if (loopStarted) return
  loopStarted = true
  void pollOnce().finally(() => {
    scheduleNextPoll()
  })
}

function maybeStopPolling() {
  if (subscriberCount > 0) return
  clearPollTimer()
  loopStarted = false
  if (activeAbort) {
    try {
      activeAbort.abort('stopped')
    } catch {
      /* ignore */
    }
    activeAbort = null
  }
  inFlight = false
}

/** Current snapshot (sync). */
export function getContinuousFeedSnapshot(): ContinuousFeedSnapshot {
  return snapshot
}

/**
 * Immediate poll (abort-previous). Used when the tab becomes visible/focused
 * so a hung background fetch cannot leave age frozen.
 */
export function kickContinuousFeedPoll(): void {
  if (subscriberCount <= 0) return
  void pollOnce()
}

/**
 * Subscribe to continuous proxy feed. Starts the ~500ms chained poller on
 * first subscriber; stops when the last unsubscribes.
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
  clearPollTimer()
  loopStarted = false
  if (activeAbort) {
    try {
      activeAbort.abort('reset')
    } catch {
      /* ignore */
    }
    activeAbort = null
  }
  inFlight = false
  pollGeneration++
  subscriberCount = 0
  listeners.clear()
  snapshot = emptySnap()
}

/** Test helper — whether the current generation's poll is in flight. */
export function __continuousFeedInFlightForTests(): boolean {
  return inFlight
}

/** Test helper — current poll generation id. */
export function __continuousFeedGenerationForTests(): number {
  return pollGeneration
}
