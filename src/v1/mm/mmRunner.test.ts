import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../types/crypto15m'
import type { ContinuousFeedSnapshot } from '../../lib/crypto15m/mm/continuousFeed'
import type { PortfolioState } from '../../lib/crypto15m/mm/portfolio'
import { DEFAULT_PAPER_MM_CONFIG } from '../../lib/crypto15m/mm/config'
import type { MmFill, MmSnapshot } from '../../lib/crypto15m/mm/types'
import { emptyFillCapSnapshot } from '../../lib/crypto15m/mm/fillCaps'
import {
  createMmSessionStore,
  MM_MAX_ACTIVE_BOOKS,
  MM_SESSION_STARTING_CASH,
} from './mmSession'
import {
  createMmRunner,
  derivePortfolioUpdateError,
  deriveUpdateError,
  type MmPortfolioHandle,
} from './mmRunner'

function mkMarket(
  partial: Partial<Crypto15mMarket> & Pick<Crypto15mMarket, 'ticker' | 'asset'>,
): Crypto15mMarket {
  return {
    eventTicker: partial.eventTicker ?? partial.ticker,
    seriesTicker: partial.seriesTicker ?? `KX${partial.asset}15M`,
    title: partial.title ?? `${partial.asset} 15m`,
    status: partial.status ?? 'active',
    openTime: partial.openTime ?? new Date(Date.now() - 5 * 60_000).toISOString(),
    closeTime: partial.closeTime ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    yesBid: partial.yesBid ?? 0.48,
    yesAsk: partial.yesAsk ?? 0.52,
    noBid: partial.noBid ?? 0.48,
    noAsk: partial.noAsk ?? 0.52,
    midYes: partial.midYes ?? 0.5,
    spreadCents: partial.spreadCents ?? 4,
    last: partial.last ?? 0.5,
    volume: partial.volume ?? 10,
    volume24h: partial.volume24h ?? 10,
    openInterest: partial.openInterest ?? 10,
    yesBidSize: partial.yesBidSize ?? 5,
    yesAskSize: partial.yesAskSize ?? 5,
    floorStrike: partial.floorStrike ?? 100_000,
    rulesPrimary: partial.rulesPrimary ?? '',
    kalshiUrl: partial.kalshiUrl ?? '',
    windowMinutes: partial.windowMinutes ?? 15,
    minutesElapsed: partial.minutesElapsed ?? 5,
    minutesRemaining: partial.minutesRemaining ?? 10,
    feeEstimate1: partial.feeEstimate1 ?? 0,
    thinBook: partial.thinBook ?? false,
    raw: (partial.raw ?? {}) as Crypto15mMarket['raw'],
    ...partial,
  }
}

function baseSnap(over: Partial<MmSnapshot> = {}): MmSnapshot {
  return {
    ...({
      running: false,
      marketTicker: null,
      message: 'Idle',
      liveBook: false,
      quoteBookSide: 'yes',
      cash: MM_SESSION_STARTING_CASH,
      inventory: 0,
      midYes: 0.5,
      config: { ...DEFAULT_PAPER_MM_CONFIG, multiBook: true, strictRealism: false },
    } as MmSnapshot),
    ...over,
  }
}

function emptyAgg(over: Partial<PortfolioState['aggregate']> = {}) {
  return {
    cash: MM_SESSION_STARTING_CASH,
    realizedSpreadPnl: 0,
    unrealizedInventoryPnl: 0,
    feesPaid: 0,
    fillCount: 0,
    cancelCount: 0,
    inventoryNet: 0,
    activeBooks: 0,
    moneyPrinterBug: false,
    harshFillsPerHour: 0,
    harshFillsLast15m: 0,
    harshPolicyEpochMs: Date.now(),
    portfolioFillCap15m: 20,
    realizedDeltaLast15m: 0,
    avgCaptureCentsPerFillLast15m: 0,
    ...over,
  }
}

function basePortfolio(over: Partial<PortfolioState> = {}): PortfolioState {
  return {
    running: false,
    config: {
      ...DEFAULT_PAPER_MM_CONFIG,
      multiBook: true,
      strictRealism: false,
      maxActiveMarkets: MM_MAX_ACTIVE_BOOKS,
    },
    books: [],
    scan: [],
    aggregate: emptyAgg(),
    message: 'Idle',
    spotsByAsset: {},
    sessionStartedAt: null,
    sessionFills: [],
    sessionCancels: [],
    fillCaps: emptyFillCapSnapshot(),
    ...over,
  }
}

