/**
 * U2.2 — Bind PaperMmEngine lifecycle to the U2.1 Start/Stop/Reset session shell.
 * Single active market (focused ticker). Paper-only · never places live orders.
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
    store.patchStats(statsFromEngine(engine.getState()))
  }

  const ensureEngineSub = () => {
    if (unsubEngine) return
    unsubEngine = engine.subscribe(() => {
      syncStatsFromEngine()
    })
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
      engine.onMarketTick(market)
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
        // Single-book strict realism for U2.2 (multi-book deferred).
        engine.setConfig({
          multiBook: false,
          strictRealism: true,
          useLiveBook: true,
        })
        engine.setMarket(market)
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
        // Keep deriveUpdateError from engine (may already flag proxy).
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
      // Freeze numbers at last engine snapshot, then mark stopped.
      syncStatsFromEngine()
      store.stop()
    },

    reset() {
      if (disposed) return
      clearFeedTimer()
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
