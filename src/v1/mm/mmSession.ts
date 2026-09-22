/**
 * U2.1 — Paper MM session framework (state only).
 * Start / Stop / Reset shell for later quoting engine attachment (U2.2+).
 * No fills, no quoting, no live orders.
 */

export type MmSessionStatus = 'idle' | 'running' | 'stopped'

export type MmSessionState = {
  status: MmSessionStatus
  startedAt: number | null
  stoppedAt: number | null
  resetCount: number
}

export type MmSessionStore = {
  getState: () => MmSessionState
  subscribe: (listener: () => void) => () => void
  start: () => void
  stop: () => void
  reset: () => void
}

const INITIAL: MmSessionState = {
  status: 'idle',
  startedAt: null,
  stoppedAt: null,
  resetCount: 0,
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
 * Reset clears session counters / returns to idle.
 * Does not wipe the market feed (feed lives outside this store).
 */
export function transitionReset(state: MmSessionState): MmSessionState {
  return {
    status: 'idle',
    startedAt: null,
    stoppedAt: null,
    resetCount: state.resetCount + 1,
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
    // shallow equality for no-op transitions
    if (
      next.status === state.status &&
      next.startedAt === state.startedAt &&
      next.stoppedAt === state.stoppedAt &&
      next.resetCount === state.resetCount
    ) {
      return
    }
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
