import { describe, expect, it } from 'vitest'
import {
  createMmSessionStore,
  formatElapsed,
  formatSignedDollars,
  formatUpdateError,
  makeUpdateError,
  MM_SESSION_STARTING_CASH,
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
  cash: MM_SESSION_STARTING_CASH,
  inventory: 0,
  realizedPnl: 0,
  unrealizedPnl: 0,
  fees: 0,
  fillsCount: 0,
  lastFillAt: null,
  activeTicker: null,
  quoteBook: null,
  activeBooks: 0,
  books: [],
  updateError: null,
}

describe('mmSession transitions', () => {
  it('start: idle → running with startedAt; clears updateError', () => {
    const t = 1_700_000_000_000
    const withErr: MmSessionState = {
      ...idle,
      updateError: makeUpdateError('orderbook failed', 'mm-proxy :8787'),
    }
    const next = transitionStart(withErr, t)
    expect(next.status).toBe('running')
    expect(next.startedAt).toBe(t)
    expect(next.stoppedAt).toBeNull()
    expect(next.resetCount).toBe(0)
    expect(next.updateError).toBeNull()
  })

  it('start: stopped → running (restarts clock)', () => {
    const stopped: MmSessionState = {
      ...idle,
      status: 'stopped',
      startedAt: 100,
      stoppedAt: 200,
      resetCount: 1,
      cash: 95,
      inventory: 2,
      realizedPnl: 1.5,
      quoteBook: 'NO',
    }
    const next = transitionStart(stopped, 300)
    expect(next.status).toBe('running')
    expect(next.startedAt).toBe(300)
    expect(next.stoppedAt).toBeNull()
    expect(next.resetCount).toBe(1)
    expect(next.cash).toBe(95)
    expect(next.inventory).toBe(2)
    expect(next.quoteBook).toBe('NO')
  })

  it('start: running is a no-op', () => {
    const running: MmSessionState = {
      ...idle,
      status: 'running',
      startedAt: 100,
    }
    expect(transitionStart(running, 999)).toBe(running)
  })

  it('stop: running → stopped with stoppedAt (stats freeze in place)', () => {
    const running: MmSessionState = {
      ...idle,
      status: 'running',
      startedAt: 100,
      cash: 90,
      inventory: -1,
      realizedPnl: 0.4,
      fillsCount: 3,
      quoteBook: 'YES',
    }
    const next = transitionStop(running, 250)
    expect(next.status).toBe('stopped')
    expect(next.startedAt).toBe(100)
    expect(next.stoppedAt).toBe(250)
    expect(next.cash).toBe(90)
    expect(next.fillsCount).toBe(3)
    expect(next.quoteBook).toBe('YES')
  })

  it('stop: idle / stopped are no-ops', () => {
    expect(transitionStop(idle, 1)).toBe(idle)
    const stopped: MmSessionState = {
      ...idle,
      status: 'stopped',
      startedAt: 1,
      stoppedAt: 2,
    }
    expect(transitionStop(stopped, 99)).toBe(stopped)
  })

  it('reset: returns to idle, zeros P&L/inventory/fills/errors/quoteBook, bumps resetCount', () => {
    const running: MmSessionState = {
      ...idle,
      status: 'running',
      startedAt: 100,
      resetCount: 2,
      cash: 80,
      inventory: 4,
      realizedPnl: 2,
      unrealizedPnl: -0.5,
      fees: 0.1,
      fillsCount: 7,
      lastFillAt: 999,
      activeTicker: 'KXBTC-1',
      quoteBook: 'NO',
      updateError: makeUpdateError('orderbook failed', 'mm-proxy :8787'),
    }
    const next = transitionReset(running)
    expect(next).toEqual({
      status: 'idle',
      startedAt: null,
      stoppedAt: null,
      resetCount: 3,
      cash: MM_SESSION_STARTING_CASH,
      inventory: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      fees: 0,
      fillsCount: 0,
      lastFillAt: null,
      activeTicker: null,
      quoteBook: null,
      activeBooks: 0,
      books: [],
      updateError: null,
    })
  })

  it('reset from stopped / idle still increments', () => {
    expect(transitionReset(idle).resetCount).toBe(1)
    const stopped: MmSessionState = {
      ...idle,
      status: 'stopped',
      startedAt: 1,
      stoppedAt: 2,
    }
    expect(transitionReset(stopped).status).toBe('idle')
    expect(transitionReset(stopped).resetCount).toBe(1)
  })
})

