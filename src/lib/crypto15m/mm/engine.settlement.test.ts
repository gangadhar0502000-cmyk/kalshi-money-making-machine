/**
 * Settlement marking + maker-only fee path under strictRealism.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { estimateFillFeeDollars } from '../fees'
import { PaperMmEngine } from './engine'
import type { OrderBookSnapshot } from './orderbook'

function mkMarket(partial: Partial<Crypto15mMarket> & { ticker: string }): Crypto15mMarket {
  return {
    eventTicker: partial.ticker,
    seriesTicker: `KX${(partial.asset ?? 'BTC')}15M`,
    asset: partial.asset ?? 'BTC',
    title: 'test',
    status: partial.status ?? 'active',
    openTime: partial.openTime ?? new Date(Date.now() - 5 * 60_000).toISOString(),
    closeTime: partial.closeTime ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    yesBid: partial.yesBid ?? 0.48,
    yesAsk: partial.yesAsk ?? 0.52,
    noBid: 0.48,
    noAsk: 0.52,
    midYes: partial.midYes ?? 0.5,
    spreadCents: 4,
    last: 0.5,
    volume: 0,
    volume24h: 0,
    openInterest: 0,
    yesBidSize: 10,
    yesAskSize: 10,
    floorStrike: partial.floorStrike ?? 100_000,
    rulesPrimary: '',
    kalshiUrl: '',
    windowMinutes: 15,
    minutesElapsed: 5,
    minutesRemaining: partial.minutesRemaining ?? 10,
    feeEstimate1: 0,
    thinBook: false,
    raw: (partial.raw ?? {}) as Crypto15mMarket['raw'],
    ...partial,
  }
}

function book(ticker: string, bestBid = 0.48, bestAsk = 0.52): OrderBookSnapshot {
  const mid = (bestBid + bestAsk) / 2
  return {
    ticker,
    t: Date.now(),
    yesBids: [{ price: bestBid, size: 40 }],
    yesAsks: [{ price: bestAsk, size: 40 }],
    bestBid,
    bestAsk,
    mid,
    authenticated: false,
  }
}

describe('settlement marking fail-closed', () => {
  let engine: PaperMmEngine

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    engine = new PaperMmEngine()
    engine.setConfig({
      strictRealism: true,
      applyFees: true,
      useLiveBook: true,
      settleOnClose: true,
      autoRoll: false,
      fillCooldownMs: 0,
      quoteSize: 1,
      maxInventory: 10,
    })
  })

  afterEach(() => {
    engine.stop()
    vi.unstubAllGlobals()
  })

  it('without official result, marks inventory to mid — not invented YES=1 from mid≥0.5', () => {
    const market = mkMarket({
      ticker: 'KXBTC15M-SETTLE',
      midYes: 0.62,
      minutesRemaining: 0,
      status: 'closed',
    })
    engine.setMarket(market)
    engine.seedInventory(2, 0.5)
    engine.settleNow()
    const st = engine.getState()
    // Mark-to-mid: (0.62 - 0.5) * 2 = 0.24 — NOT (1 - 0.5) * 2 = 1.00
    expect(st.snapshot.realizedSpreadPnl).toBeCloseTo(0.24, 5)
    expect(st.snapshot.message).toMatch(/mid \$0\.6200/)
    expect(st.snapshot.message).toMatch(/no official result/)
  })

  it('official result=yes settles at binary 1', () => {
    const market = mkMarket({
      ticker: 'KXBTC15M-YES',
      midYes: 0.55,
      minutesRemaining: 0,
      status: 'settled',
      raw: { result: 'yes' } as Crypto15mMarket['raw'],
    })
    engine.setMarket(market)
    engine.seedInventory(1, 0.4)
    engine.settleNow()
    const st = engine.getState()
    expect(st.snapshot.realizedSpreadPnl).toBeCloseTo(0.6, 5)
    expect(st.snapshot.message).toMatch(/YES=1/)
  })

  it('official result=no settles at binary 0', () => {
    const market = mkMarket({
      ticker: 'KXBTC15M-NO',
      midYes: 0.4,
      minutesRemaining: 0,
      status: 'settled',
      raw: { result: 'no' } as Crypto15mMarket['raw'],
    })
    engine.setMarket(market)
    engine.seedInventory(1, 0.4)
    engine.settleNow()
    const st = engine.getState()
    expect(st.snapshot.realizedSpreadPnl).toBeCloseTo(-0.4, 5)
    expect(st.snapshot.message).toMatch(/YES=0/)
  })
})

describe('strictRealism maker-only · no taker fees', () => {
  let engine: PaperMmEngine

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    engine = new PaperMmEngine()
    engine.setConfig({
      strictRealism: true,
      applyFees: true,
      useLiveBook: true,
      fillCooldownMs: 0,
      quoteSize: 1,
      maxInventory: 10,
      halfSpreadCents: 2,
      fvQuoting: false,
      minEdgeCents: 0,
    })
  })

  afterEach(() => {
    engine.stop()
    vi.unstubAllGlobals()
  })

  it('crossing FV quotes under strictRealism accrue $0 taker fees', () => {
    const market = mkMarket({
      ticker: 'KXBTC15M-MAKER',
      midYes: 0.5,
      floorStrike: 100_000,
    })
    engine.setMarket(market)
    engine.seedSpot(102_000)
    engine.start()

    let fees = 0
    let takerFills = 0
    for (let i = 0; i < 50; i++) {
      engine.onBook(book(market.ticker, 0.48, 0.52))
      const st = engine.getState()
      fees = st.snapshot.feesPaid
      takerFills = st.fills.filter((f) => f.taker).length
    }
    expect(takerFills).toBe(0)
    expect(fees).toBe(0)
    expect(estimateFillFeeDollars(1, 0.5, { taker: false, applyFees: true })).toBe(0)
    expect(estimateFillFeeDollars(1, 0.5, { taker: true, applyFees: true })).toBeGreaterThan(0)
  })

  it('P&L units stay in dollars (0–1 price space)', () => {
    const market = mkMarket({ ticker: 'KXBTC15M-UNITS', midYes: 0.5 })
    engine.setMarket(market)
    engine.start()
    engine.onBook(book(market.ticker))
    const st = engine.getState()
    expect(Math.abs(st.snapshot.unrealizedInventoryPnl)).toBeLessThan(50)
    expect(st.snapshot.unitsWarning).toBeNull()
  })
})
