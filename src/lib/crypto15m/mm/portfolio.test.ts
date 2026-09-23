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
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
      }),
    )
    for (const a of ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA']) {
      portfolio.seedSpot(a, 100.05)
    }
    portfolio.syncMarketUniverse(markets)
    portfolio.start()
    const st = portfolio.getState()
    expect(st.aggregate.activeBooks).toBeLessThanOrEqual(3)
    expect(st.aggregate.activeBooks).toBe(3)
    expect(st.books.every((b) => b.snapshot.running)).toBe(true)
  })

  it('U3.2: prefers mid quality / L2 over larger |FV−mid|', () => {
    const lowEdge = mk({
      ticker: 'ETH-FLAT',
      asset: 'ETH',
      midYes: 0.5,
      yesBid: 0.49,
      yesAsk: 0.51,
      floorStrike: 3_000,
      minutesRemaining: 10,
    })
    const highEdge = mk({
      ticker: 'BTC-EDGE',
      asset: 'BTC',
      midYes: 0.2,
      yesBid: 0.1,
      yesAsk: 0.3,
      floorStrike: 100_000,
      minutesRemaining: 12,
    })
    portfolio.seedSpot('BTC', 100_100)
    portfolio.seedSpot('ETH', 3_000)
    portfolio.setConfig({ maxActiveMarkets: 1 })
    portfolio.syncMarketUniverse([lowEdge, highEdge])
    portfolio.start()
    const st = portfolio.getState()
    expect(st.aggregate.activeBooks).toBe(1)
    // Mid-quality ETH (0.5, tight) beats huge-|edge| BTC (0.2, wide)
    expect(st.books[0]!.snapshot.marketTicker).toBe('ETH-FLAT')
    expect(st.scan[0]!.ticker).toBe('ETH-FLAT')
  })

  it('different assets get different spots → different FV on books', () => {
    const btc = mk({
      ticker: 'BTC-A',
      asset: 'BTC',
      midYes: 0.5,
      floorStrike: 100_000,
      minutesRemaining: 12,
    })
    const eth = mk({
      ticker: 'ETH-A',
      asset: 'ETH',
      midYes: 0.5,
      floorStrike: 3_000,
      minutesRemaining: 12,
    })
    portfolio.seedSpot('BTC', 100_100)
    portfolio.seedSpot('ETH', 3_002)
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
      midYes: 0.48,
      floorStrike: 100,
    })
    const eth = mk({
      ticker: 'ETH-LIVE',
      asset: 'ETH',
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const sol = mk({
      ticker: 'SOL-LIVE',
      asset: 'SOL',
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    portfolio.seedSpot('BTC', 100.05)
    portfolio.seedSpot('ETH', 100.05)
    portfolio.seedSpot('SOL', 100.05)
    portfolio.setConfig({ maxActiveMarkets: 2 })

    const btcLive = mk({
      ticker: 'BTC-DEAD',
      asset: 'BTC',
      midYes: 0.48,
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
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const eth = mk({
      ticker: 'ETH-HOLD',
      asset: 'ETH',
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    portfolio.seedSpot('BTC', 100.05)
    portfolio.seedSpot('ETH', 100.05)
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
        midYes: 0.48,
        floorStrike: 100,
      }),
      mk({
        ticker: 'ETH-HOLD',
        asset: 'ETH',
        status: 'closed',
        closeTime: new Date(Date.now() - 60_000).toISOString(),
        minutesRemaining: 0,
        midYes: 0.48,
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
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 2,
      closeTime: new Date(Date.now() + 2 * 60_000).toISOString(),
    })
    portfolio.seedSpot('BNB', 100.05)
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
      midYes: 0.48,
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
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const eth = mk({
      ticker: 'ETH-PNL',
      asset: 'ETH',
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    portfolio.seedSpot('BTC', 100.05)
    portfolio.seedSpot('ETH', 100.05)
    portfolio.seedSpot('SOL', 100.05)
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
      midYes: 0.48,
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
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const eth = mk({
      ticker: 'ETH-TAKE',
      asset: 'ETH',
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 10,
    })
    portfolio.seedSpot('BTC', 100.05)
    portfolio.seedSpot('ETH', 100.05)
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
      midYes: 0.48,
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

  it('U2.8 shared cash: two books at startingCash aggregate ≈ one bankroll, not sum', () => {
    const btc = mk({
      ticker: 'BTC-CASH',
      asset: 'BTC',
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 10,
    })
    const eth = mk({
      ticker: 'ETH-CASH',
      asset: 'ETH',
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 10,
    })
    portfolio.seedSpot('BTC', 100.05)
    portfolio.seedSpot('ETH', 100.05)
    portfolio.setConfig({ maxActiveMarkets: 2, startingCash: 100 })
    portfolio.syncMarketUniverse([btc, eth])
    portfolio.start()
    const st0 = portfolio.getState()
    expect(st0.books.length).toBe(2)
    // Each engine starts at ~100; naive sum would be ~200 — shared view is ~100
    expect(st0.aggregate.cash).toBeCloseTo(100, 5)

    portfolio.seedBookStats('BTC-CASH', { cash: 95 })
    portfolio.seedBookStats('ETH-CASH', { cash: 100 })
    const st1 = portfolio.getState()
    // starting + (95-100) + (100-100) = 95
    expect(st1.aggregate.cash).toBeCloseTo(95, 5)
  })


  describe('U2.14 L2-off drop & refill', () => {
    it('drops flat book after l2OffDropTicks and refills from ranked open set', () => {
      const btc = mk({
        ticker: 'BTC-L2OFF',
        asset: 'BTC',
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
      })
      const eth = mk({
        ticker: 'ETH-REFILL',
        asset: 'ETH',
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
      })
      portfolio.seedSpot('BTC', 100.05)
      portfolio.seedSpot('ETH', 100.05)
      portfolio.setConfig({
        maxActiveMarkets: 1,
        multiBook: true,
        useLiveBook: true,
        l2OffDropTicks: 3,
        fillMidFallback: true,
        fvQuoting: true,
        minEdgeCents: 1,
      })
      portfolio.syncMarketUniverse([btc, eth])
      portfolio.start()
      const first = portfolio.getState().books[0]?.snapshot.marketTicker
      expect(first).toBeTruthy()
      expect(portfolio.getState().books[0]?.snapshot.liveBook).toBe(false)

      for (let i = 0; i < 6; i++) {
        const still = portfolio
          .getState()
          .books.some((b) => b.snapshot.marketTicker === first)
        if (!still) break
        portfolio.syncMarketUniverse([btc, eth])
      }
      const st = portfolio.getState()
      expect(st.message).toMatch(/U2\.14: dropped .+ — L2 off/)
      const tickers = st.books.map((b) => b.snapshot.marketTicker)
      expect(tickers).not.toContain(first)
      expect(tickers.length).toBe(1)
      expect(tickers[0]).not.toBe(first)
    })

    it('holds open inventory with fail-loud U2.14 (no invent flatten)', () => {
      const btc = mk({
        ticker: 'BTC-HOLD-INV',
        asset: 'BTC',
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
      })
      portfolio.seedSpot('BTC', 100.05)
      portfolio.setConfig({
        maxActiveMarkets: 1,
        multiBook: true,
        useLiveBook: true,
        l2OffDropTicks: 2,
        fillMidFallback: true,
        minEdgeCents: 1,
      })
      portfolio.syncMarketUniverse([btc])
      portfolio.start()
      const eng = portfolio.getEngineForTests('BTC-HOLD-INV')
      expect(eng).toBeTruthy()
      eng!.seedInventory(2, 0.5)
      expect(eng!.getState().snapshot.inventory).toBe(2)

      for (let i = 0; i < 4; i++) {
        portfolio.syncMarketUniverse([btc])
      }

      const st = portfolio.getState()
      expect(st.books.map((b) => b.snapshot.marketTicker)).toContain('BTC-HOLD-INV')
      expect(st.books[0]!.snapshot.inventory).toBe(2)
      expect(st.books[0]!.snapshot.message).toMatch(/U2\.14:\ L2\ off\ —\ holding\ inv\ until\ flat/)
    })

    it('resets L2-off counter when liveBook returns', () => {
      const btc = mk({
        ticker: 'BTC-L2BACK',
        asset: 'BTC',
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
      })
      portfolio.seedSpot('BTC', 100.05)
      portfolio.setConfig({
        maxActiveMarkets: 1,
        multiBook: true,
        useLiveBook: true,
        l2OffDropTicks: 5,
        fillMidFallback: true,
        minEdgeCents: 1,
      })
      portfolio.syncMarketUniverse([btc])
      portfolio.start()
      const eng = portfolio.getEngineForTests('BTC-L2BACK')!
      const slotId = portfolio.getState().books[0]!.slotId
      portfolio.syncMarketUniverse([btc])
      portfolio.syncMarketUniverse([btc])
      expect(portfolio.getL2OffTicksForTests(slotId)).toBeGreaterThanOrEqual(2)
      eng.__setLiveBookForTests(true)
      portfolio.syncMarketUniverse([btc])
      expect(portfolio.getL2OffTicksForTests(slotId)).toBe(0)
      expect(portfolio.getState().books[0]!.snapshot.marketTicker).toBe('BTC-L2BACK')
    })

    it('U2.14.1: drops flat L2-off on early-return when open set is empty', () => {
      const btc = mk({
        ticker: 'BTC-EARLY-DROP',
        asset: 'BTC',
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
      })
      portfolio.seedSpot('BTC', 100.05)
      portfolio.setConfig({
        maxActiveMarkets: 1,
        multiBook: true,
        useLiveBook: true,
        l2OffDropTicks: 3,
        fillMidFallback: true,
        fvQuoting: true,
        minEdgeCents: 1,
      })
      portfolio.syncMarketUniverse([btc])
      portfolio.start()
      expect(portfolio.getState().books.some((b) => b.snapshot.marketTicker === 'BTC-EARLY-DROP')).toBe(
        true,
      )
      expect(portfolio.getState().books[0]!.snapshot.liveBook).toBe(false)

      // Closed feed → openN===0 early-return path (must still evict flat L2-off).
      const closed = mk({
        ticker: 'BTC-EARLY-DROP',
        asset: 'BTC',
        midYes: 0.48,
        floorStrike: 100,
        status: 'closed',
        minutesRemaining: 0,
        closeTime: new Date(Date.now() - 60_000).toISOString(),
      })
      for (let i = 0; i < 6; i++) {
        const still = portfolio
          .getState()
          .books.some((b) => b.snapshot.marketTicker === 'BTC-EARLY-DROP')
        if (!still) break
        portfolio.syncMarketUniverse([closed])
      }
      const st = portfolio.getState()
      expect(st.books.map((b) => b.snapshot.marketTicker)).not.toContain('BTC-EARLY-DROP')
      expect(st.message).toMatch(/U2\.14: dropped .+ — L2 off/)
    })

    it('U2.14.1: under-fill does not erase U2.14 drop strip', () => {
      const btc = mk({
        ticker: 'BTC-DROP-STRIP',
        asset: 'BTC',
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
      })
      const eth = mk({
        ticker: 'ETH-ONLY-REFILL',
        asset: 'ETH',
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
      })
      portfolio.seedSpot('BTC', 100.05)
      portfolio.seedSpot('ETH', 100.05)
      portfolio.setConfig({
        maxActiveMarkets: 2,
        multiBook: true,
        useLiveBook: true,
        l2OffDropTicks: 2,
        fillMidFallback: true,
        fvQuoting: true,
        minEdgeCents: 1,
      })
      // Start with BTC only so first slot is L2-off BTC; then add ETH for refill.
      portfolio.syncMarketUniverse([btc])
      portfolio.start()
      expect(portfolio.getState().books[0]!.snapshot.marketTicker).toBe('BTC-DROP-STRIP')
      for (let i = 0; i < 5; i++) {
        const still = portfolio
          .getState()
          .books.some((b) => b.snapshot.marketTicker === 'BTC-DROP-STRIP')
        if (!still) break
        // Ranked set has BTC+ETH so main path runs; after drop only ETH refills → under-filled
        portfolio.syncMarketUniverse([btc, eth])
      }
      const st = portfolio.getState()
      expect(st.message).toMatch(/U2\.14: dropped .+ — L2 off/)
      expect(st.message).not.toMatch(/under-filled/i)
      expect(st.books.map((b) => b.snapshot.marketTicker)).not.toContain('BTC-DROP-STRIP')
    })

  })

})
