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

  it('long at max + FV≫mid → ask ON unwind (not IDLE both sides)', () => {
    const market = mkMarket({
      ticker: 'KXHYPE15M-UNWIND',
      midYes: 0.4,
      yesBid: 0.38,
      yesAsk: 0.42,
      floorStrike: 20,
    })
    engine.setMarket(market)
    // Spot deep ITM vs strike → FV ≫ mid
    engine.seedSpot(40)
    engine.seedInventory(10, 0.4)
    engine.start()
    engine.onBook(book(market.ticker, 0.4))

    const q = engine.getState().snapshot.quote
    expect(q).not.toBeNull()
    expect(q!.askActive).toBe(true)
    expect(q!.askReason.toLowerCase()).toMatch(/unwind/)
    expect(q!.bidActive).toBe(false)
    expect(q!.active).toBe(true)
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
    expect(engine.getState().snapshot.message.toLowerCase()).toMatch(/inv block/)

    // Reducing sell is still allowed
    eng.applyFill('sell_yes', 0.52, 1, 0.5, false, 'book_depth', false)
    expect(engine.getState().snapshot.inventory).toBe(9)
  })
})
