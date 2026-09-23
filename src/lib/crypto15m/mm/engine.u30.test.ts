/**
 * U3.0 — paper quoting paused; rebuildQuote yields no active bid/ask.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { PaperMmEngine } from './engine'
import { QUOTING_PAUSED_REASON } from './decisionPolicy'
import { STRICT_PAPER_MM_CONFIG } from './config'
import type { OrderBookSnapshot } from './orderbook'

function mkMarket(ticker = 'KXBTC15M-U30'): Crypto15mMarket {
  return {
    eventTicker: ticker,
    seriesTicker: 'KXBTC15M',
    asset: 'BTC',
    title: 'BTC 15m',
    status: 'active',
    openTime: new Date(Date.now() - 5 * 60_000).toISOString(),
    closeTime: new Date(Date.now() + 10 * 60_000).toISOString(),
    yesBid: 0.48,
    yesAsk: 0.52,
    noBid: 0.48,
    noAsk: 0.52,
    midYes: 0.5,
    spreadCents: 4,
    last: 0.5,
    volume: 0,
    volume24h: 0,
    openInterest: 0,
    yesBidSize: 10,
    yesAskSize: 10,
    floorStrike: 100_000,
    rulesPrimary: '',
    kalshiUrl: '',
    windowMinutes: 15,
    minutesElapsed: 5,
    minutesRemaining: 10,
    feeEstimate1: 0,
    thinBook: false,
    raw: {} as Crypto15mMarket['raw'],
    ticker,
  }
}

function wideBook(ticker: string): OrderBookSnapshot {
  return {
    ticker,
    t: Date.now(),
    yesBids: [{ price: 0.01, size: 50 }],
    yesAsks: [{ price: 0.99, size: 50 }],
    bestBid: 0.01,
    bestAsk: 0.99,
    mid: 0.5,
    authenticated: false,
  }
}

describe('U3.0 quoting paused', () => {
  let engine: PaperMmEngine

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    engine = new PaperMmEngine()
    engine.setConfig({
      ...STRICT_PAPER_MM_CONFIG,
      quotingEnabled: false,
      edgePersistTicks: 1,
      useLiveBook: true,
    })
  })

  afterEach(() => {
    engine.stop()
    vi.unstubAllGlobals()
  })

  it('Start Running → rebuildQuote both sides OFF + U3.0 message', () => {
    const market = mkMarket()
    engine.setMarket(market)
    engine.seedSpot(100_100)
    engine.start()
    engine.onBook(wideBook(market.ticker))

    const s = engine.getState().snapshot
    expect(s.running).toBe(true)
    expect(s.quote).not.toBeNull()
    expect(s.quote!.bidActive).toBe(false)
    expect(s.quote!.askActive).toBe(false)
    expect(s.quote!.active).toBe(false)
    expect(s.message).toBe(QUOTING_PAUSED_REASON)
    expect(s.quote!.bidReason).toMatch(/U3\.0.*paused/)
    expect(STRICT_PAPER_MM_CONFIG.quotingEnabled).toBe(false)
  })
})
