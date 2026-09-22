import { describe, expect, it } from 'vitest'
import {
  createMmSessionStore,
  formatElapsed,
  statusPillLabel,
  transitionReset,
  transitionStart,
  transitionStop,
  type MmSessionState,
} from './mmSession'

const idle: MmSessionState = {
  status: 'idle',
  startedAt: null,
  stoppedAt: null,
  resetCount: 0,
}

describe('mmSession transitions', () => {
  it('start: idle → running with startedAt', () => {
    const t = 1_700_000_000_000
    const next = transitionStart(idle, t)
    expect(next.status).toBe('running')
    expect(next.startedAt).toBe(t)
    expect(next.stoppedAt).toBeNull()
    expect(next.resetCount).toBe(0)
  })

  it('start: stopped → running (restarts clock)', () => {
    const stopped: MmSessionState = {
      status: 'stopped',
      startedAt: 100,
      stoppedAt: 200,
      resetCount: 1,
    }
    const next = transitionStart(stopped, 300)
    expect(next.status).toBe('running')
    expect(next.startedAt).toBe(300)
    expect(next.stoppedAt).toBeNull()
    expect(next.resetCount).toBe(1)
  })

  it('start: running is a no-op', () => {
    const running: MmSessionState = {
      status: 'running',
      startedAt: 100,
      stoppedAt: null,
      resetCount: 0,
    }
    expect(transitionStart(running, 999)).toBe(running)
  })

  it('stop: running → stopped with stoppedAt', () => {
    const running: MmSessionState = {
      status: 'running',
      startedAt: 100,
      stoppedAt: null,
      resetCount: 0,
    }
    const next = transitionStop(running, 250)
    expect(next.status).toBe('stopped')
    expect(next.startedAt).toBe(100)
    expect(next.stoppedAt).toBe(250)
  })

  it('stop: idle / stopped are no-ops', () => {
    expect(transitionStop(idle, 1)).toBe(idle)
    const stopped: MmSessionState = {
      status: 'stopped',
      startedAt: 1,
      stoppedAt: 2,
      resetCount: 0,
    }
    expect(transitionStop(stopped, 99)).toBe(stopped)
  })

  it('reset: returns to idle and bumps resetCount; clears timestamps', () => {
    const running: MmSessionState = {
      status: 'running',
      startedAt: 100,
      stoppedAt: null,
      resetCount: 2,
    }
    const next = transitionReset(running)
    expect(next).toEqual({
      status: 'idle',
      startedAt: null,
      stoppedAt: null,
      resetCount: 3,
    })
  })

  it('reset from stopped / idle still increments', () => {
    expect(transitionReset(idle).resetCount).toBe(1)
    const stopped: MmSessionState = {
      status: 'stopped',
      startedAt: 1,
      stoppedAt: 2,
      resetCount: 0,
    }
    expect(transitionReset(stopped)).toEqual({
      status: 'idle',
      startedAt: null,
      stoppedAt: null,
      resetCount: 1,
    })
  })
})

describe('createMmSessionStore', () => {
  it('start → stop → reset state machine via store API', () => {
    const store = createMmSessionStore()
    const seen: MmSessionState['status'][] = []
    store.subscribe(() => seen.push(store.getState().status))

    expect(store.getState().status).toBe('idle')
    store.start()
    expect(store.getState().status).toBe('running')
    expect(store.getState().startedAt).toBeTypeOf('number')
    store.start() // no-op
    store.stop()
    expect(store.getState().status).toBe('stopped')
    expect(store.getState().stoppedAt).toBeTypeOf('number')
    store.reset()
    expect(store.getState()).toMatchObject({
      status: 'idle',
      startedAt: null,
      stoppedAt: null,
      resetCount: 1,
    })
    expect(seen).toEqual(['running', 'stopped', 'idle'])
  })

  it('unsubscribe stops notifications', () => {
    const store = createMmSessionStore()
    let n = 0
    const unsub = store.subscribe(() => {
      n += 1
    })
    store.start()
    unsub()
    store.stop()
    expect(n).toBe(1)
  })
})

describe('statusPillLabel / formatElapsed', () => {
  it('formats elapsed mm:ss and hh:mm:ss', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(3_661_000)).toBe('1:01:01')
  })

  it('pill labels for idle / stopped / running', () => {
    expect(statusPillLabel(idle)).toBe('Idle')
    expect(
      statusPillLabel({
        status: 'stopped',
        startedAt: 1,
        stoppedAt: 2,
        resetCount: 0,
      }),
    ).toBe('Stopped')
    expect(
      statusPillLabel(
        { status: 'running', startedAt: 1_000, stoppedAt: null, resetCount: 0 },
        1_000 + 65_000,
      ),
    ).toBe('Running · 1:05')
  })
})
