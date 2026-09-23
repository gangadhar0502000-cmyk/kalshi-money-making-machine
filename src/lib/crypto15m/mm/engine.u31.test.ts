/**
 * U3.1/U3.2 — house mid quotes arm when enabled; blackout retained; no-spot no longer parks.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { PaperMmEngine } from './engine'
import { QUOTING_PAUSED_REASON, U31_BLACKOUT } from './decisionPolicy'
import { STRICT_PAPER_MM_CONFIG } from './config'
import type { OrderBookSnapshot } from './orderbook'

function mkMarket(
  ticker = 'KXBTC15M-U31',
  mins = 10,
): Crypto15mMarket {
  return {
    eventTicker: ticker,
    seriesTicker: 'KXBTC15M',
    asset: 'BTC',
    title: 'BTC 15m',
    status: 'active',
    openTime: new Date(Date.now() - 5 * 60_000).toISOString(),
    closeTime: new Date(Date.now() + mins * 60_000).toISOString(),
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
    minutesElapsed: 15 - mins,
    minutesRemaining: mins,
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

describe('U3.2 house mid engine', () => {
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
      blackoutMinutes: 0.75,
      hardFlatMinutes: 2,
    })
  })

  afterEach(() => {
    engine.stop()
    vi.unstubAllGlobals()
  })

  it('Start with spot → quotes can arm (house mid)', () => {
    const market = mkMarket()
    engine.setMarket(market)
    engine.seedSpot(100_100)
    engine.start()
    engine.onBook(wideBook(market.ticker))

    const s = engine.getState().snapshot
    expect(s.running).toBe(true)
    expect(s.quote).not.toBeNull()
    expect(s.fairValue).not.toBeNull()
    expect(s.quote!.active).toBe(true)
    expect(s.quote!.bidActive || s.quote!.askActive).toBe(true)
    expect(s.message).not.toBe(QUOTING_PAUSED_REASON)
    expect(s.quote!.centerMode).toBe('mid')
    expect(s.quote!.activeScenario).toBe('house_mid')
    expect(STRICT_PAPER_MM_CONFIG.quotingEnabled).toBe(true)
  })

  it('no spot → still arms house mid (FV telemetry only)', () => {
    const market = mkMarket()
    engine.setMarket(market)
    // do not seedSpot
    engine.start()
    engine.onBook(wideBook(market.ticker))

    const s = engine.getState().snapshot
    expect(s.quote!.active).toBe(true)
    expect(s.quote!.bidActive || s.quote!.askActive).toBe(true)
    expect(s.quote!.centerMode).toBe('mid')
    expect(s.quote!.activeScenario).toBe('house_mid')
    expect(s.fairValue).toBeNull()
  })

  it('near expiry blackout + flat → both OFF', () => {
    const market = mkMarket('KXBTC15M-BO', 0.4)
    engine.setMarket(market)
    engine.seedSpot(100_000)
    engine.start()
    engine.onBook(wideBook(market.ticker))

    const s = engine.getState().snapshot
    expect(s.quote!.bidActive).toBe(false)
    expect(s.quote!.askActive).toBe(false)
    expect(s.message).toBe(U31_BLACKOUT)
  })

  it('quotingEnabled false still pauses with U3.0', () => {
    engine.setConfig({ quotingEnabled: false })
    const market = mkMarket()
    engine.setMarket(market)
    engine.seedSpot(100_100)
    engine.start()
    engine.onBook(wideBook(market.ticker))
    expect(engine.getState().snapshot.message).toBe(QUOTING_PAUSED_REASON)
  })
})
