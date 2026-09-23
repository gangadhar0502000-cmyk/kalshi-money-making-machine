/**
 * U2.1–U2.6 / U2.13 / U2.14 — Paper MM session store.
 * Start / Stop / Reset shell + paper P&L stats (portfolio attached via mmRunner).
 * U2.4: multi-book loose portfolio; activeBooks in strip.
 * U2.5: per-book rows for Active books panel (`books: MmBookRow[]`).
 * U2.6: strip metric formatters (`formatSignedDollars`).
 * Paper-only · read-only Kalshi · never places live orders.
 */

import type { QuoteBook } from './quoteBook'

export type MmSessionStatus = 'idle' | 'running' | 'stopped'

/** Fail-loud update error surfaced in the Apple-clean strip. */
export type MmUpdateError = {
  code: 'U2.2' | 'U2.3' | 'U2.4' | 'U2.13' | 'U2.14'
  message: string
  dependency: string
}

/** U2.5 — minimal per-book row for the Active books panel. */
export type MmBookRow = {
  slotId: string
  ticker: string
  asset: string
  inventory: number
  realizedPnl: number
  unrealizedPnl: number
  fillsCount: number
  liveBook: boolean
  midYes: number
  message: string
  /** U2.13: primary L2 book for queue fills. */
  quoteBook: QuoteBook
}

export type MmSessionState = {
  status: MmSessionStatus
  startedAt: number | null
  stoppedAt: number | null
  resetCount: number
  /** Paper cash ($) — mirrors portfolio / engine startingCash / cash. */
  cash: number
  /** Aggregate net YES inventory (contracts). */
  inventory: number
  /** Realized spread P&L after fees ($). */
  realizedPnl: number
  /** Mark-to-mid unrealized inventory P&L ($). */
  unrealizedPnl: number
  /** Cumulative fees paid this session ($). */
  fees: number
  /** Fill count this session. */
  fillsCount: number
  /** Epoch ms of last fill, or null. */
  lastFillAt: number | null
  /** Primary / focus hint ticker (first active book in multi). */
  activeTicker: string | null
  /** Active quote book (YES|NO); null in multi-book mode / idle. */
  quoteBook: QuoteBook | null
  /** How many portfolio books are currently active (0 when idle/reset). */
  activeBooks: number
  /** U2.5: up-to-5 active portfolio book rows (empty when idle/reset). */
  books: MmBookRow[]
  /** Fail-loud U2.2/U2.3/U2.4 error; null when healthy. */
  updateError: MmUpdateError | null
}

export type MmSessionStatsPatch = Partial<
  Pick<
    MmSessionState,
    | 'cash'
    | 'inventory'
    | 'realizedPnl'
    | 'unrealizedPnl'
    | 'fees'
    | 'fillsCount'
    | 'lastFillAt'
    | 'activeTicker'
    | 'quoteBook'
    | 'activeBooks'
    | 'books'
    | 'updateError'
  >
>

export type MmSessionStore = {
  getState: () => MmSessionState
  subscribe: (listener: () => void) => () => void
  start: () => void
  stop: () => void
  reset: () => void
  /** Merge paper stats / error from the runner without changing status. */
  patchStats: (patch: MmSessionStatsPatch) => void
}

/** Default paper starting cash — matches STRICT/LOOSE startingCash. */
export const MM_SESSION_STARTING_CASH = 100

/** U2.4: portfolio max active books (matches PaperMmConfig.maxActiveMarkets). */
export const MM_MAX_ACTIVE_BOOKS = 5

const ZERO_STATS = {
  cash: MM_SESSION_STARTING_CASH,
  inventory: 0,
  realizedPnl: 0,
  unrealizedPnl: 0,
  fees: 0,
  fillsCount: 0,
  lastFillAt: null as number | null,
  activeTicker: null as string | null,
  quoteBook: null as QuoteBook | null,
  activeBooks: 0,
  books: [] as MmBookRow[],
  updateError: null as MmUpdateError | null,
}

const INITIAL: MmSessionState = {
  status: 'idle',
  startedAt: null,
  stoppedAt: null,
  resetCount: 0,
  ...ZERO_STATS,
}

