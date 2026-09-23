/**
 * FV-centered quoting + edge gates for paper MM.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { PaperMmEngine } from './engine'
import type { OrderBookSnapshot } from './orderbook'
import { pickRollTarget } from './marketSelect'

function mkMarket(partial: Partial<Crypto15mMarket> & { ticker: string }): Crypto15mMarket {
  return {
    eventTicker: partial.ticker,
    seriesTicker: 'KXBTC15M',
    asset: partial.asset ?? 'BTC',
    title: 'BTC 15m',
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
    raw: {} as Crypto15mMarket['raw'],
    ...partial,
  }
}

/** Wide BBO so FV-centered quotes never taker-cross during gate tests. */
function wideBook(ticker: string, mid = 0.5): OrderBookSnapshot {
  return {
    ticker,
    t: Date.now(),
    yesBids: [{ price: 0.01, size: 50 }],
    yesAsks: [{ price: 0.99, size: 50 }],
    bestBid: 0.01,
    bestAsk: 0.99,
    mid,
    authenticated: false,
  }
}

function book(ticker: string, mid = 0.5): OrderBookSnapshot {
  return {
    ticker,
    t: Date.now(),
    yesBids: [{ price: Math.max(0.01, mid - 0.01), size: 50 }],
    yesAsks: [{ price: Math.min(0.99, mid + 0.01), size: 50 }],
    bestBid: Math.max(0.01, mid - 0.01),
    bestAsk: Math.min(0.99, mid + 0.01),
    mid,
    authenticated: false,
  }
}

