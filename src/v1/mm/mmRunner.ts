/**
 * U2.4 / U2.5 — Bind PaperMmPortfolio (loose multi-book) to the Start/Stop/Reset shell.
 * Default Start → multi-book + strictRealism: false (LOOSE presets).
 * U2.5: map portfolio books → MmBookRow[] for Active books panel.
 * Reuses existing PaperMmPortfolio / engines as-is — no new S* rules.
 * U2.2/U2.3 helpers remain for residual single-engine / error mapping.
 * Paper-only · never places live orders.
 */

import {
  getContinuousFeedSnapshot,
  type ContinuousFeedSnapshot,
} from '../../lib/crypto15m/mm/continuousFeed'
import { presetsForMode } from '../../lib/crypto15m/mm/config'
import {
  paperMmPortfolio,
  type PaperMmPortfolio,
  type PortfolioState,
} from '../../lib/crypto15m/mm/portfolio'
import type { MmSnapshot } from '../../lib/crypto15m/mm/types'
import {
  makeUpdateError,
  MM_MAX_ACTIVE_BOOKS,
  type MmBookRow,
  type MmSessionStore,
  type MmUpdateError,
  mmSessionStore,
} from './mmSession'

/** Minimal portfolio surface so tests can inject a stub. */
export type MmPortfolioHandle = Pick<
  PaperMmPortfolio,
  | 'setConfig'
  | 'setStrictRealism'
  | 'syncMarketUniverse'
  | 'start'
  | 'stop'
  | 'resetSession'
  | 'getState'
  | 'subscribe'
>

export type MmRunnerDeps = {
  store?: MmSessionStore
  portfolio?: MmPortfolioHandle
  /** Latest continuous-feed snapshot (defaults to shared getContinuousFeedSnapshot). */
  getFeed?: () => ContinuousFeedSnapshot
  /** How often to re-sync full market universe while running (ms). */
  tickMs?: number
}

export type MmRunner = {
  /** Optional ticker is a focus hint only — Start does not require it in multi. */
  start: (ticker?: string | null) => void
  stop: () => void
  reset: () => void
  /** Tear down timers / portfolio subscription (tests / unmount). */
  dispose: () => void
}

const FEED_TICK_MS = 1000

/**
 * Map engine snapshot messages / liveBook flag → fail-loud U2.2 (residual).
 * Does not throw — app must keep running.
 */
