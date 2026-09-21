/**
 * Multi-book portfolio controller — cap, roll, empty-feed hold, session P&L.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { PaperMmPortfolio } from './portfolio'
import type { MmFill } from './types'

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

function mkFill(id: string): MmFill {
  return {
    id,
    t: Date.now(),
    side: 'buy_yes',
    price: 0.45,
    size: 1,
    midAtFill: 0.5,
    toxic: false,
    reason: 'random',
    feeDollars: 0.01,
    taker: false,
  }
}

describe('PaperMmPortfolio', () => {
  let portfolio: PaperMmPortfolio

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    portfolio = new PaperMmPortfolio({ skipRestore: true })
    portfolio.setPersistEnabled(false)
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

    portfolio.syncMarketUniverse([btcDead, eth, sol])
    const st = portfolio.getState()
    expect(st.aggregate.activeBooks).toBeLessThanOrEqual(2)
    const tickers = st.books.map((b) => b.snapshot.marketTicker)
    expect(tickers).toContain('ETH-LIVE')
    expect(tickers).not.toContain('BTC-DEAD')
    expect(tickers).toContain('SOL-LIVE')
  })

  it('empty feed does not wipe all books / does not falsely outside top-N release', () => {
    const btc = mk({
      ticker: 'BTC-HOLD',
      asset: 'BTC',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const eth = mk({
      ticker: 'ETH-HOLD',
      asset: 'ETH',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    portfolio.seedSpot('BTC', 120)
    portfolio.seedSpot('ETH', 120)
    portfolio.setConfig({ maxActiveMarkets: 5 })
    portfolio.syncMarketUniverse([btc, eth])
    portfolio.start()
    expect(portfolio.getState().aggregate.activeBooks).toBe(2)

    // Empty feed (stale refresh / rollover gap)
    portfolio.syncMarketUniverse([])
    let st = portfolio.getState()
    expect(st.aggregate.activeBooks).toBe(2)
    expect(st.message).toMatch(/holding|empty|stale/i)
    expect(st.message).not.toMatch(/outside top/i)

    // All-closed stale feed — still hold
    const closed = [
      mk({
        ticker: 'BTC-HOLD',
        asset: 'BTC',
        status: 'closed',
        closeTime: new Date(Date.now() - 60_000).toISOString(),
        minutesRemaining: 0,
        midYes: 0.4,
        floorStrike: 100,
      }),
      mk({
        ticker: 'ETH-HOLD',
        asset: 'ETH',
        status: 'closed',
        closeTime: new Date(Date.now() - 60_000).toISOString(),
        minutesRemaining: 0,
        midYes: 0.4,
        floorStrike: 100,
      }),
    ]
    portfolio.syncMarketUniverse(closed)
    st = portfolio.getState()
    expect(st.aggregate.activeBooks).toBe(2)
    expect(st.scan.length).toBe(0)
    expect(st.message).not.toMatch(/outside top/i)
  })

  it('closed market → new same-asset window attached (roll)', () => {
    const oldWin = mk({
      ticker: 'KXBNB15M-OLD',
      asset: 'BNB',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
      closeTime: new Date(Date.now() + 2 * 60_000).toISOString(),
    })
    portfolio.seedSpot('BNB', 120)
    portfolio.setConfig({ maxActiveMarkets: 1 })
    portfolio.syncMarketUniverse([oldWin])
    portfolio.start()
    expect(portfolio.getState().books[0]!.snapshot.marketTicker).toBe('KXBNB15M-OLD')

    const closedOld = mk({
      ...oldWin,
      status: 'closed',
      minutesRemaining: 0,
      closeTime: new Date(Date.now() - 1000).toISOString(),
    })
    const nextWin = mk({
      ticker: 'KXBNB15M-NEW',
      asset: 'BNB',
      midYes: 0.42,
      floorStrike: 101,
      minutesRemaining: 14,
      closeTime: new Date(Date.now() + 14 * 60_000).toISOString(),
    })
    portfolio.syncMarketUniverse([closedOld, nextWin])
    const st = portfolio.getState()
    expect(st.aggregate.activeBooks).toBe(1)
    expect(st.books[0]!.snapshot.marketTicker).toBe('KXBNB15M-NEW')
    expect(st.message).toMatch(/Rolled.*KXBNB15M-OLD.*KXBNB15M-NEW/i)
  })

  it('settlement / realized P&L retained in aggregate after roll and release', () => {
    const btc = mk({
      ticker: 'BTC-PNL',
      asset: 'BTC',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const eth = mk({
      ticker: 'ETH-PNL',
      asset: 'ETH',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    portfolio.seedSpot('BTC', 120)
    portfolio.seedSpot('ETH', 120)
    portfolio.seedSpot('SOL', 120)
    portfolio.setConfig({ maxActiveMarkets: 2 })
    portfolio.syncMarketUniverse([btc, eth])
    portfolio.start()

    portfolio.seedBookStats('BTC-PNL', {
      realizedSpreadPnl: 1.25,
      feesPaid: 0.05,
      fill: mkFill('f-btc-1'),
    })
    portfolio.seedBookStats('ETH-PNL', {
      realizedSpreadPnl: 0.5,
      feesPaid: 0.02,
      fill: mkFill('f-eth-1'),
    })

    let st = portfolio.getState()
    expect(st.aggregate.realizedSpreadPnl).toBeCloseTo(1.75, 5)
    expect(st.aggregate.fillCount).toBe(2)
    expect(st.aggregate.feesPaid).toBeCloseTo(0.07, 5)

    // Same-asset roll BTC — realized stays on the engine across roll
    const btcClosed = mk({
      ...btc,
      status: 'closed',
      minutesRemaining: 0,
      closeTime: new Date(Date.now() - 1000).toISOString(),
    })
    const btcNext = mk({
      ticker: 'BTC-PNL-NEXT',
      asset: 'BTC',
      midYes: 0.41,
      floorStrike: 100,
      minutesRemaining: 14,
      closeTime: new Date(Date.now() + 14 * 60_000).toISOString(),
    })
    portfolio.syncMarketUniverse([btcClosed, btcNext, eth])
    st = portfolio.getState()
    expect(st.books.some((b) => b.snapshot.marketTicker === 'BTC-PNL-NEXT')).toBe(true)
    expect(st.aggregate.realizedSpreadPnl).toBeCloseTo(1.75, 5)
    expect(st.aggregate.fillCount).toBe(2)

    // Release BTC book by replacing with higher-edge SOL (valid ranked set)
    // Seed SOL with huge edge so it enters top-2; drop BTC by making it low edge
    portfolio.seedSpot('SOL', 200) // deep ITM vs strike 100
    portfolio.seedSpot('BTC', 100.5) // near ATM → low edge
    portfolio.seedSpot('ETH', 200)
    const btcFlat = mk({
      ticker: 'BTC-PNL-NEXT',
      asset: 'BTC',
      midYes: 0.5,
      floorStrike: 100,
      minutesRemaining: 10,
    })
    const ethHi = mk({
      ticker: 'ETH-PNL',
      asset: 'ETH',
      midYes: 0.35,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const solHi = mk({
      ticker: 'SOL-PNL',
      asset: 'SOL',
      midYes: 0.35,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    // Before release, note BTC engine still carries ~1.25 realized
    portfolio.syncMarketUniverse([btcFlat, ethHi, solHi])
    st = portfolio.getState()
    // Aggregated realized must still include banked BTC P&L after any release
    expect(st.aggregate.realizedSpreadPnl).toBeGreaterThanOrEqual(1.75 - 0.01)
    expect(st.aggregate.fillCount).toBeGreaterThanOrEqual(2)
  })

  it('fill counts persist in session totals after release', () => {
    const only = mk({
      ticker: 'BTC-FILLS',
      asset: 'BTC',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const eth = mk({
      ticker: 'ETH-TAKE',
      asset: 'ETH',
      midYes: 0.35,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    portfolio.seedSpot('BTC', 120)
    portfolio.seedSpot('ETH', 120)
    portfolio.setConfig({ maxActiveMarkets: 1 })
    portfolio.syncMarketUniverse([only])
    portfolio.start()
    portfolio.seedBookStats('BTC-FILLS', {
      realizedSpreadPnl: 0.8,
      feesPaid: 0.03,
      fill: mkFill('persist-1'),
    })
    expect(portfolio.getState().aggregate.fillCount).toBe(1)
    expect(portfolio.getState().aggregate.realizedSpreadPnl).toBeCloseTo(0.8, 5)

    // Valid open ranked set with ETH only (BTC closed, no same-asset) → release BTC, fill ETH
    const btcDead = mk({
      ticker: 'BTC-FILLS',
      asset: 'BTC',
      status: 'closed',
      minutesRemaining: 0,
      closeTime: new Date(Date.now() - 1000).toISOString(),
      midYes: 0.4,
      floorStrike: 100,
    })
    portfolio.syncMarketUniverse([btcDead, eth])
    const st = portfolio.getState()
    expect(st.books.map((b) => b.snapshot.marketTicker)).toContain('ETH-TAKE')
    expect(st.books.map((b) => b.snapshot.marketTicker)).not.toContain('BTC-FILLS')
    // Session ledger retained fills + realized from released book
    expect(st.aggregate.fillCount).toBe(1)
    expect(st.aggregate.realizedSpreadPnl).toBeCloseTo(0.8, 5)
    expect(st.sessionFills.length).toBeGreaterThanOrEqual(1)
    expect(st.aggregate.feesPaid).toBeCloseTo(0.03, 5)
  })
})