describe('FV quoting + edge gates', () => {
  let engine: PaperMmEngine

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    engine = new PaperMmEngine()
    engine.setConfig({
      fillCooldownMs: 60_000,
      maxInventory: 10,
      unwindThreshold: 1,
      quoteSize: 1,
      halfSpreadCents: 2,
      useLiveBook: true,
      strictRealism: true,
      toxicMidLow: 0.05,
      toxicMidHigh: 0.95,
      autoRoll: true,
      settleOnClose: true,
      fvQuoting: true,
      minEdgeCents: 3,
      edgePersistTicks: 1,
      maxSaneEdgeCents: 25,
      annualVol: 0.7,
    })
  })

  afterEach(() => {
    engine.stop()
    vi.unstubAllGlobals()
  })

  it('when FV ≫ mid, bid may be ON and ask is gated off', () => {
    const market = mkMarket({
      ticker: 'KXBTC15M-FVHI',
      midYes: 0.48,
      yesBid: 0.46,
      yesAsk: 0.5,
      floorStrike: 100_000,
      minutesRemaining: 12,
    })
    engine.setMarket(market)
    engine.start()
    engine.seedSpot(100_150)
    engine.onBook(wideBook(market.ticker, 0.48))
    // Ensure flat — no accidental inventory from prior fill paths
    engine.seedInventory(0)

    const s = engine.getState().snapshot
    expect(s.fairValue).not.toBeNull()
    expect(s.fairValue!).toBeGreaterThan(0.5)
    expect(s.edgeVsMidCents!).toBeGreaterThanOrEqual(3)
    expect(s.edgeVsMidCents!).toBeLessThanOrEqual(25)
    expect(s.inventory).toBe(0)
    // U3.0: quotes never arm (scenario playbook removed)
    expect(s.quote?.bidActive).toBe(false)
    expect(s.quote?.askActive).toBe(false)
    expect(s.quote?.bidReason).toMatch(/U3\.0.*paused/)
    expect(s.message).toMatch(/U3\.0.*paused/)
  })

  it('when FV ≪ mid, ask may be ON and bid is gated off', () => {
    const market = mkMarket({
      ticker: 'KXBTC15M-FVLO',
      midYes: 0.52,
      yesBid: 0.5,
      yesAsk: 0.54,
      floorStrike: 100_000,
      minutesRemaining: 12,
    })
    engine.setMarket(market)
    engine.start()
    engine.seedSpot(99_900)
    engine.onBook(wideBook(market.ticker, 0.52))
    engine.seedInventory(0)

    const s = engine.getState().snapshot
    expect(s.fairValue).not.toBeNull()
    expect(s.fairValue!).toBeLessThan(0.5)
    expect(s.edgeVsMidCents!).toBeLessThanOrEqual(-3)
    expect(s.edgeVsMidCents!).toBeGreaterThanOrEqual(-25)
    expect(s.inventory).toBe(0)
    expect(s.quote?.askActive).toBe(false)
    expect(s.quote?.bidActive).toBe(false)
    expect(s.quote?.askReason).toMatch(/U3\.0.*paused/)
  })

  it('when |FV − mid| < minEdge both sides off', () => {
    const market = mkMarket({
      ticker: 'KXBTC15M-FVFLAT',
      midYes: 0.5,
      floorStrike: 100_000,
      minutesRemaining: 10,
    })
    engine.setMarket(market)
    engine.start()
    engine.seedSpot(100_000)
    engine.onBook(wideBook(market.ticker, 0.5))
    engine.seedInventory(0)

    const s = engine.getState().snapshot
    expect(s.fairValue).not.toBeNull()
    expect(Math.abs(s.edgeVsMidCents!)).toBeLessThan(3)
    expect(s.quote?.bidActive).toBe(false)
    expect(s.quote?.askActive).toBe(false)
    expect(s.quote?.bidReason).toMatch(/U3\.0.*paused/)
  })

  it('toxic mid still refuses buy-YES spam at mid≈0.01', () => {
    const market = mkMarket({
      ticker: 'KXBTC15M-TOXIC2',
      midYes: 0.01,
      yesBid: 0.01,
      yesAsk: 0.02,
      floorStrike: 100_000,
      minutesRemaining: 10,
    })
    engine.setConfig({ fillCooldownMs: 0 })
    engine.setMarket(market)
    engine.start()
    engine.seedSpot(100_000)

    for (let i = 0; i < 40; i++) {
      engine.onBook(book(market.ticker, 0.01))
    }

    const state = engine.getState()
    expect(state.snapshot.inventory).toBe(0)
    expect(state.snapshot.quote?.bidActive).toBe(false)
    expect(state.snapshot.quote?.bidReason).toMatch(/U3\.0.*paused|toxic|no edge|edge sanity/)
  })

  it('auto-roll still works when market closes + new open 15m in feed', () => {
    const now = Date.now()
    const oldM = mkMarket({
      ticker: 'KXBTC15M-OLD',
      asset: 'BTC',
      midYes: 0.5,
      closeTime: new Date(now - 1000).toISOString(),
      minutesRemaining: 0,
      status: 'closed',
    })
    const newM = mkMarket({
      ticker: 'KXBTC15M-NEW',
      asset: 'BTC',
      midYes: 0.48,
      closeTime: new Date(now + 15 * 60_000).toISOString(),
      minutesRemaining: 15,
      status: 'active',
    })

    engine.setMarket(oldM)
    engine.start()
    expect(engine.getState().snapshot.marketTicker).toBe('KXBTC15M-OLD')
    expect(pickRollTarget([oldM, newM], oldM)?.ticker).toBe('KXBTC15M-NEW')

    const rolled = engine.syncMarketUniverse([oldM, newM])
    expect(rolled).toBe('KXBTC15M-NEW')
    const after = engine.getState()
    expect(after.snapshot.marketTicker).toBe('KXBTC15M-NEW')
    expect(after.snapshot.inventory).toBe(0)
    expect(after.snapshot.running).toBe(true)
    expect(after.snapshot.settled).toBe(false)
    expect(after.snapshot.marketTicker).toBe(newM.ticker)
    // U3.0 pause strip may replace roll wording; roll still happened
    expect(after.snapshot.message.toLowerCase()).toMatch(/roll|u3\.0.*paused/)
  })
})
