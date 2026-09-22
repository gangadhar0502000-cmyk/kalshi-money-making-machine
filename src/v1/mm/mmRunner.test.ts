import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../types/crypto15m'
import type { ContinuousFeedSnapshot } from '../../lib/crypto15m/mm/continuousFeed'
import type { MmEngineState, MmSnapshot } from '../../lib/crypto15m/mm/types'
import { DEFAULT_PAPER_MM_CONFIG } from '../../lib/crypto15m/mm/config'
import {
  createMmSessionStore,
  MM_SESSION_STARTING_CASH,
} from './mmSession'
import {
  createMmRunner,
  deriveUpdateError,
  type MmEngineHandle,
} from './mmRunner'

function demoMarket(ticker = 'KXBTC15M-DEMO'): Crypto15mMarket {
  const closeTime = new Date(Date.now() + 10 * 60_000).toISOString()
  return {
    ticker,
    eventTicker: 'KXBTC15M',
    seriesTicker: 'KXBTC15M',
    asset: 'BTC',
    title: 'BTC demo',
    status: 'active',
    openTime: null,
    closeTime,
    yesBid: 0.48,
    yesAsk: 0.52,
    noBid: 0.48,
    noAsk: 0.52,
    midYes: 0.5,
    spreadCents: 4,
    last: 0.5,
    volume: 10,
    volume24h: 10,
    openInterest: 10,
    yesBidSize: 5,
    yesAskSize: 5,
    floorStrike: 100_000,
    rulesPrimary: '',
    kalshiUrl: '',
    windowMinutes: 15,
    minutesElapsed: 5,
    minutesRemaining: 10,
    feeEstimate1: 0,
    thinBook: false,
    raw: {} as Crypto15mMarket['raw'],
  }
}

function baseSnapshot(over: Partial<MmSnapshot> = {}): MmSnapshot {
  return {
    running: false,
    marketTicker: null,
    marketCloseTime: null,
    asset: null,
    config: { ...DEFAULT_PAPER_MM_CONFIG, multiBook: false },
    quote: null,
    inventory: 0,
    cash: MM_SESSION_STARTING_CASH,
    midYes: 0.5,
    spotPrice: null,
    spotSource: null,
    realizedSpreadPnl: 0,
    feesPaid: 0,
    unrealizedInventoryPnl: 0,
    avgEntry: null,
    fillCount: 0,
    cancelCount: 0,
    midCrossRejectCount: 0,
    guardActiveUntil: 0,
    guardMode: null,
    lastTickAt: null,
    sessionStartedAt: null,
    settled: false,
    message: 'Idle',
    liveBook: false,
    liveBookAuthenticated: false,
    bookBestBid: null,
    bookBestAsk: null,
    unitsWarning: null,
    moneyPrinterBug: false,
    fairValue: null,
    edgeVsMidCents: null,
    floorStrike: null,
    minutesRemaining: null,
    fvCenterActive: false,
    fillsPerHour: 0,
    fillsLastMinute: 0,
    fillsLast15m: 0,
    harshFillsPerHour: 0,
    harshFillsLast15m: 0,
    harshPolicyEpochMs: Date.now(),
    fillRateUnrealistic: false,
    realizedDeltaLast15m: 0,
    avgCaptureCentsPerFillLast15m: 0,
    portfolioFillCap15m: null,
    stuckTicks: 0,
    ...over,
  }
}

function makeStubEngine(initial?: Partial<MmSnapshot>): MmEngineHandle & {
  _snap: MmSnapshot
  _fills: MmEngineState['fills']
  _listeners: Set<() => void>
  _emit: () => void
} {
  const listeners = new Set<() => void>()
  const stub = {
    _snap: baseSnapshot(initial),
    _fills: [] as MmEngineState['fills'],
    _listeners: listeners,
    _emit() {
      for (const l of listeners) l()
    },
    setConfig: vi.fn(),
    setMarket: vi.fn((m: Crypto15mMarket | null) => {
      stub._snap = {
        ...stub._snap,
        marketTicker: m?.ticker ?? null,
        asset: m?.asset ?? null,
        midYes: m?.midYes ?? stub._snap.midYes,
      }
    }),
    start: vi.fn(() => {
      stub._snap = {
        ...stub._snap,
        running: true,
        sessionStartedAt: Date.now(),
        message: 'Paper MM running (strict realism).',
      }
      stub._emit()
    }),
    stop: vi.fn(() => {
      stub._snap = { ...stub._snap, running: false, message: 'Stopped.' }
      stub._emit()
    }),
    resetSession: vi.fn(() => {
      stub._snap = baseSnapshot({
        marketTicker: stub._snap.marketTicker,
        asset: stub._snap.asset,
        message: 'Session reset.',
      })
      stub._fills = []
      stub._emit()
    }),
    onMarketTick: vi.fn(),
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getState: (): MmEngineState => ({
      snapshot: { ...stub._snap },
      fills: [...stub._fills],
      cancels: [],
    }),
  }
  return stub
}

