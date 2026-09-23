/**
 * U3.1.2 — blackout flatten when inventory (not park-both).
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { PaperMmEngine } from './engine'
import { U31_BLACKOUT, U312_BLACKOUT_FLATTEN } from './decisionPolicy'
import { STRICT_PAPER_MM_CONFIG } from './config'
import type { OrderBookSnapshot } from './orderbook'

function mkMarket(
  ticker = 'KXBTC15M-U312',
  mins = 0.5,
  midYes = 0.5,
): Crypto15mMarket {
  return {
    eventTicker: ticker,
    seriesTicker: 'KXBTC15M',
    asset: 'BTC',
    title: 'BTC 15m',
    status: 'active',
    openTime: new Date(Date.now() - 5 * 60_000).toISOString(),
    closeTime: new Date(Date.now() + mins * 60_000).toISOString(),
    yesBid: Math.max(0.01, midYes - 0.02),
    yesAsk: Math.min(0.99, midYes + 0.02),
    noBid: Math.max(0.01, 1 - midYes - 0.02),
    noAsk: Math.min(0.99, 1 - midYes + 0.02),
    midYes,
    spreadCents: 4,
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
    yesBids: [{ price: Math.max(0.01, mid - 0.02), size: 50 }],
    yesAsks: [{ price: Math.min(0.99, mid + 0.02), size: 50 }],
    bestBid: Math.max(0.01, mid - 0.02),
    bestAsk: Math.min(0.99, mid + 0.02),
    mid,
    authenticated: false,
  }
}

describe('engine U3.1.2 blackout flatten', () => {
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

  it('blackout + flat → both OFF + U31_BLACKOUT', () => {
    const market = mkMarket('KXBTC15M-U312-FLAT', 0.5, 0.5)
    engine.setMarket(market)
    engine.seedSpot(100_000)
    engine.start()
    engine.onBook(bookAt(market.ticker, 0.5))
    const s = engine.getState().snapshot
    expect(s.quote?.bidActive).toBe(false)
    expect(s.quote?.askActive).toBe(false)
    expect(s.message).toBe(U31_BLACKOUT)
  })

  it('blackout + long → ask only, strip U3.1.2', () => {
    const market = mkMarket('KXBTC15M-U312-LONG', 0.5, 0.5)
    engine.setMarket(market)
    engine.seedSpot(100_000)
    engine.seedInventory(1, 0.5)
    engine.start()
    engine.onBook(bookAt(market.ticker, 0.5))
    const s = engine.getState().snapshot
    expect(s.inventory).toBe(1)
    expect(s.quote?.bidActive).toBe(false)
    expect(s.quote?.askActive).toBe(true)
    expect(s.quote?.activeScenario).toBe('blackout_flatten')
    expect(s.message).toBe(U312_BLACKOUT_FLATTEN)
  })

  it('blackout + short → bid only, strip U3.1.2', () => {
    const market = mkMarket('KXBTC15M-U312-SHORT', 0.4, 0.5)
    engine.setMarket(market)
    engine.seedSpot(100_000)
    engine.seedInventory(-1, 0.5)
    engine.start()
    engine.onBook(bookAt(market.ticker, 0.5))
    const s = engine.getState().snapshot
    expect(s.inventory).toBe(-1)
    expect(s.quote?.askActive).toBe(false)
    expect(s.quote?.bidActive).toBe(true)
    expect(s.quote?.activeScenario).toBe('blackout_flatten')
    expect(s.message).toBe(U312_BLACKOUT_FLATTEN)
  })

  it('τ > blackout + hardFlat → flatten tag (not blackout_flatten)', () => {
    const market = mkMarket('KXBTC15M-U312-HF', 1.5, 0.5)
    engine.setMarket(market)
    engine.seedSpot(100_000)
    engine.seedInventory(2, 0.5)
    engine.start()
    engine.onBook(bookAt(market.ticker, 0.5))
    const s = engine.getState().snapshot
    expect(s.quote?.bidActive).toBe(false)
    expect(s.quote?.askActive).toBe(true)
    expect(s.quote?.activeScenario).toBe('flatten')
    expect(s.message).toBe('U3.1: flatten — exit only')
  })

  it('U3.1.1 extreme mid still refuses opens; blackout long keeps ask', () => {
    const market = mkMarket('KXBTC15M-U312-XM', 0.5, 0.99)
    engine.setMarket(market)
    engine.seedSpot(100_200)
    engine.seedInventory(1, 0.5)
    engine.start()
    engine.onBook(bookAt(market.ticker, 0.99))
    const s = engine.getState().snapshot
    expect(s.quote?.bidActive).toBe(false)
    expect(s.quote?.askActive).toBe(true)
    expect(s.quote?.activeScenario).toBe('blackout_flatten')
  })
})
