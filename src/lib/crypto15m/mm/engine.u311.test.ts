/**
 * U3.1.1 — refuse opens at extreme mid; flatten still allowed.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { PaperMmEngine } from './engine'
import { U311_EXTREME_MID, U31_BLACKOUT } from './decisionPolicy'
import { isToxicExtremeMid } from './toxicity'
import { STRICT_PAPER_MM_CONFIG } from './config'
import type { OrderBookSnapshot } from './orderbook'

function mkMarket(
  ticker = 'KXBTC15M-U311',
  mins = 8,
  midYes = 0.99,
): Crypto15mMarket {
  return {
    eventTicker: ticker,
    seriesTicker: 'KXBTC15M',
    asset: 'BTC',
    title: 'BTC 15m',
    status: 'active',
    openTime: new Date(Date.now() - 5 * 60_000).toISOString(),
    closeTime: new Date(Date.now() + mins * 60_000).toISOString(),
    yesBid: Math.max(0.01, midYes - 0.01),
    yesAsk: Math.min(0.99, midYes),
    noBid: Math.max(0.01, 1 - midYes - 0.01),
    noAsk: Math.min(0.99, 1 - midYes + 0.01),
    midYes,
    spreadCents: 1,
    last: midYes,
    volume: 0,
    volume24h: 0,
    openInterest: 0,
    yesBidSize: 10,
    yesAskSize: 10,
    floorStrike: 100_000,
    rulesPrimary: '',
    kalshiUrl: '',
    windowMinutes: 15,
    minutesElapsed: 15 - mins,
    minutesRemaining: mins,
    feeEstimate1: 0,
    thinBook: false,
    raw: {} as Crypto15mMarket['raw'],
    ticker,
  }
}

function bookAt(ticker: string, mid: number): OrderBookSnapshot {
  return {
    ticker,
    t: Date.now(),
    yesBids: [{ price: Math.max(0.01, mid - 0.01), size: 50 }],
    yesAsks: [{ price: Math.min(0.99, mid), size: 50 }],
    bestBid: Math.max(0.01, mid - 0.01),
    bestAsk: Math.min(0.99, mid),
    mid,
    authenticated: false,
  }
}

type ApplyFill = (
  side: 'buy_yes' | 'sell_yes',
  price: number,
  size: number,
  mid: number,
  toxic: boolean,
  reason: string,
  taker: boolean,
) => void

describe('isToxicExtremeMid U3.1.1', () => {
  it('refuses buy open at mid 0.99 and sell open at mid 0.01', () => {
    expect(isToxicExtremeMid('buy_yes', 0.99, 0.05, 0.95, 0)).toBe(true)
    expect(isToxicExtremeMid('sell_yes', 0.01, 0.05, 0.95, 0)).toBe(true)
  })

  it('allows flatten sell when long at high mid; flatten buy when short at low mid', () => {
    expect(isToxicExtremeMid('sell_yes', 0.99, 0.05, 0.95, 2)).toBe(false)
    expect(isToxicExtremeMid('buy_yes', 0.01, 0.05, 0.95, -2)).toBe(false)
  })

  it('still refuses adverse buy at low mid and sell at high mid when opening', () => {
    expect(isToxicExtremeMid('buy_yes', 0.01, 0.05, 0.95, 0)).toBe(true)
    expect(isToxicExtremeMid('sell_yes', 0.99, 0.05, 0.95, 0)).toBe(true)
  })
})

describe('engine U3.1.1 extreme-mid fill refuse', () => {
  let engine: PaperMmEngine

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    engine = new PaperMmEngine()
        engine.setConfig({
      ...STRICT_PAPER_MM_CONFIG,
      quotingEnabled: true,
      edgePersistTicks: 1,
      useLiveBook: true,
      fillCooldownMs: 0,
      maxInventory: 10,
      quoteSize: 1,
      unwindThreshold: 10,
      toxicMidLow: 0.05,
      toxicMidHigh: 0.95,
      blackoutMinutes: 0.75,
      hardFlatMinutes: 2,
      minCloseProfitCents: 0,
    })
  })

  afterEach(() => {
    engine.stop()
    vi.unstubAllGlobals()
  })

  function applyFill(): ApplyFill {
    return (engine as unknown as { applyFill: ApplyFill }).applyFill.bind(engine)
  }

  it('applyFill refuses buy_yes open at mid 0.99', () => {
    const market = mkMarket('KXBTC15M-U311-BUY', 8, 0.99)
    engine.setMarket(market)
    engine.seedSpot(100_100)
    engine.start()
    engine.onBook(bookAt(market.ticker, 0.99))

    expect(engine.getState().snapshot.inventory).toBe(0)
    applyFill()('buy_yes', 0.98, 1, 0.99, false, 'book_depth', false)
    const after = engine.getState()
    expect(after.snapshot.inventory).toBe(0)
    expect(after.fills.filter((f) => f.side === 'buy_yes').length).toBe(0)
    expect(after.snapshot.message).toMatch(/U3\.1\.1|TOXIC SKIP|extreme mid/i)
  })

  it('applyFill refuses sell_yes open at mid 0.01', () => {
    const market = mkMarket('KXBTC15M-U311-SELL', 8, 0.01)
    engine.setMarket(market)
    engine.seedSpot(99_900)
    engine.start()
    engine.onBook(bookAt(market.ticker, 0.01))

    applyFill()('sell_yes', 0.02, 1, 0.01, false, 'book_depth', false)
    const after = engine.getState()
    expect(after.snapshot.inventory).toBe(0)
    expect(after.fills.filter((f) => f.side === 'sell_yes').length).toBe(0)
  })

  it('applyFill allows flatten sell_yes when long at mid 0.99', () => {
    const market = mkMarket('KXBTC15M-U311-FLAT', 8, 0.99)
    engine.setMarket(market)
    engine.seedSpot(100_100)
    engine.seedInventory(2, 0.5)
    engine.start()
    engine.onBook(bookAt(market.ticker, 0.99))

    expect(engine.getState().snapshot.inventory).toBe(2)
    applyFill()('sell_yes', 0.99, 1, 0.99, false, 'book_depth', false)
    const after = engine.getState()
    expect(after.snapshot.inventory).toBe(1)
    expect(after.fills.some((f) => f.side === 'sell_yes')).toBe(true)
  })

  it('quote path parks flat book at pinned 100¢ mid', () => {
    const market = mkMarket('KXBTC15M-U311-PARK', 5, 1.0)
    engine.setMarket(market)
    engine.seedSpot(100_200)
    engine.start()
    engine.onBook(bookAt(market.ticker, 0.99))

    const s = engine.getState().snapshot
    expect(s.quote?.bidActive).toBe(false)
    expect(s.quote?.askActive).toBe(false)
    expect(s.message).toBe(U311_EXTREME_MID)
  })

  it('blackout + flat still parks both', () => {
    const market = mkMarket('KXBTC15M-U311-BO', 0.5, 0.5)
    engine.setMarket(market)
    engine.seedSpot(100_000)
    engine.start()
    engine.onBook(bookAt(market.ticker, 0.5))
    const s = engine.getState().snapshot
    expect(s.quote?.bidActive).toBe(false)
    expect(s.quote?.askActive).toBe(false)
    expect(s.message).toBe(U31_BLACKOUT)
  })
})