function sameState(a: MmSessionState, b: MmSessionState): boolean {
  return (
    a.status === b.status &&
    a.startedAt === b.startedAt &&
    a.stoppedAt === b.stoppedAt &&
    a.resetCount === b.resetCount &&
    a.cash === b.cash &&
    a.inventory === b.inventory &&
    a.realizedPnl === b.realizedPnl &&
    a.unrealizedPnl === b.unrealizedPnl &&
    a.fees === b.fees &&
    a.fillsCount === b.fillsCount &&
    a.lastFillAt === b.lastFillAt &&
    a.activeTicker === b.activeTicker &&
    a.quoteBook === b.quoteBook &&
    a.activeBooks === b.activeBooks &&
    sameBooks(a.books, b.books) &&
    sameError(a.updateError, b.updateError)
  )
}

function sameBooks(a: MmBookRow[], b: MmBookRow[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (
      x.slotId !== y.slotId ||
      x.ticker !== y.ticker ||
      x.asset !== y.asset ||
      x.inventory !== y.inventory ||
      x.realizedPnl !== y.realizedPnl ||
      x.unrealizedPnl !== y.unrealizedPnl ||
      x.fillsCount !== y.fillsCount ||
      x.liveBook !== y.liveBook ||
      x.midYes !== y.midYes ||
      x.message !== y.message ||
      x.quoteBook !== y.quoteBook
    ) {
      return false
    }
  }
  return true
}

function sameError(
  a: MmUpdateError | null,
  b: MmUpdateError | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.code === b.code && a.message === b.message && a.dependency === b.dependency
  )
}

/** Pure transition helpers (unit-testable without a store). */
export function transitionStart(
  state: MmSessionState,
  nowMs: number = Date.now(),
): MmSessionState {
  if (state.status === 'running') return state
  return {
    ...state,
    status: 'running',
    startedAt: nowMs,
    stoppedAt: null,
    // Clear prior update error on a fresh start; runner may re-set.
    updateError: null,
  }
}

export function transitionStop(
  state: MmSessionState,
  nowMs: number = Date.now(),
): MmSessionState {
  if (state.status !== 'running') return state
  return {
    ...state,
    status: 'stopped',
    stoppedAt: nowMs,
  }
}

/**
 * Reset clears session counters / P&L / errors / quoteBook / activeBooks / books → idle.
 * Does not wipe the market feed (feed lives outside this store).
 */
export function transitionReset(state: MmSessionState): MmSessionState {
  return {
    status: 'idle',
    startedAt: null,
    stoppedAt: null,
    resetCount: state.resetCount + 1,
    ...ZERO_STATS,
  }
}

export function createMmSessionStore(
  initial: MmSessionState = INITIAL,
): MmSessionStore {
  let state = { ...initial }
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const l of listeners) l()
  }

  const set = (next: MmSessionState) => {
    if (next === state) return
    if (sameState(next, state)) return
    state = next
    notify()
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start: () => set(transitionStart(state)),
    stop: () => set(transitionStop(state)),
    reset: () => set(transitionReset(state)),
    patchStats: (patch) => {
      const next = { ...state, ...patch }
      set(next)
    },
  }
}

/** Shared singleton for the Apple-clean V1 UI. */
export const mmSessionStore = createMmSessionStore()

/** Signed dollar string for strip metrics, e.g. +$1.25 / -$0.50 / $0.00 */
export function formatSignedDollars(n: number): string {
  const abs = Math.abs(n).toFixed(2)
  if (n > 0) return `+$${abs}`
  if (n < 0) return `-$${abs}`
  return `$${abs}`
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

export function statusPillLabel(
  state: MmSessionState,
  nowMs: number = Date.now(),
): string {
  if (state.status === 'idle') return 'Idle'
  if (state.status === 'stopped') return 'Stopped'
  const started = state.startedAt ?? nowMs
  return `Running · ${formatElapsed(nowMs - started)}`
}

/** Apple-clean error line: `U2.2: … — needs …` / `U2.3:` / `U2.4:` */
export function formatUpdateError(err: MmUpdateError): string {
  return `${err.code}: ${err.message} — needs ${err.dependency}`
}

export function makeUpdateError(
  message: string,
  dependency: string,
  code: 'U2.2' | 'U2.3' | 'U2.4' | 'U2.13' | 'U2.14' = 'U2.2',
): MmUpdateError {
  return { code, message, dependency }
}