describe('createMmSessionStore', () => {
  it('start → stop → reset state machine via store API', () => {
    const store = createMmSessionStore()
    const seen: MmSessionState['status'][] = []
    store.subscribe(() => seen.push(store.getState().status))

    expect(store.getState().status).toBe('idle')
    expect(store.getState().quoteBook).toBeNull()
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
      cash: MM_SESSION_STARTING_CASH,
      inventory: 0,
      realizedPnl: 0,
      fillsCount: 0,
      quoteBook: null,
      updateError: null,
    })
    expect(seen).toEqual(['running', 'stopped', 'idle'])
  })

  it('patchStats merges paper stats without changing status', () => {
    const store = createMmSessionStore()
    store.start()
    store.patchStats({
      cash: 97.5,
      inventory: 2,
      realizedPnl: 0.25,
      unrealizedPnl: -0.1,
      fees: 0.02,
      fillsCount: 1,
      lastFillAt: 123,
      activeTicker: 'KXETH-1',
      quoteBook: 'NO',
    })
    expect(store.getState()).toMatchObject({
      status: 'running',
      cash: 97.5,
      inventory: 2,
      realizedPnl: 0.25,
      fillsCount: 1,
      activeTicker: 'KXETH-1',
      quoteBook: 'NO',
    })
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

describe('U2.2 / U2.3 error object shape', () => {
  it('makeUpdateError defaults to U2.2 + formatUpdateError', () => {
    const err = makeUpdateError('orderbook failed', 'mm-proxy :8787')
    expect(err).toEqual({
      code: 'U2.2',
      message: 'orderbook failed',
      dependency: 'mm-proxy :8787',
    })
    expect(formatUpdateError(err)).toBe(
      'U2.2: orderbook failed — needs mm-proxy :8787',
    )
  })

  it('makeUpdateError with U2.3 code formats U2.3 line', () => {
    const err = makeUpdateError(
      'YES book one-sided',
      'two-sided YES and NO touch on feed',
      'U2.3',
    )
    expect(err.code).toBe('U2.3')
    expect(formatUpdateError(err)).toBe(
      'U2.3: YES book one-sided — needs two-sided YES and NO touch on feed',
    )
  })
})

describe('U2.4 / U2.13 / U2.14 error format', () => {
  it('makeUpdateError with U2.4 code formats U2.4 line', () => {
    const err = makeUpdateError(
      'no markets in feed',
      'continuous feed / mm-proxy :8787',
      'U2.4',
    )
    expect(err.code).toBe('U2.4')
    expect(formatUpdateError(err)).toBe(
      'U2.4: no markets in feed — needs continuous feed / mm-proxy :8787',
    )
  })

  it('makeUpdateError with U2.13 code formats U2.13 line', () => {
    const err = makeUpdateError(
      'L2 off — no soft fills',
      'mm-proxy :8787',
      'U2.13',
    )
    expect(err.code).toBe('U2.13')
    expect(formatUpdateError(err)).toBe(
      'U2.13: L2 off — no soft fills — needs mm-proxy :8787',
    )
  })

  it('makeUpdateError with U2.14 code formats U2.14 line', () => {
    const err = makeUpdateError(
      'dropped BTC-X — L2 off',
      'mm-proxy :8787',
      'U2.14',
    )
    expect(err.code).toBe('U2.14')
    expect(formatUpdateError(err)).toBe(
      'U2.14: dropped BTC-X — L2 off — needs mm-proxy :8787',
    )
  })


  it('reset clears activeBooks', () => {
    const running: MmSessionState = {
      ...idle,
      status: 'running',
      startedAt: 100,
      activeBooks: 3,
    }
    expect(transitionReset(running).activeBooks).toBe(0)
  })
})

describe('U2.5 books panel state', () => {
  it('reset clears books', () => {
    const running: MmSessionState = {
      ...idle,
      status: 'running',
      startedAt: 100,
      activeBooks: 2,
      books: [
        {
          slotId: 'slot-1',
          ticker: 'KX-A',
          asset: 'BTC',
          inventory: 1,
          realizedPnl: 0.1,
          unrealizedPnl: -0.05,
          fillsCount: 2,
          liveBook: true,
          midYes: 0.5,
          message: 'ok',
          quoteBook: 'YES',
        },
      ],
    }
    const next = transitionReset(running)
    expect(next.books).toEqual([])
    expect(next.activeBooks).toBe(0)
  })

  it('patchStats sets books', () => {
    const store = createMmSessionStore()
    store.start()
    const rows = [
      {
        slotId: 'slot-1',
        ticker: 'KX-A',
        asset: 'BTC',
        inventory: 2,
        realizedPnl: 0.25,
        unrealizedPnl: 0.1,
        fillsCount: 3,
        liveBook: true,
        midYes: 0.51,
        message: 'quoting',
        quoteBook: 'YES',
      },
      {
        slotId: 'slot-2',
        ticker: 'KX-B',
        asset: 'ETH',
        inventory: -1,
        realizedPnl: -0.05,
        unrealizedPnl: 0,
        fillsCount: 1,
        liveBook: false,
        midYes: 0.48,
        message: 'L2 book poll failed',
        quoteBook: 'NO',
      },
    ]
    store.patchStats({ books: rows, activeBooks: 2 })
    expect(store.getState().books).toEqual(rows)
    expect(store.getState().activeBooks).toBe(2)
    expect(store.getState().status).toBe('running')
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
        ...idle,
        status: 'stopped',
        startedAt: 1,
        stoppedAt: 2,
      }),
    ).toBe('Stopped')
    expect(
      statusPillLabel(
        { ...idle, status: 'running', startedAt: 1_000 },
        1_000 + 65_000,
      ),
    ).toBe('Running · 1:05')
  })
})

describe('formatSignedDollars', () => {
  it('formats positive, negative, and zero', () => {
    expect(formatSignedDollars(1.25)).toBe('+$1.25')
    expect(formatSignedDollars(-0.5)).toBe('-$0.50')
    expect(formatSignedDollars(0)).toBe('$0.00')
  })
})

