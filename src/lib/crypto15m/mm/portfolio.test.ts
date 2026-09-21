/**
 * Multi-book portfolio controller — cap, roll free-slot, multi-asset FV.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { PaperMmPortfolio } from './portfolio'

function mk(
  partial: Partial<Crypto15mMarket> & Pick<Crypto15mMarket, 'ticker' | 'asset'>,
): Crypto15mMarket {
  return {
    eventTicker: partial.eventTicker ?? partial.ticker,
    seriesTicker: partial.seriesTicker ?? `KX${partial.asset}15M`,
    title: partial.title ?? `${partial.asset} 15m`,
    status: partial.status ?? 'active',
    openTime: partial.openTime ?? new Date(Date.now() - 5 * 60_000).toISOString(),
    closeTime: partial.closeTime ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    yesBid: partial.yesBid ?? 0.4,
    yesAsk: partial.yesAsk ?? 0.6,
    noBid: 0.4,
    noAsk: 0.6,
    midYes: partial.midYes ?? 0.5,
    spreadCents: 2,
    last: 0.5,
    volume: 0,
    volume24h: 0,
    openInterest: 0,
    yesBidSize: 10,
    yesAskSize: 10,
    floorStrike: partial.floorStrike ?? 100,
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

describe('PaperMmPortfolio', () => {
  let portfolio: PaperMmPortfolio

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    portfolio = new PaperMmPortfolio()
    portfolio.setConfig({
      maxActiveMarkets: 3,
      multiBook: true,
      fvQuoting: true,
      minEdgeCents: 2,
      annualVol: 0.7,
      quoteSize: 1,
      maxInventory: 5,
      autoRoll: true,
      useLiveBook: false,
      strictRealism: true,
    })
  })

  afterEach(() => {
    portfolio.stop()
    vi.unstubAllGlobals()
  })

  it('caps concurrent active markets at maxActiveMarkets', () => {
    const markets = ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA'].map((asset) =>
      mk({
        ticker: `${asset}-OPEN`,
        asset,
        midYes: 0.4,
        floorStrike: 100,
        minutesRemaining: 2,
      }),
    )
    for (const a of ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA']) {
      portfolio.seedSpot(a, 120)
    }
    portfolio.syncMarketUniverse(markets)
    portfolio.start()
    const st = portfolio.getState()
    expect(st.aggregate.activeBooks).toBeLessThanOrEqual(3)
    expect(st.aggregate.activeBooks).toBe(3)
    expect(st.books.every((b) => b.snapshot.running)).toBe(true)
  })

  it('ranks and activates higher |edge| before lower', () => {
    const low = mk({
      ticker: 'ETH-FLAT',
      asset: 'ETH',
      midYes: 0.5,
      floorStrike: 3_000,
      minutesRemaining: 10,
    })
    const high = mk({
      ticker: 'BTC-EDGE',
      asset: 'BTC',
      midYes: 0.35,
      floorStrike: 100_000,
      minutesRemaining: 2,
    })
    portfolio.seedSpot('BTC', 102_000)
    portfolio.seedSpot('ETH', 3_000)
    portfolio.setConfig({ maxActiveMarkets: 1 })
    portfolio.syncMarketUniverse([low, high])
    portfolio.start()
    const st = portfolio.getState()
    expect(st.aggregate.activeBooks).toBe(1)
    expect(st.books[0]!.snapshot.marketTicker).toBe('BTC-EDGE')
    expect(st.scan[0]!.ticker).toBe('BTC-EDGE')
  })

  it('different assets get different spots → different FV on books', () => {
    const btc = mk({
      ticker: 'BTC-A',
      asset: 'BTC',
      midYes: 0.5,
      floorStrike: 100_000,
      minutesRemaining: 5,
    })
    const eth = mk({
      ticker: 'ETH-A',
      asset: 'ETH',
      midYes: 0.5,
      floorStrike: 3_000,
      minutesRemaining: 5,
    })
    portfolio.seedSpot('BTC', 102_000)
    portfolio.seedSpot('ETH', 2_900)
    portfolio.setConfig({ maxActiveMarkets: 2 })
    portfolio.syncMarketUniverse([btc, eth])
    portfolio.start()
    const st = portfolio.getState()
    expect(st.books.length).toBe(2)
    const fvs = st.books.map((b) => b.snapshot.fairValue)
    expect(fvs.every((f) => f != null)).toBe(true)
    expect(fvs[0]).not.toBe(fvs[1])
  })

  it('frees slot when book dies with no same-asset roll, then fills next-best', () => {
    const btcDead = mk({
      ticker: 'BTC-DEAD',
      asset: 'BTC',
      status: 'closed',
      closeTime: new Date(Date.now() - 1000).toISOString(),
      minutesRemaining: 0,
      midYes: 0.4,
      floorStrike: 100,
    })
    const eth = mk({
      ticker: 'ETH-LIVE',
      asset: 'ETH',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const sol = mk({
      ticker: 'SOL-LIVE',
      asset: 'SOL',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    portfolio.seedSpot('BTC', 120)
    portfolio.seedSpot('ETH', 120)
    portfolio.seedSpot('SOL', 120)
    portfolio.setConfig({ maxActiveMarkets: 2 })

    // Start with BTC + ETH open
    const btcLive = mk({
      ticker: 'BTC-DEAD',
      asset: 'BTC',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    portfolio.syncMarketUniverse([btcLive, eth])
    portfolio.start()
    expect(portfolio.getState().aggregate.activeBooks).toBe(2)

    // BTC dies, no same-asset successor; SOL available → slot freed then filled with SOL
    portfolio.syncMarketUniverse([btcDead, eth, sol])
    const st = portfolio.getState()
    expect(st.aggregate.activeBooks).toBeLessThanOrEqual(2)
    const tickers = st.books.map((b) => b.snapshot.marketTicker)
    expect(tickers).toContain('ETH-LIVE')
    expect(tickers).not.toContain('BTC-DEAD')
    expect(tickers).toContain('SOL-LIVE')
  })
})
