/**
 * Engine fill discipline + inventory unwind requote (paper only).
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { PaperMmEngine } from './engine'
import type { OrderBookSnapshot } from './orderbook'

function mkMarket(partial: Partial<Crypto15mMarket> & { ticker: string }): Crypto15mMarket {
  return {
    eventTicker: partial.ticker,
    seriesTicker: 'KXHYPE15M',
    asset: partial.asset ?? 'HYPE',
    title: 'HYPE price up in next 15 mins?',
    status: 'active',
    openTime: new Date(Date.now() - 5 * 60_000).toISOString(),
    closeTime: new Date(Date.now() + 10 * 60_000).toISOString(),
    yesBid: partial.yesBid ?? 0.45,
    yesAsk: partial.yesAsk ?? 0.55,
    noBid: 0.45,
    noAsk: 0.55,
    midYes: partial.midYes ?? 0.5,
    spreadCents: 2,
    last: 0.5,
    volume: 0,
    volume24h: 0,
    openInterest: 0,
    yesBidSize: 20,
    yesAskSize: 20,
    floorStrike: partial.floorStrike ?? 20,
    rulesPrimary: 'YES if price up vs floor_strike.',
    kalshiUrl: '',
    windowMinutes: 15,
    minutesElapsed: 5,
    minutesRemaining: 10,
    feeEstimate1: 0,
    thinBook: false,
    raw: {} as Crypto15mMarket['raw'],
    ...partial,
  }
}

function book(ticker: string, mid = 0.5): OrderBookSnapshot {
  return {
    ticker,
    t: Date.now(),
    yesBids: [{ price: mid - 0.02, size: 50 }],
    yesAsks: [{ price: mid + 0.02, size: 50 }],
    bestBid: mid - 0.02,
    bestAsk: mid + 0.02,
    mid,
    authenticated: false,
  }
}

describe('engine inventory unwind + fill discipline', () => {
  let engine: PaperMmEngine

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    engine = new PaperMmEngine()
    engine.setConfig({
      fillCooldownMs: 0,
      maxInventory: 10,
      unwindThreshold: 1,
      quoteSize: 2,
      halfSpreadCents: 2,
      useLiveBook: true,
      strictRealism: true,
      fvQuoting: true,
      minEdgeCents: 2.5,
      maxSaneEdgeCents: 25,
      toxicMidLow: 0.05,
      toxicMidHigh: 0.95,
    })
  })

  afterEach(() => {
    engine.stop()
    vi.unstubAllGlobals()
  })

  it('long at max + FV≫mid → quotes still OFF under U3.0 pause', () => {
    const market = mkMarket({
      ticker: 'KXHYPE15M-UNWIND',
      midYes: 0.4,
      yesBid: 0.38,
      yesAsk: 0.42,
      floorStrike: 20,
    })
    engine.setMarket(market)
    engine.seedSpot(40)
    engine.seedInventory(10, 0.4)
    engine.start()
    engine.onBook(book(market.ticker, 0.4))

    const snap = engine.getState().snapshot
    const q = snap.quote
    expect(q).not.toBeNull()
    expect(q!.askActive).toBe(false)
    expect(q!.bidActive).toBe(false)
    expect(q!.active).toBe(false)
    expect(snap.message).toMatch(/U3\.0.*paused/)
  })

  it('cannot applyFill buy_yes when inventory >= maxInventory / unwind blocks adds', () => {
    const market = mkMarket({ ticker: 'KXHYPE15M-BLOCK', midYes: 0.5 })
    engine.setMarket(market)
    engine.seedSpot(20)
    engine.seedInventory(10, 0.5)
    engine.start()

    const eng = engine as unknown as {
      applyFill: (
        side: 'buy_yes' | 'sell_yes',
        price: number,
        size: number,
        mid: number,
        toxic: boolean,
        reason: string,
        taker: boolean,
      ) => void
    }
    const fillsBefore = engine.getState().fills.length
    eng.applyFill('buy_yes', 0.5, 1, 0.5, false, 'book_depth', false)
    expect(engine.getState().snapshot.inventory).toBe(10)
    expect(engine.getState().fills.length).toBe(fillsBefore)
    expect(engine.getState().snapshot.message.toLowerCase()).toMatch(/inv block|u3\.0.*paused/)

    // Reducing sell is still allowed
    eng.applyFill('sell_yes', 0.52, 1, 0.5, false, 'book_depth', false)
    expect(engine.getState().snapshot.inventory).toBe(9)
  })
})


describe('measurement: fill scenarioId stamp + stuckTicks', () => {
  let engine: PaperMmEngine

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    engine = new PaperMmEngine()
    engine.setConfig({
      fillCooldownMs: 0,
      maxInventory: 10,
      unwindThreshold: 1,
      quoteSize: 1,
      halfSpreadCents: 2,
      useLiveBook: true,
      strictRealism: true,
      fvQuoting: true,
      minEdgeCents: 2.5,
      maxSaneEdgeCents: 25,
      toxicMidLow: 0.05,
      toxicMidHigh: 0.95,
      minCloseProfitCents: 1,
      minChurnCaptureCents: 1,
      stuckUnwindTicks: 3,
      markBleedCents: 5,
      hardFlatMinutes: 2,
    })
  })

  afterEach(() => {
    engine.stop()
    vi.unstubAllGlobals()
  })

  type ApplyFill = (
    side: 'buy_yes' | 'sell_yes',
    price: number,
    size: number,
    mid: number,
    toxic: boolean,
    reason: string,
    taker: boolean,
  ) => void

  function applyFill(): ApplyFill {
    return (engine as unknown as { applyFill: ApplyFill }).applyFill.bind(engine)
  }

  it('stamps S3 scenarioId on profitable close at fill time (not post-flat quote)', () => {
    const market = mkMarket({
      ticker: 'KXHYPE15M-STAMP-S3',
      midYes: 0.5,
      minutesRemaining: 10,
    })
    engine.setMarket(market)
    engine.seedSpot(20)
    engine.seedInventory(1, 0.4) // long @ 40¢
    engine.start()

    const fill = applyFill()
    const before = engine.getState().fills.length
    // sell @ 0.45 → +5¢ capture ≥ 1¢ → S3
    fill('sell_yes', 0.45, 1, 0.5, false, 'book_depth', false)
    const fills = engine.getState().fills
    expect(fills.length).toBe(before + 1)
    const last = fills[fills.length - 1]!
    expect(last.scenarioId).toBe('S3')
    expect(last.captureDollars).toBeCloseTo(0.05, 5)
    // Flat after close — quote may be S5; fill stamp must remain S3
    expect(engine.getState().snapshot.inventory).toBe(0)
  })

  it('stamps S4.2 on lossy stuck flatten and exposes stuckTicks on snapshot', () => {
    const market = mkMarket({
      ticker: 'KXHYPE15M-STAMP-S42',
      midYes: 0.5,
      minutesRemaining: 10,
    })
    engine.setMarket(market)
    engine.seedSpot(20)
    engine.seedInventory(1, 0.5) // long @ 50¢
    engine.start()

    // Drive stuck counter via requotes with a blocked reduce path.
    // Seed stuck state by private field so we do not depend on tick timing.
    const engAny = engine as unknown as {
      stuckUnwindState: { ticks: number; invSign: number }
    }
    engAny.stuckUnwindState = { ticks: 10, invSign: 1 }
    expect(engine.getState().snapshot.stuckTicks).toBe(10)

    const fill = applyFill()
    const before = engine.getState().fills.length
    // sell @ 0.44 → −6¢ ≤ −5¢ markBleed with stuck → S4.2
    fill('sell_yes', 0.44, 1, 0.5, false, 'book_depth', false)
    const fills = engine.getState().fills
    expect(fills.length).toBe(before + 1)
    const last = fills[fills.length - 1]!
    expect(last.scenarioId).toBe('S4.2')
    expect(last.captureDollars).toBeCloseTo(-0.06, 5)
  })

  it('stamps open fill scenarioId from authorizing quote side', () => {
    const market = mkMarket({
      ticker: 'KXHYPE15M-STAMP-S1',
      midYes: 0.5,
      minutesRemaining: 10,
    })
    engine.setMarket(market)
    engine.seedSpot(20)
    engine.seedInventory(0, null)
    engine.start()
    engine.onBook(book(market.ticker, 0.5))
    const q = engine.getState().snapshot.quote
    expect(q).not.toBeNull()
    // Force the authorizing open scenario onto the resting quote (measurement stamp path).
    const engAny = engine as unknown as { quote: NonNullable<typeof q> }
    engAny.quote = {
      ...q!,
      bidActive: true,
      active: true,
      bidScenario: 'S1',
      bidReason: 'bid ON: test fixture',
    }

    const fill = applyFill()
    const before = engine.getState().fills.length
    fill('buy_yes', 0.48, 1, 0.5, false, 'book_depth', false)
    const fills = engine.getState().fills
    expect(fills.length).toBe(before + 1)
    expect(fills[fills.length - 1]!.scenarioId).toBe('S1')
  })
})
