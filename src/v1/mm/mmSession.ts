/**
 * U2.1 / U2.2 — Paper MM session store.
 * Start / Stop / Reset shell + paper P&L stats (engine attached via mmRunner).
 * Paper-only · read-only Kalshi · never places live orders.
 */

export type MmSessionStatus = 'idle' | 'running' | 'stopped'

/** Fail-loud update error surfaced in the Apple-clean strip. */
export type MmUpdateError = {
  code: 'U2.2'
  message: string
  dependency: string
}

export type MmSessionState = {
  status: MmSessionStatus
  startedAt: number | null
  stoppedAt: number | null
  resetCount: number
  /** Paper cash ($) — mirrors engine startingCash / cash. */
  cash: number
  /** Net YES inventory (contracts). */
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
  /** Ticker the runner is quoting (single-book). */
  activeTicker: string | null
  /** Fail-loud U2.2 error (orderbook/spot/etc); null when healthy. */
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

/** Default paper starting cash — matches STRICT_PAPER_MM_CONFIG.startingCash. */
export const MM_SESSION_STARTING_CASH = 100

const ZERO_STATS = {
  cash: MM_SESSION_STARTING_CASH,
  inventory: 0,
  realizedPnl: 0,
  unrealizedPnl: 0,
  fees: 0,
  fillsCount: 0,
  lastFillAt: null as number | null,
  activeTicker: null as string | null,
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
    sameError(a.updateError, b.updateError)
  )
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
 * Reset clears session counters / P&L / errors → idle.
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

/** Apple-clean error line: `U2.2: … — needs …` */
export function formatUpdateError(err: MmUpdateError): string {
  return `U2.2: ${err.message} — needs ${err.dependency}`
}

export function makeUpdateError(
  message: string,
  dependency: string,
): MmUpdateError {
  return { code: 'U2.2', message, dependency }
}