export function deriveUpdateError(snap: MmSnapshot): MmUpdateError | null {
  const msg = snap.message ?? ''
  if (/L2 book poll failed|orderbook|L2 off/i.test(msg) && !snap.liveBook) {
    return makeUpdateError('L2 off — no soft fills', 'mm-proxy :8787', 'U2.13')
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

/**
 * Map portfolio-level messages → fail-loud U2.4 when useful (not every tick).
 */
export function derivePortfolioUpdateError(
  state: PortfolioState,
): MmUpdateError | null {
  const msg = state.message ?? ''
  if (/under-filled/i.test(msg)) {
    return makeUpdateError(
      `multi-book under-filled (${state.aggregate.activeBooks}/${state.config.maxActiveMarkets})`,
      'open ranked crypto 15m markets',
      'U2.4',
    )
  }
  if (/Feed empty\/stale/i.test(msg) && state.aggregate.activeBooks === 0) {
    return makeUpdateError(
      'no markets in feed',
      'continuous feed / mm-proxy :8787',
      'U2.4',
    )
  }
  // Surface book-level orderbook / L2-off failure.
  if (state.running && state.books.length > 0) {
    const anyLive = state.books.some((b) => b.snapshot.liveBook)
    const anyObFail = state.books.some((b) =>
      /L2 book poll failed|orderbook|L2 off/i.test(b.snapshot.message ?? ''),
    )
    if (!anyLive && anyObFail) {
      return makeUpdateError('L2 off — no soft fills', 'mm-proxy :8787', 'U2.13')
    }
  }
  return null
}

function lastFillAtFromPortfolio(state: PortfolioState): number | null {
  const session = state.sessionFills
  if (session.length) {
    const t = session[0]?.t
    if (typeof t === 'number' && t > 0) return t
  }
  let best: number | null = null
  for (const b of state.books) {
    const t = b.fills[0]?.t
    if (typeof t === 'number' && t > 0 && (best == null || t > best)) {
      best = t
    }
  }
  return best
}

function booksFromPortfolio(state: PortfolioState): MmBookRow[] {
  const rows: MmBookRow[] = []
  for (const b of state.books) {
    const ticker = b.snapshot.marketTicker
    if (!ticker) continue
    const side = b.snapshot.quoteBookSide === 'no' ? 'NO' : 'YES'
    rows.push({
      slotId: b.slotId,
      ticker,
      asset: b.snapshot.asset ?? '',
      inventory: b.snapshot.inventory ?? 0,
      realizedPnl: b.snapshot.realizedSpreadPnl ?? 0,
      unrealizedPnl: b.snapshot.unrealizedInventoryPnl ?? 0,
      fillsCount: b.snapshot.fillCount ?? 0,
      liveBook: Boolean(b.snapshot.liveBook),
      midYes: b.snapshot.midYes ?? 0,
      message: b.snapshot.message ?? '',
      quoteBook: side,
    })
  }
  return rows
}

function statsFromPortfolio(
  state: PortfolioState,
  focusHint: string | null,
): {
  cash: number
  inventory: number
  realizedPnl: number
  unrealizedPnl: number
  fees: number
  fillsCount: number
  lastFillAt: number | null
  activeTicker: string | null
  activeBooks: number
  books: MmBookRow[]
  quoteBook: null
  updateError: MmUpdateError | null
} {
  const agg = state.aggregate
  const books = booksFromPortfolio(state)
  const firstTicker =
    books[0]?.ticker ??
    (focusHint && books.some((b) => b.ticker === focusHint) ? focusHint : null) ??
    focusHint
  return {
    cash: agg.cash,
    inventory: agg.inventoryNet,
    realizedPnl: agg.realizedSpreadPnl,
    unrealizedPnl: agg.unrealizedInventoryPnl,
    fees: agg.feesPaid,
    fillsCount: agg.fillCount,
    lastFillAt: lastFillAtFromPortfolio(state),
    activeTicker: firstTicker,
    activeBooks: agg.activeBooks,
    books,
    quoteBook: null,
    updateError: derivePortfolioUpdateError(state),
  }
}

/**
 * Create a runner that owns portfolio start/stop/reset + feed re-sync → session stats.
 */
export function createMmRunner(deps: MmRunnerDeps = {}): MmRunner {
  const store = deps.store ?? mmSessionStore
  const portfolio = deps.portfolio ?? paperMmPortfolio
  const getFeed = deps.getFeed ?? getContinuousFeedSnapshot
  const tickMs = deps.tickMs ?? FEED_TICK_MS

  let feedTimer: ReturnType<typeof setInterval> | null = null
  let unsubPortfolio: (() => void) | null = null
  let disposed = false
  /** Optional focus hint from Start(ticker); not required for multi. */
  let focusHint: string | null = null

  const clearFeedTimer = () => {
    if (feedTimer != null) {
      clearInterval(feedTimer)
      feedTimer = null
    }
  }

  const syncStatsFromPortfolio = () => {
    if (disposed) return
    const status = store.getState().status
    if (status === 'idle') return
    store.patchStats(statsFromPortfolio(portfolio.getState(), focusHint))
  }

  const ensurePortfolioSub = () => {
    if (unsubPortfolio) return
    unsubPortfolio = portfolio.subscribe(() => {
      syncStatsFromPortfolio()
    })
  }

  const pushUniverseSync = () => {
    const feed = getFeed()
    const markets = feed.markets
    if (markets.length === 0) {
      store.patchStats({
        updateError: makeUpdateError(
          'no markets in feed',
          'continuous feed / mm-proxy :8787',
          'U2.4',
        ),
      })
      // Still call sync so portfolio can hold/settle existing books.
      try {
        portfolio.syncMarketUniverse([])
      } catch {
        /* ignore */
      }
      return
    }
    try {
      portfolio.syncMarketUniverse(markets)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      store.patchStats({
        updateError: makeUpdateError(
          `universe sync failed: ${reason}`,
          'PaperMmPortfolio.syncMarketUniverse',
          'U2.4',
        ),
      })
    }
  }

  const armFeedTimer = () => {
    clearFeedTimer()
    feedTimer = setInterval(() => {
      if (store.getState().status !== 'running') return
      pushUniverseSync()
    }, tickMs)
  }

  return {
    start(ticker) {
      if (disposed) return
      if (store.getState().status === 'running') return

      const feed = getFeed()
      const markets = feed.markets
      if (markets.length === 0) {
        store.patchStats({
          updateError: makeUpdateError(
            'no markets in feed',
            'continuous feed / mm-proxy :8787',
            'U2.4',
          ),
          activeTicker: ticker ?? null,
          activeBooks: 0,
          books: [],
          quoteBook: null,
        })
        // Fail-loud stay idle — no portfolio start without a universe.
        return
      }

      focusHint = ticker ?? null
      ensurePortfolioSub()

      try {
        // Loose multi-book (not strict/tight). Match PaperMmPanel: setStrict then setConfig.
        portfolio.setStrictRealism(false)
        portfolio.setConfig({
          multiBook: true,
          maxActiveMarkets: MM_MAX_ACTIVE_BOOKS,
          ...presetsForMode(false),
          strictRealism: false,
          useLiveBook: true,
          // U2.10: slightly slower L2 polls under multi so coalesce flush + feed share connections
          bookPollMs: 1000,
        })
        portfolio.syncMarketUniverse(markets)
        portfolio.start()
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        store.patchStats({
          updateError: makeUpdateError(
            `portfolio start failed: ${reason}`,
            'PaperMmPortfolio',
            'U2.4',
          ),
          quoteBook: null,
        })
        return
      }

      store.start()
      store.patchStats({
        ...statsFromPortfolio(portfolio.getState(), focusHint),
      })
      armFeedTimer()
      // Immediate re-sync so books get mid updates
      pushUniverseSync()
    },

    stop() {
      if (disposed) return
      clearFeedTimer()
      try {
        portfolio.stop()
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        store.patchStats({
          updateError: makeUpdateError(
            `portfolio stop failed: ${reason}`,
            'PaperMmPortfolio',
            'U2.4',
          ),
        })
      }
      // Freeze aggregate numbers, then mark stopped.
      syncStatsFromPortfolio()
      store.stop()
    },

    reset() {
      if (disposed) return
      clearFeedTimer()
      focusHint = null
      try {
        portfolio.resetSession()
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        store.reset()
        store.patchStats({
          updateError: makeUpdateError(
            `portfolio reset failed: ${reason}`,
            'PaperMmPortfolio',
            'U2.4',
          ),
        })
        return
      }
      store.reset()
    },

    dispose() {
      disposed = true
      clearFeedTimer()
      if (unsubPortfolio) {
        unsubPortfolio()
        unsubPortfolio = null
      }
    },
  }
}

/** Shared V1 runner bound to mmSessionStore + paperMmPortfolio. */
export const mmRunner = createMmRunner()