describe('deriveUpdateError', () => {
  it('maps L2/orderbook failure to U2.2 + mm-proxy dependency', () => {
    const err = deriveUpdateError(
      baseSnapshot({
        liveBook: false,
        message: 'L2 book poll failed (falling back to soft sim): fetch failed',
      }),
    )
    expect(err).toEqual({
      code: 'U2.2',
      message: 'orderbook failed',
      dependency: 'mm-proxy :8787',
    })
  })

  it('maps spot poll failure', () => {
    const err = deriveUpdateError(
      baseSnapshot({ message: 'Spot poll failed: network' }),
    )
    expect(err).toEqual({
      code: 'U2.2',
      message: 'spot failed',
      dependency: 'public spot feed',
    })
  })

  it('returns null when healthy', () => {
    expect(
      deriveUpdateError(
        baseSnapshot({
          liveBook: true,
          message: 'Paper MM running (strict realism).',
        }),
      ),
    ).toBeNull()
  })
})

describe('mmRunner start/stop/reset', () => {
  const runners: ReturnType<typeof createMmRunner>[] = []

  afterEach(() => {
    for (const r of runners) r.dispose()
    runners.length = 0
  })

  function pair(engine = makeStubEngine()) {
    const store = createMmSessionStore()
    const market = demoMarket()
    const feed: ContinuousFeedSnapshot = {
      markets: [market],
      everSucceeded: true,
      lastSuccessAt: new Date().toISOString(),
      stale: false,
      cacheAgeMs: 0,
      refreshing: false,
      authenticated: true,
      readOnly: true,
    }
    const runner = createMmRunner({
      store,
      engine,
      getFeed: () => feed,
      tickMs: 10_000,
    })
    runners.push(runner)
    return { store, engine, runner, market }
  }

  it('start binds engine, writes stats; stop freezes; reset zeros P&L', () => {
    const { store, engine, runner, market } = pair()

    runner.start(market.ticker)
    expect(engine.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ multiBook: false, strictRealism: true }),
    )
    expect(engine.setMarket).toHaveBeenCalledWith(market)
    expect(engine.start).toHaveBeenCalled()
    expect(store.getState().status).toBe('running')
    expect(store.getState().activeTicker).toBe(market.ticker)
    expect(store.getState().cash).toBe(MM_SESSION_STARTING_CASH)

    // Simulate a fill / PnL update from engine
    engine._snap = {
      ...engine._snap,
      cash: 98,
      inventory: 1,
      realizedSpreadPnl: 0.5,
      unrealizedInventoryPnl: 0.1,
      feesPaid: 0.02,
      fillCount: 2,
      liveBook: true,
      message: 'ok',
    }
    engine._fills = [
      {
        id: 'f1',
        t: 1_111,
        side: 'buy_yes',
        price: 0.5,
        size: 1,
        midAtFill: 0.5,
        toxic: false,
        reason: 'book_depth',
        feeDollars: 0,
        taker: false,
      },
    ]
    engine._emit()

    expect(store.getState()).toMatchObject({
      cash: 98,
      inventory: 1,
      realizedPnl: 0.5,
      unrealizedPnl: 0.1,
      fees: 0.02,
      fillsCount: 2,
      lastFillAt: 1_111,
      updateError: null,
    })

    runner.stop()
    expect(engine.stop).toHaveBeenCalled()
    expect(store.getState().status).toBe('stopped')
    // Numbers frozen (still present)
    expect(store.getState().cash).toBe(98)
    expect(store.getState().fillsCount).toBe(2)

    runner.reset()
    expect(engine.resetSession).toHaveBeenCalled()
    expect(store.getState()).toMatchObject({
      status: 'idle',
      cash: MM_SESSION_STARTING_CASH,
      inventory: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      fees: 0,
      fillsCount: 0,
      lastFillAt: null,
      activeTicker: null,
      updateError: null,
    })
  })

  it('start without market sets U2.2 error and stays idle', () => {
    const store = createMmSessionStore()
    const engine = makeStubEngine()
    const emptyFeed: ContinuousFeedSnapshot = {
      markets: [],
      everSucceeded: false,
      stale: false,
      cacheAgeMs: null,
      refreshing: false,
      authenticated: false,
      readOnly: true,
    }
    const runner = createMmRunner({
      store,
      engine,
      getFeed: () => emptyFeed,
    })
    runners.push(runner)

    runner.start(null)
    expect(engine.start).not.toHaveBeenCalled()
    expect(store.getState().status).toBe('idle')
    expect(store.getState().updateError).toEqual({
      code: 'U2.2',
      message: 'no market selected',
      dependency: 'focused ticker from feed',
    })
  })

  it('surfaces orderbook failure from engine message as updateError', () => {
    const { store, engine, runner, market } = pair()
    runner.start(market.ticker)
    engine._snap = {
      ...engine._snap,
      liveBook: false,
      message: 'L2 book poll failed (falling back to soft sim): HTTP 502',
    }
    engine._emit()
    expect(store.getState().updateError).toEqual({
      code: 'U2.2',
      message: 'orderbook failed',
      dependency: 'mm-proxy :8787',
    })
  })
})
