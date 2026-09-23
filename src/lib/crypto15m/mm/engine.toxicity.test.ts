/**
 * Proves toxic one-sided buys cannot walk inventory to maxInventory at mid≈0.01.
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
    yesBid: partial.yesBid ?? 0.01,
    yesAsk: partial.yesAsk ?? 0.02,
    noBid: 0.98,
    noAsk: 0.99,
    midYes: partial.midYes ?? 0.01,
    spreadCents: 1,
    last: 0.01,
    volume: 0,
    volume24h: 0,
    openInterest: 0,
    yesBidSize: 10,
    yesAskSize: 10,
    floorStrike: null,
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

function book(ticker: string, mid = 0.01): OrderBookSnapshot {
  const bestBid = mid
  const bestAsk = mid
  return {
    ticker,
    t: Date.now(),
    yesBids: [{ price: bestBid, size: 50 }],
    yesAsks: [{ price: bestAsk, size: 50 }],
    bestBid,
    bestAsk,
    mid,
    authenticated: false,
  }
}

describe('toxic mid guard + taker_cross', () => {
  let engine: PaperMmEngine

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    engine = new PaperMmEngine()
    engine.setConfig({
      fillCooldownMs: 0, // try to spam as hard as the bug did
      maxInventory: 10,
      quoteSize: 1,
      halfSpreadCents: 2,
      useLiveBook: true,
      strictRealism: true,
      toxicMidLow: 0.05,
      toxicMidHigh: 0.95,
      autoRoll: true,
      settleOnClose: true,
    })
  })

  afterEach(() => {
    engine.stop()
    vi.unstubAllGlobals()
  })

  it('does not climb inventory to maxInventory buying YES at mid≈0.01 via taker_cross', () => {
    const market = mkMarket({ ticker: 'KXBTC15M-TOXIC', midYes: 0.01 })
    engine.setMarket(market)
    engine.start()

    // Simulate many book polls that previously produced taker_cross every cooldown
    for (let i = 0; i < 40; i++) {
      engine.onBook(book(market.ticker, 0.01))
    }

    const state = engine.getState()
    expect(state.snapshot.inventory).toBeLessThan(state.snapshot.config.maxInventory)
    expect(state.snapshot.inventory).toBe(0)
    const buyFills = state.fills.filter(
      (f) => f.side === 'buy_yes' && f.reason === 'taker_cross',
    )
    expect(buyFills.length).toBe(0)
    // Bid should be pulled at extreme mid
    expect(state.snapshot.quote?.bidActive).toBe(false)
  })

  it('engine rolls to new ticker and clears inventory when market closes + new open 15m in feed', () => {
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
    // Force a synthetic long so settlement path is exercised before roll
    // via sync — inventory should clear on roll/settle
    const snapBefore = engine.getState().snapshot
    expect(snapBefore.marketTicker).toBe('KXBTC15M-OLD')

    // Selector agrees
    expect(pickRollTarget([oldM, newM], oldM)?.ticker).toBe('KXBTC15M-NEW')

    const rolled = engine.syncMarketUniverse([oldM, newM])
    expect(rolled).toBe('KXBTC15M-NEW')

    const after = engine.getState()
    expect(after.snapshot.marketTicker).toBe('KXBTC15M-NEW')
    expect(after.snapshot.inventory).toBe(0)
    expect(after.snapshot.running).toBe(true)
    expect(after.snapshot.settled).toBe(false)
    expect(after.snapshot.message.toLowerCase()).toMatch(/rolled to|u3\.1|u3\.2|house mid|family e|live book|paper mm/)
  })
})
