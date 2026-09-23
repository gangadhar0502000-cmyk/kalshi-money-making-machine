/**
 * U2.2 / U2.3 — Bind PaperMmEngine lifecycle to the Start/Stop/Reset session shell.
 * U2.3 routes the single focused ticker to the better YES or NO book via
 * betterBookHint + marketForQuoteBook (sticky while inventory open).
 * L2 remains YES-combined this slice (NO-primary L2 deferred).
 * Paper-only · never places live orders.
 */

import type { Crypto15mMarket } from '../../types/crypto15m'
import {
  getContinuousFeedSnapshot,
  type ContinuousFeedSnapshot,
} from '../../lib/crypto15m/mm/continuousFeed'
import { paperMmEngine, type PaperMmEngine } from '../../lib/crypto15m/mm/engine'
import type { MmEngineState, MmSnapshot } from '../../lib/crypto15m/mm/types'
import {
  makeUpdateError,
  type MmSessionStore,
  type MmUpdateError,
  mmSessionStore,
} from './mmSession'
import {
  marketForQuoteBook,
  resolveQuoteBook,
  type QuoteBook,
} from './quoteBook'

/** Minimal engine surface so tests can inject a stub. */
export type MmEngineHandle = Pick<
  PaperMmEngine,
  | 'setConfig'
  | 'setMarket'
  | 'start'
  | 'stop'
  | 'resetSession'
  | 'onMarketTick'
  | 'subscribe'
  | 'getState'
>

export type MmRunnerDeps = {
  store?: MmSessionStore
  engine?: MmEngineHandle
  /** Latest continuous-feed snapshot (defaults to shared getContinuousFeedSnapshot). */
  getFeed?: () => ContinuousFeedSnapshot
  /** How often to push feed mid → engine while running (ms). */
  tickMs?: number
}

export type MmRunner = {
  start: (ticker: string | null | undefined) => void
  stop: () => void
  reset: () => void
  /** Tear down timers / engine subscription (tests / unmount). */
  dispose: () => void
}

const FEED_TICK_MS = 1000

/**
 * Map engine messages / liveBook flag → fail-loud U2.2 error (or null if healthy).
 * Does not throw — app must keep running.
 */
export function deriveUpdateError(snap: MmSnapshot): MmUpdateError | null {
  const msg = snap.message ?? ''
  if (/L2 book poll failed|orderbook/i.test(msg) && !snap.liveBook) {
    return makeUpdateError('orderbook failed', 'mm-proxy :8787')
  }
  if (/Spot poll failed/i.test(msg)) {
    return makeUpdateError('spot failed', 'public spot feed')
  }
  if (/unsupported spot asset/i.test(msg)) {
    return makeUpdateError(
      `spot unavailable for ${snap.asset ?? 'asset'}`,
      'supported spot asset',
    )
  }
  if (/Select a crypto 15m market/i.test(msg)) {
    return makeUpdateError('no market selected', 'focused ticker from feed')
  }
  return null
}

function lastFillAtFromEngine(state: MmEngineState): number | null {
  const fills = state.fills
  if (!fills.length) return null
  // getState returns newest-first
  const t = fills[0]?.t
  return typeof t === 'number' && t > 0 ? t : null
}

function statsFromEngine(state: MmEngineState): {
  cash: number
  inventory: number
  realizedPnl: number
  unrealizedPnl: number
  fees: number
  fillsCount: number
  lastFillAt: number | null
  activeTicker: string | null
  updateError: MmUpdateError | null
} {
  const s = state.snapshot
  return {
    cash: s.cash,
    inventory: s.inventory,
    realizedPnl: s.realizedSpreadPnl,
    unrealizedPnl: s.unrealizedInventoryPnl,
    fees: s.feesPaid,
    fillsCount: s.fillCount,
    lastFillAt: lastFillAtFromEngine(state),
    activeTicker: s.marketTicker,
    updateError: deriveUpdateError(s),
  }
}

/**
 * Create a runner that owns engine start/stop/reset + feed ticks → session stats.
 */