function makeStubPortfolio(
  initial?: Partial<PortfolioState>,
): MmPortfolioHandle & {
  _state: PortfolioState
  _emit: () => void
} {
  const listeners = new Set<() => void>()
  const stub = {
    _state: basePortfolio(initial),
    _emit() {
      for (const l of listeners) l()
    },
    setConfig: vi.fn((partial: Record<string, unknown>) => {
      stub._state = {
        ...stub._state,
        config: { ...stub._state.config, ...partial } as PortfolioState['config'],
      }
    }),
    setStrictRealism: vi.fn((strict: boolean) => {
      stub._state = {
        ...stub._state,
        config: { ...stub._state.config, strictRealism: strict },
      }
    }),
    syncMarketUniverse: vi.fn((markets: Crypto15mMarket[]) => {
      const n = Math.min(markets.length, stub._state.config.maxActiveMarkets)
      stub._state = {
        ...stub._state,
        books: markets.slice(0, n).map((m, i) => ({
          slotId: `slot-${i + 1}`,
          snapshot: baseSnap({
            marketTicker: m.ticker,
            asset: m.asset,
            midYes: m.midYes,
            running: stub._state.running,
            liveBook: true,
            message: 'ok',
          }),
          fills: [],
          cancels: [],
        })),
        aggregate: emptyAgg({
          ...stub._state.aggregate,
          activeBooks: n,
        }),
        message:
          n > 0
            ? `Quoting ${n}/${stub._state.config.maxActiveMarkets}. Read-only · never places trades.`
            : stub._state.message,
      }
    }),
    start: vi.fn(() => {
      stub._state = {
        ...stub._state,
        running: true,
        sessionStartedAt: Date.now(),
        message: `Multi-book paper MM running (up to ${stub._state.config.maxActiveMarkets}).`,
      }
      stub._emit()
    }),
    stop: vi.fn(() => {
      stub._state = { ...stub._state, running: false, message: 'Stopped.' }
      stub._emit()
    }),
    resetSession: vi.fn(() => {
      stub._state = basePortfolio({ message: 'Session reset.' })
      stub._emit()
    }),
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getState: (): PortfolioState => ({
      ...stub._state,
      books: [...stub._state.books],
      aggregate: { ...stub._state.aggregate },
      config: { ...stub._state.config },
      sessionFills: [...stub._state.sessionFills],
    }),
  }
  return stub
}

describe('deriveUpdateError', () => {
  it('maps L2 off to U2.13 + mm-proxy dependency', () => {
    const err = deriveUpdateError(
      baseSnap({
        liveBook: false,
        message: 'L2 off — no soft fills (U2.13): fetch failed',
      }),
    )
    expect(err).toEqual({
      code: 'U2.13',
      message: 'L2 off — no soft fills',
      dependency: 'mm-proxy :8787',
    })
  })

  it('maps spot poll failure', () => {
    expect(
      deriveUpdateError(baseSnap({ message: 'Spot poll failed: network' })),
    ).toEqual({
      code: 'U2.2',
      message: 'spot failed',
      dependency: 'public spot feed',
    })
  })

  it('returns null when healthy', () => {
    expect(
      deriveUpdateError(
        baseSnap({ liveBook: true, message: 'Paper MM running (loose).' }),
      ),
    ).toBeNull()
  })
})

describe('derivePortfolioUpdateError', () => {
  it('maps under-filled message to U2.4', () => {
    const err = derivePortfolioUpdateError(
      basePortfolio({
        running: true,
        message:
          'Multi-book under-filled (1/5) — retrying fill from 4 open ranked. Read-only · never places trades.',
        aggregate: emptyAgg({ activeBooks: 1 }),
        config: {
          ...DEFAULT_PAPER_MM_CONFIG,
          multiBook: true,
          strictRealism: false,
          maxActiveMarkets: MM_MAX_ACTIVE_BOOKS,
          quotingEnabled: true, // isolate U2.4 mapping from U3.0 pause strip
        },
      }),
    )
    expect(err?.code).toBe('U2.4')
    expect(err?.message).toContain('under-filled')
  })

  it('maps U2.14 drop message to U2.14 + mm-proxy', () => {
    const err = derivePortfolioUpdateError(
      basePortfolio({
        running: true,
        message: 'U2.14: dropped BTC-L2OFF — L2 off',
        aggregate: emptyAgg({ activeBooks: 1 }),
      }),
    )
    expect(err).toEqual({
      code: 'U2.14',
      message: 'dropped BTC-L2OFF — L2 off',
      dependency: 'mm-proxy :8787',
    })
  })

  it('maps U2.14 holding-inv book message to U2.14', () => {
    const err = derivePortfolioUpdateError(
      basePortfolio({
        running: true,
        message: 'Multi-book paper MM running.',
        books: [
          {
            slotId: 's1',
            snapshot: baseSnap({
              marketTicker: 'BTC-X',
              liveBook: false,
              inventory: 2,
              message: 'U2.14: L2 off — holding inv until flat',
            }),
            fills: [],
            cancels: [],
          },
        ],
        aggregate: emptyAgg({ activeBooks: 1 }),
      }),
    )
    expect(err?.code).toBe('U2.14')
    expect(err?.message).toBe('L2 off — holding inv until flat')
  })

})

