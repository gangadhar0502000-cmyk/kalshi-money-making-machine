/**
 * U2.4 / U2.5 — Bind PaperMmPortfolio (multi-book) to the Start/Stop/Reset shell.
 * U3.2.7: Default Start → multi-book + strictRealism: true (STRICT L2; no soft fills).
 * U2.5: map portfolio books → MmBookRow[] for Active books panel.
 * Reuses existing PaperMmPortfolio / engines — U3.2 house mid quotes — no S* playbook / no FV mismatch opens.
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
import {
  attachUiDiskJournal,
  uiDiskJournalFailLoudMessage,
} from '../../lib/crypto15m/mm/uiDiskJournal'

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
  if (/U3\.0:.*quoting paused/i.test(msg)) {
    return makeUpdateError(
      'paper quoting paused — needs new quote logic',
      'user-defined quote logic (quotingEnabled)',
      'U3.0',
    )
  }
  if (/U3\.2:\s*house mid quotes/i.test(msg)) {
    return null // informational strip — not an error
  }
  if (/U3\.2:\s*no mid/i.test(msg)) {
    return makeUpdateError('no mid — needs two-sided book', 'two-sided yes bid/ask', 'U3.2')
  }
  if (/U3\.1\.2:\s*blackout flatten/i.test(msg)) {
    return makeUpdateError(
      'blackout flatten — exit only',
      'inventory flat before blackout',
      'U3.1.2',
    )
  }
  if (/U3\.1:\s*flatten — exit only/i.test(msg)) {
    return makeUpdateError('flatten — exit only', 'minutesRemaining > hardFlatMinutes', 'U3.1')
  }
  if (/U3\.1:\s*settlement blackout/i.test(msg)) {
    return makeUpdateError('settlement blackout', 'minutesRemaining > blackoutMinutes', 'U3.1')
  }
  if (/U3\.1\.1:\s*extreme mid/i.test(msg)) {
    return makeUpdateError('extreme mid — no new opens', 'mid inside toxic band', 'U3.1.1')
  }
  if (/U3\.1:\s*no spot/i.test(msg)) {
    return makeUpdateError('no spot', 'Binance US/Coinbase', 'U3.1')
  }
  if (/U3\.1:\s*no strike/i.test(msg)) {
    return makeUpdateError('no strike', 'floor_strike', 'U3.1')
  }
  if (/U3\.1:\s*no τ|U3\.1:\s*no fair value/i.test(msg)) {
    return makeUpdateError('no fair value', 'spot + strike + closeTime', 'U3.1')
  }
  if (/U2\.14:.*holding inv/i.test(msg)) {
    return makeUpdateError('L2 off — holding inv until flat', 'mm-proxy :8787', 'U2.14')
  }
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
  // U2.14 drop (quiet strip — once per eviction message, not every tick).
  const drop = msg.match(/U2\.14: dropped (.+?) — L2 off/i)
  if (drop) {
    return makeUpdateError(
      `dropped ${drop[1]} — L2 off`,
      'mm-proxy :8787',
      'U2.14',
    )
  }
  if (/U2\.14:.*holding inv/i.test(msg)) {
    return makeUpdateError('L2 off — holding inv until flat', 'mm-proxy :8787', 'U2.14')
  }
  // Per-book holding advisory (inventory stuck without L2).
  if (state.running && state.books.some((b) => /U2\.14:.*holding inv/i.test(b.snapshot.message ?? ''))) {
    return makeUpdateError('L2 off — holding inv until flat', 'mm-proxy :8787', 'U2.14')
  }
  // U3.0: quoting paused strip while Running (after L2 advisories).
  if (
    state.running &&
    (/U3\.0:.*quoting paused/i.test(msg) || state.config?.quotingEnabled === false)
  ) {
    return makeUpdateError(
      'paper quoting paused — needs new quote logic',
      'user-defined quote logic (quotingEnabled)',
      'U3.0',
    )
  }
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
      fairValue: b.snapshot.fairValue ?? null,
      skewCents: b.snapshot.quote?.skewCents ?? null,
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
    const patch = statsFromPortfolio(portfolio.getState(), focusHint)
    // U3.2.2: fail-loud if UI disk journal POSTs keep failing (localStorage alone is not enough).
    const journalMsg = uiDiskJournalFailLoudMessage()
    if (journalMsg && !patch.updateError) {
      patch.updateError = makeUpdateError(
        journalMsg,
        'mm-proxy :8787 POST /local-api/paper-mm/journal',
        'U3.2.2',
      )
    }
    store.patchStats(patch)
  }

  // U3.2.2: browser UI fills → durable JSONL via mm-proxy (no-op in Node).
  attachUiDiskJournal(portfolio)

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
        // U3.2.7: STRICT L2 multi-book — no mid_walk / taker soft fills (U3.2.6 dig $0 covers).
        portfolio.setStrictRealism(true)
        portfolio.setConfig({
          multiBook: true,
          maxActiveMarkets: MM_MAX_ACTIVE_BOOKS,
          ...presetsForMode(true),
          strictRealism: true,
          useLiveBook: true,
          // U2.10: slightly slower L2 polls under multi so coalesce flush + feed share connections
          bookPollMs: 1000,
          // U3.2 house mid — arm quoting on Start (migrates old paused sessions)
          quotingEnabled: true,
          fvQuoting: true,
          blackoutMinutes: 0.75,
          hardFlatMinutes: 2,
          noOpenMinutes: 4,
          quoteClampEpsilon: 0.01,
          tauSkewAccel: 1,
          // U3.2.6: pin 50¢ curb every Start — do not inherit persisted 0.40
          longOpenMinMid: 0.5,
          // U3.2.7 belt: explicit strict fill knobs (also from presetsForMode(true))
          allowMidWalk: false,
          fillMidFallback: false,
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