export function createMmRunner(deps: MmRunnerDeps = {}): MmRunner {
  const store = deps.store ?? mmSessionStore
  const engine = deps.engine ?? paperMmEngine
  const getFeed = deps.getFeed ?? getContinuousFeedSnapshot
  const tickMs = deps.tickMs ?? FEED_TICK_MS

  let feedTimer: ReturnType<typeof setInterval> | null = null
  let unsubEngine: (() => void) | null = null
  let disposed = false
  /** Sticky quote book while inventory is open; cleared on reset. */
  let stickyBook: QuoteBook | null = null
  /** Last U2.3 routing error; engine errors win when present. */
  let lastRoutingError: MmUpdateError | null = null

  const clearFeedTimer = () => {
    if (feedTimer != null) {
      clearInterval(feedTimer)
      feedTimer = null
    }
  }

  const syncStatsFromEngine = () => {
    if (disposed) return
    // Only push stats while session is running or stopped (freeze after stop).
    // After reset the store already zeroed; ignore engine until next start.
    const status = store.getState().status
    if (status === 'idle') return
    const fromEngine = statsFromEngine(engine.getState())
    // Engine errors win; else keep fresher U2.3 routing error.
    const updateError = fromEngine.updateError ?? lastRoutingError
    store.patchStats({
      ...fromEngine,
      updateError,
      quoteBook: stickyBook,
    })
  }

  const ensureEngineSub = () => {
    if (unsubEngine) return
    unsubEngine = engine.subscribe(() => {
      syncStatsFromEngine()
    })
  }

  /** Resolve YES/NO book, patch quoteBook (+ U2.3 error), return engine market. */
  const routeMarket = (market: Crypto15mMarket): Crypto15mMarket => {
    const result = resolveQuoteBook(
      market,
      stickyBook,
      store.getState().inventory,
    )
    stickyBook = result.book
    lastRoutingError = result.error
      ? makeUpdateError(
          result.error.message,
          result.error.dependency,
          'U2.3',
        )
      : null
    const engineErr = deriveUpdateError(engine.getState().snapshot)
    const cur = store.getState().updateError
    // Engine errors win; else U2.3 routing; clear stale U2.3 when routing ok.
    let updateError: MmUpdateError | null | undefined
    if (engineErr) updateError = engineErr
    else if (lastRoutingError) updateError = lastRoutingError
    else if (cur?.code === 'U2.3') updateError = null
    else updateError = undefined
    store.patchStats({
      quoteBook: result.book,
      ...(updateError !== undefined ? { updateError } : {}),
    })
    return marketForQuoteBook(market, result.book)
  }

  const pushFeedTick = (ticker: string | null) => {
    if (!ticker) return
    const feed = getFeed()
    const market = feed.markets.find((m) => m.ticker === ticker) ?? null
    if (!market) {
      store.patchStats({
        updateError: makeUpdateError(
          'market missing from feed',
          'continuous feed snapshot',
        ),
      })
      return
    }
    try {
      const routed = routeMarket(market)
      engine.onMarketTick(routed)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      store.patchStats({
        updateError: makeUpdateError(
          `market tick failed: ${reason}`,
          'PaperMmEngine.onMarketTick',
        ),
      })
    }
  }

  const armFeedTimer = (ticker: string) => {
    clearFeedTimer()
    feedTimer = setInterval(() => {
      if (store.getState().status !== 'running') return
      pushFeedTick(ticker)
    }, tickMs)
  }

  const resolveMarket = (
    ticker: string | null | undefined,
  ): Crypto15mMarket | null => {
    if (!ticker) return null
    const feed = getFeed()
    return feed.markets.find((m) => m.ticker === ticker) ?? null
  }

  return {
    start(ticker) {
      if (disposed) return
      if (store.getState().status === 'running') return

      const market = resolveMarket(ticker)
      if (!market) {
        store.patchStats({
          updateError: makeUpdateError(
            'no market selected',
            'focused ticker from feed',
          ),
          activeTicker: ticker ?? null,
        })
        // Still flip to running? Spec: Start → engine runs. Without market, fail-loud stay idle.
        return
      }

      ensureEngineSub()
      try {
        // Single-book strict realism (multi-book deferred).
        engine.setConfig({
          multiBook: false,
          strictRealism: true,
          useLiveBook: true,
        })
        const routed = routeMarket(market)
        engine.setMarket(routed)
        engine.start()
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        store.patchStats({
          updateError: makeUpdateError(
            `engine start failed: ${reason}`,
            'PaperMmEngine',
          ),
        })
        return
      }

      store.start()
      store.patchStats({
        ...statsFromEngine(engine.getState()),
        activeTicker: market.ticker,
        quoteBook: stickyBook,
        updateError:
          statsFromEngine(engine.getState()).updateError ?? lastRoutingError,
      })
      armFeedTimer(market.ticker)
      // Immediate feed+tick
      pushFeedTick(market.ticker)
    },

    stop() {
      if (disposed) return
      clearFeedTimer()
      try {
        engine.stop()
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        store.patchStats({
          updateError: makeUpdateError(
            `engine stop failed: ${reason}`,
            'PaperMmEngine',
          ),
        })
      }
      // Freeze numbers + last quoteBook at last engine snapshot, then mark stopped.
      syncStatsFromEngine()
      store.stop()
    },

    reset() {
      if (disposed) return
      clearFeedTimer()
      stickyBook = null
      lastRoutingError = null
      try {
        engine.resetSession()
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        // Still clear session UI; surface the failure.
        store.reset()
        store.patchStats({
          updateError: makeUpdateError(
            `engine reset failed: ${reason}`,
            'PaperMmEngine',
          ),
        })
        return
      }
      store.reset()
    },

    dispose() {
      disposed = true
      clearFeedTimer()
      if (unsubEngine) {
        unsubEngine()
        unsubEngine = null
      }
    },
  }
}

/** Shared V1 runner bound to mmSessionStore + paperMmEngine. */
export const mmRunner = createMmRunner()