describe('mmRunner multi-book loose start/stop/reset', () => {
  const runners: ReturnType<typeof createMmRunner>[] = []

  afterEach(() => {
    for (const r of runners) r.dispose()
    runners.length = 0
  })

  function pair(
    portfolio = makeStubPortfolio(),
    markets = [
      mkMarket({ ticker: 'KX-A', asset: 'BTC' }),
      mkMarket({ ticker: 'KX-B', asset: 'ETH' }),
    ],
  ) {
    const store = createMmSessionStore()
    const feed: ContinuousFeedSnapshot = {
      markets,
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
      portfolio,
      getFeed: () => feed,
      tickMs: 10_000,
    })
    runners.push(runner)
    return { store, portfolio, runner, markets, feed }
  }

  it('Start with 2+ feed markets → strict L2 multi portfolio + aggregate stats', () => {
    const { store, portfolio, runner, markets } = pair()

    runner.start(markets[0]!.ticker)

    expect(portfolio.setStrictRealism).toHaveBeenCalledWith(true)
    expect(portfolio.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        multiBook: true,
        maxActiveMarkets: MM_MAX_ACTIVE_BOOKS,
        strictRealism: true,
        allowMidWalk: false,
        fillMidFallback: false,
        minBookDepthConsumed: 3,
        minTouchPolls: 2,
        useLiveBook: true,
        bookPollMs: 1000,
        quotingEnabled: true,
        longOpenMinMid: 0.5,
        noOpenMinutes: 4,
        hardFlatMinutes: 2,
      }),
    )
    expect(portfolio.syncMarketUniverse).toHaveBeenCalled()
    const syncArg = (portfolio.syncMarketUniverse as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Crypto15mMarket[]
    expect(syncArg.length).toBeGreaterThanOrEqual(2)
    expect(portfolio.start).toHaveBeenCalled()
    expect(store.getState().status).toBe('running')
    expect(store.getState().activeBooks).toBe(2)
    expect(store.getState().books).toHaveLength(2)
    expect(store.getState().quoteBook).toBeNull()
    expect(store.getState().cash).toBe(MM_SESSION_STARTING_CASH)

    const fill: MmFill = {
      id: 'f1',
      t: 2_222,
      side: 'buy_yes',
      price: 0.5,
      size: 1,
      midAtFill: 0.5,
      toxic: false,
      reason: 'book_depth',
      feeDollars: 0,
      taker: false,
    }
    portfolio._state = {
      ...portfolio._state,
      aggregate: emptyAgg({
        cash: 97,
        inventoryNet: 2,
        realizedSpreadPnl: 0.8,
        unrealizedInventoryPnl: 0.2,
        feesPaid: 0,
        fillCount: 3,
        activeBooks: 2,
      }),
      sessionFills: [fill],
      message: 'ok',
    }
    portfolio._emit()

    expect(store.getState()).toMatchObject({
      cash: 97,
      inventory: 2,
      realizedPnl: 0.8,
      unrealizedPnl: 0.2,
      fillsCount: 3,
      lastFillAt: 2_222,
      activeBooks: 2,
      quoteBook: null,
    })
    // Family E armed on Start — no U3.0 pause strip
    expect(store.getState().updateError?.code).not.toBe('U3.0')

    runner.stop()
    expect(portfolio.stop).toHaveBeenCalled()
    expect(store.getState().status).toBe('stopped')
    expect(store.getState().cash).toBe(97)
    expect(store.getState().activeBooks).toBe(2)

    runner.reset()
    expect(portfolio.resetSession).toHaveBeenCalled()
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
      quoteBook: null,
      activeBooks: 0,
      books: [],
      updateError: null,
    })
  })

  it('Start without ticker still runs multi when feed has markets', () => {
    const { store, portfolio, runner } = pair()
    runner.start(null)
    expect(portfolio.start).toHaveBeenCalled()
    expect(store.getState().status).toBe('running')
    expect(store.getState().activeBooks).toBe(2)
  })

  it('empty feed → U2.4 error and stays idle', () => {
    const store = createMmSessionStore()
    const portfolio = makeStubPortfolio()
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
      portfolio,
      getFeed: () => emptyFeed,
    })
    runners.push(runner)

    runner.start(null)
    expect(portfolio.start).not.toHaveBeenCalled()
    expect(store.getState().status).toBe('idle')
    expect(store.getState().updateError).toEqual({
      code: 'U2.4',
      message: 'no markets in feed',
      dependency: 'continuous feed / mm-proxy :8787',
    })
  })

  it('surfaces U2.4 under-fill when Family E quoting is enabled', () => {
    const { store, portfolio, runner, markets } = pair()
    runner.start(markets[0]!.ticker)
    portfolio._state = {
      ...portfolio._state,
      running: true,
      config: { ...portfolio._state.config, quotingEnabled: true },
      message:
        'Multi-book under-filled (0/5) — retrying fill from 2 open ranked. Read-only · never places trades.',
      aggregate: emptyAgg({ activeBooks: 0 }),
    }
    portfolio._emit()
    expect(store.getState().updateError?.code).toBe('U2.4')
    expect(store.getState().updateError?.message).toMatch(/under-filled/)
  })

  it('surfaces U3.0 pause when quotingEnabled forced false', () => {
    const { store, portfolio, runner, markets } = pair()
    runner.start(markets[0]!.ticker)
    portfolio._state = {
      ...portfolio._state,
      running: true,
      config: { ...portfolio._state.config, quotingEnabled: false },
      message: 'U3.0: paper quoting paused — needs new quote logic',
      aggregate: emptyAgg({ activeBooks: 2 }),
    }
    portfolio._emit()
    expect(store.getState().updateError?.code).toBe('U3.0')
  })

  it('U2.5: portfolio with 2 book stubs → store.books mapped; reset → []', () => {
    const { store, portfolio, runner, markets } = pair()
    runner.start(markets[0]!.ticker)
    expect(store.getState().books).toHaveLength(2)

    portfolio._state = {
      ...portfolio._state,
      books: [
        {
          slotId: 'slot-1',
          snapshot: baseSnap({
            marketTicker: 'KX-BTC-1',
            asset: 'BTC',
            inventory: 3,
            realizedSpreadPnl: 0.4,
            unrealizedInventoryPnl: 0.15,
            fillCount: 4,
            liveBook: true,
            midYes: 0.52,
            message: 'ok',
            running: true,
          }),
          fills: [],
          cancels: [],
        },
        {
          slotId: 'slot-2',
          snapshot: baseSnap({
            marketTicker: 'KX-ETH-1',
            asset: 'ETH',
            inventory: -2,
            realizedSpreadPnl: -0.1,
            unrealizedInventoryPnl: 0.05,
            fillCount: 1,
            liveBook: false,
            midYes: 0.47,
            message: 'soft sim',
            running: true,
          }),
          fills: [],
          cancels: [],
        },
        {
          slotId: 'slot-empty',
          snapshot: baseSnap({ marketTicker: null, asset: null }),
          fills: [],
          cancels: [],
        },
      ],
      aggregate: emptyAgg({ activeBooks: 2 }),
      message: 'ok',
    }
    portfolio._emit()

    expect(store.getState().books).toHaveLength(2)
    expect(store.getState().books[0]).toMatchObject({
      slotId: 'slot-1',
      ticker: 'KX-BTC-1',
      asset: 'BTC',
      inventory: 3,
      realizedPnl: 0.4,
      unrealizedPnl: 0.15,
      fillsCount: 4,
      liveBook: true,
      midYes: 0.52,
      message: 'ok',
      quoteBook: 'YES',
    })
    expect(store.getState().books[1]).toMatchObject({
      slotId: 'slot-2',
      ticker: 'KX-ETH-1',
      asset: 'ETH',
      inventory: -2,
      realizedPnl: -0.1,
      unrealizedPnl: 0.05,
      fillsCount: 1,
      liveBook: false,
      midYes: 0.47,
      message: 'soft sim',
      quoteBook: 'YES',
    })

    runner.reset()
    expect(store.getState().books).toEqual([])
  })
})
