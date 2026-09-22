/**
 * Quant-grade hardening: fixture FV helpers, live-prefer, multi-book fill, no-FV park,
 * slot-gated invariant, session P&L retention, edge sticky, toxic block, empty feed.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { getDemoCrypto15m, DEMO_FIXTURE_SPOTS } from '../../../fixtures/demoCrypto15m'
import { normalizeCrypto15m } from '../normalize'
import { estimateYesFairValue, resolveStrike } from './fairValue'
import {
  pickActiveMarkets,
  rankMarketsByAbsEdge,
  scoreMarketEdge,
} from './edgeRank'
import { PaperMmEngine } from './engine'
import { PaperMmPortfolio } from './portfolio'
import type { MmFill } from './types'
import { DEMO_SPOT_BASE } from '../spot'

function mk(
  partial: Partial<Crypto15mMarket> & Pick<Crypto15mMarket, 'ticker' | 'asset'>,
): Crypto15mMarket {
  return {
    eventTicker: partial.eventTicker ?? partial.ticker,
    seriesTicker: partial.seriesTicker ?? `KX${partial.asset}15M`,
    title: partial.title ?? `${partial.asset} price up in next 15 mins?`,
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
    floorStrike: partial.floorStrike !== undefined ? partial.floorStrike : 100,
    rulesPrimary: partial.rulesPrimary ?? 'YES if price up vs floor_strike.',
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

function mkFill(id: string, price = 0.45): MmFill {
  return {
    id,
    t: Date.now(),
    side: 'buy_yes',
    price,
    size: 1,
    midAtFill: 0.5,
    toxic: false,
    reason: 'random',
    feeDollars: 0.01,
    taker: false,
  }
}

describe('demo fixtures · floorStrike + FV', () => {
  it('every demo fixture has floorStrike and finite FV with matching spot', () => {
    const raws = getDemoCrypto15m()
    expect(raws.length).toBeGreaterThanOrEqual(5)
    for (const raw of raws) {
      const m = normalizeCrypto15m(raw)
      expect(m.floorStrike).not.toBeNull()
      expect(m.floorStrike!).toBeGreaterThan(0)
      expect(m.minutesRemaining).toBeGreaterThan(0)
      const spot = DEMO_FIXTURE_SPOTS[m.asset] ?? DEMO_SPOT_BASE[m.asset]
      expect(spot).toBeGreaterThan(0)
      const est = estimateYesFairValue({
        spot: spot!,
        strike: m.floorStrike!,
        minutesRemaining: m.minutesRemaining,
        annualVol: 0.7,
      })
      expect(est).not.toBeNull()
      expect(Number.isFinite(est!.fairProb)).toBe(true)
      expect(est!.fairProb).toBeGreaterThanOrEqual(0.01)
      expect(est!.fairProb).toBeLessThanOrEqual(0.99)

      const scored = scoreMarketEdge(m, spot, 0.7, 2)
      expect(scored.fairValue).not.toBeNull()
      expect(scored.edgeCents).not.toBeNull()
    }
  })

  it('regenerating demo windows keeps markets open across refresh', () => {
    const a = getDemoCrypto15m().map((r) => normalizeCrypto15m(r))
    const b = getDemoCrypto15m().map((r) => normalizeCrypto15m(r))
    expect(a.every((m) => m.minutesRemaining > 0)).toBe(true)
    expect(b.every((m) => m.minutesRemaining > 0)).toBe(true)
  })
})

describe('resolveStrike · spot reference when floor missing', () => {
  it('derives K≈spot for up/down when floorStrike missing', () => {
    const r = resolveStrike(null, 95_000, {
      title: 'BTC price up in next 15 mins?',
      rulesPrimary: 'YES if RTI ≥ open',
    })
    expect(r.source).toBe('spot_reference')
    expect(r.strike).toBe(95_000)
    expect(r.assumption).toMatch(/K≈spot/i)
  })

  it('prefers API floor_strike over spot', () => {
    const r = resolveStrike(94_000, 95_000, { title: 'BTC price up in next 15 mins?' })
    expect(r.source).toBe('floor_strike')
    expect(r.strike).toBe(94_000)
  })
})

describe('live-prefer fetchCrypto15mMarkets', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('prefers proxy success over demo', async () => {
    const { fetchCrypto15mMarkets } = await import('../api')
    const proxyMarket = {
      ticker: 'KXBTC15M-LIVE-PROXY',
      event_ticker: 'KXBTC15M-LIVE',
      title: 'BTC price up in next 15 mins?',
      status: 'open',
      close_time: new Date(Date.now() + 10 * 60_000).toISOString(),
      open_time: new Date(Date.now() - 5 * 60_000).toISOString(),
      yes_bid_dollars: '0.48',
      yes_ask_dollars: '0.52',
      floor_strike: 94000,
      rules_primary: 'YES if up',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/local-api/crypto15m')) {
          return {
            ok: true,
            json: async () => ({
              readOnly: true,
              authenticated: false,
              markets: [proxyMarket],
            }),
          } as Response
        }
        return { ok: false, status: 500, json: async () => ({}) } as Response
      }),
    )
    const result = await fetchCrypto15mMarkets()
    expect(result.source).toBe('live')
    expect(result.markets.some((m) => m.ticker === 'KXBTC15M-LIVE-PROXY')).toBe(true)
  })

  it('returns empty live + LIVE-ONLY error when proxy + public fail (no demo)', async () => {
    const { fetchCrypto15mMarkets } = await import('../api')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const result = await fetchCrypto15mMarkets()
    expect(result.source).not.toBe('demo')
    expect(result.source).toBe('live')
    expect(result.markets).toEqual([])
    expect(result.error).toBeTruthy()
    expect(result.error!).toMatch(/LIVE-ONLY FAILURE/i)
  })
})

describe('multi-book · fill slots to min(open, maxActive)', () => {
  let portfolio: PaperMmPortfolio

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    portfolio = new PaperMmPortfolio()
    portfolio.setConfig({
      maxActiveMarkets: 5,
      multiBook: true,
      fvQuoting: true,
      minEdgeCents: 2,
      annualVol: 0.7,
      useLiveBook: false,
      strictRealism: true,
    })
  })

  afterEach(() => {
    portfolio.stop()
    vi.unstubAllGlobals()
  })

  it('5 open demo-like markets ⇒ activeBooks === min(5, maxActiveMarkets)', () => {
    const markets = getDemoCrypto15m().map((r) => normalizeCrypto15m(r))
    expect(markets.length).toBe(5)
    for (const [asset, px] of Object.entries(DEMO_FIXTURE_SPOTS)) {
      portfolio.seedSpot(asset, px)
    }
    // Strict: no mid-fb for toxic-mid / no-edge demo rows; expect quoteable+sanity slots.
    portfolio.setConfig({ fillMidFallback: false, minEdgeCents: 0 })
    portfolio.syncMarketUniverse(markets)
    portfolio.start()
    const st = portfolio.getState()
    expect(st.scan.length).toBe(5)
    expect(st.scan.every((r) => r.fairValue != null)).toBe(true)
    // BNB extreme-mid demo is not mid-tradeable → not activated under strict mid-fb=off
    expect(st.aggregate.activeBooks).toBeGreaterThanOrEqual(4)
    expect(st.aggregate.activeBooks).toBeLessThanOrEqual(5)
  })

  it('never shows slot-gated semantics on an active ticker (book is assigned)', () => {
    const markets = ['BTC', 'ETH', 'SOL'].map((asset) =>
      mk({
        ticker: `${asset}-OPEN`,
        asset,
        midYes: 0.45,
        floorStrike: 100,
        minutesRemaining: 8,
      }),
    )
    for (const a of ['BTC', 'ETH', 'SOL']) portfolio.seedSpot(a, 120)
    portfolio.setConfig({ maxActiveMarkets: 3 })
    portfolio.syncMarketUniverse(markets)
    portfolio.start()
    const st = portfolio.getState()
    const active = new Set(
      st.books.map((b) => b.snapshot.marketTicker).filter(Boolean) as string[],
    )
    expect(active.size).toBe(3)
    // Every active ticker is in scan and holds a book — UI must not label "slot · gated"
    for (const t of active) {
      const book = st.books.find((b) => b.snapshot.marketTicker === t)
      expect(book).toBeTruthy()
      // Book is assigned; quoting depends on decision policy (edge/FV)
      const q = book!.snapshot.quote
      expect(q).toBeTruthy()
    }
  })

  it('empty feed hold still passes (prior fix)', () => {
    const btc = mk({
      ticker: 'BTC-HOLD2',
      asset: 'BTC',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const eth = mk({
      ticker: 'ETH-HOLD2',
      asset: 'ETH',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    portfolio.seedSpot('BTC', 120)
    portfolio.seedSpot('ETH', 120)
    portfolio.syncMarketUniverse([btc, eth])
    portfolio.start()
    expect(portfolio.getState().aggregate.activeBooks).toBe(2)
    portfolio.syncMarketUniverse([])
    const st = portfolio.getState()
    expect(st.aggregate.activeBooks).toBe(2)
    expect(st.message).not.toMatch(/outside top/i)
  })

  it('session P&L retained after 3 roll/release cycles', () => {
    portfolio.setConfig({ maxActiveMarkets: 1 })
    portfolio.seedSpot('BTC', 120)
    portfolio.seedSpot('ETH', 120)
    portfolio.seedSpot('SOL', 120)

    let ticker = 'BTC-C0'
    portfolio.syncMarketUniverse([
      mk({ ticker, asset: 'BTC', midYes: 0.4, floorStrike: 100, minutesRemaining: 2 }),
    ])
    portfolio.start()
    portfolio.seedBookStats(ticker, {
      realizedSpreadPnl: 1.0,
      feesPaid: 0.02,
      fill: mkFill('c0'),
    })

    // Cycle 1: same-asset roll
    portfolio.syncMarketUniverse([
      mk({
        ticker,
        asset: 'BTC',
        status: 'closed',
        minutesRemaining: 0,
        closeTime: new Date(Date.now() - 1000).toISOString(),
        midYes: 0.4,
        floorStrike: 100,
      }),
      mk({
        ticker: 'BTC-C1',
        asset: 'BTC',
        midYes: 0.41,
        floorStrike: 100,
        minutesRemaining: 14,
        closeTime: new Date(Date.now() + 14 * 60_000).toISOString(),
      }),
    ])
    expect(portfolio.getState().aggregate.realizedSpreadPnl).toBeCloseTo(1.0, 5)
    expect(portfolio.getState().aggregate.fillCount).toBe(1)
    ticker = 'BTC-C1'
    // seedPaperStats SETs realized (does not add) — keep cumulative across the roll
    portfolio.seedBookStats(ticker, {
      realizedSpreadPnl: 1.5,
      feesPaid: 0.03,
      fill: mkFill('c1'),
    })

    // Cycle 2: release BTC (dead, no same-asset) → ETH
    portfolio.syncMarketUniverse([
      mk({
        ticker,
        asset: 'BTC',
        status: 'closed',
        minutesRemaining: 0,
        closeTime: new Date(Date.now() - 1000).toISOString(),
        midYes: 0.4,
        floorStrike: 100,
      }),
      mk({
        ticker: 'ETH-C2',
        asset: 'ETH',
        midYes: 0.35,
        floorStrike: 100,
        minutesRemaining: 10,
      }),
    ])
    let st = portfolio.getState()
    expect(st.aggregate.realizedSpreadPnl).toBeCloseTo(1.5, 5)
    expect(st.aggregate.fillCount).toBe(2)
    expect(st.books[0]?.snapshot.marketTicker).toBe('ETH-C2')
    // New book cash must not erase session totals
    expect(st.aggregate.realizedSpreadPnl).toBeGreaterThan(0)
    portfolio.seedBookStats('ETH-C2', {
      realizedSpreadPnl: 0.25,
      feesPaid: 0.01,
      fill: mkFill('c2'),
    })

    // Cycle 3: release ETH → SOL
    portfolio.syncMarketUniverse([
      mk({
        ticker: 'ETH-C2',
        asset: 'ETH',
        status: 'closed',
        minutesRemaining: 0,
        closeTime: new Date(Date.now() - 1000).toISOString(),
        midYes: 0.4,
        floorStrike: 100,
      }),
      mk({
        ticker: 'SOL-C3',
        asset: 'SOL',
        midYes: 0.35,
        floorStrike: 100,
        minutesRemaining: 10,
      }),
    ])
    st = portfolio.getState()
    expect(st.aggregate.realizedSpreadPnl).toBeCloseTo(1.75, 5)
    expect(st.aggregate.fillCount).toBe(3)
    expect(st.aggregate.feesPaid).toBeCloseTo(0.04, 5)
    expect(st.sessionFills.length).toBeGreaterThanOrEqual(2)
    // prices in dollars [0,1]
    for (const f of st.sessionFills) {
      expect(f.price).toBeGreaterThanOrEqual(0)
      expect(f.price).toBeLessThanOrEqual(1)
    }
  })
})

describe('FV missing ⇒ both sides OFF (no mid spam)', () => {
  let engine: PaperMmEngine

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    engine = new PaperMmEngine()
    engine.setConfig({
      fvQuoting: true,
      minEdgeCents: 3,
      annualVol: 0.7,
      useLiveBook: false,
      strictRealism: true,
      toxicMidLow: 0.05,
      toxicMidHigh: 0.95,
      halfSpreadCents: 2,
      quoteSize: 1,
      maxInventory: 10,
    })
  })

  afterEach(() => {
    engine.stop()
    vi.unstubAllGlobals()
  })

  it('parks both sides when FV inputs incomplete', () => {
    const market = mk({
      ticker: 'NO-FV',
      asset: 'BTC',
      midYes: 0.5,
      yesBid: 0.48,
      yesAsk: 0.52,
      floorStrike: null,
      minutesRemaining: 10,
      title: 'something opaque',
      rulesPrimary: 'n/a',
    })
    engine.setMarket(market)
    engine.start()
    const s = engine.getState().snapshot
    expect(s.fairValue).toBeNull()
    expect(s.quote).not.toBeNull()
    expect(s.quote!.bidActive).toBe(false)
    expect(s.quote!.askActive).toBe(false)
    expect(s.quote!.bidReason + s.quote!.askReason).toMatch(/no FV/i)
  })

  it('toxic mid still blocks bid even without FV', () => {
    const market = mk({
      ticker: 'TOXIC-MID',
      asset: 'BTC',
      midYes: 0.01,
      yesBid: 0.01,
      yesAsk: 0.02,
      floorStrike: null,
      minutesRemaining: 10,
      title: 'opaque',
      rulesPrimary: 'n/a',
    })
    engine.setMarket(market)
    engine.start()
    const s = engine.getState().snapshot
    expect(s.quote?.bidActive).toBe(false)
    // no FV parks both first; reason may be no FV (checked before toxic mid)
    expect(s.quote?.bidReason.toLowerCase()).toMatch(/no fv|toxic|invalid/)
  })
})

describe('edge ranking + sticky + one-per-asset', () => {
  const now = Date.now()

  it('sticky + one-per-asset + edge order', () => {
    const markets = [
      mk({
        ticker: 'BTC-A',
        asset: 'BTC',
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
        closeTime: new Date(now + 10 * 60_000).toISOString(),
      }),
      mk({
        ticker: 'BTC-B',
        asset: 'BTC',
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
        closeTime: new Date(now + 10 * 60_000).toISOString(),
      }),
      mk({
        ticker: 'ETH-A',
        asset: 'ETH',
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
        closeTime: new Date(now + 10 * 60_000).toISOString(),
      }),
      mk({
        ticker: 'SOL-STICKY',
        asset: 'SOL',
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
        closeTime: new Date(now + 10 * 60_000).toISOString(),
      }),
    ]
    const ranked = rankMarketsByAbsEdge(
      markets,
      { BTC: 100.05, ETH: 100.05, SOL: 100.05 },
      0.7,
      2,
      now,
      25,
    )
    const picked = pickActiveMarkets(ranked, {
      maxActive: 2,
      stickyTickers: ['SOL-STICKY'],
      onePerAsset: true,
      requireEdge: true,
      fillMidFallback: true,
    })
    expect(picked).toHaveLength(2)
    expect(picked.some((m) => m.ticker === 'SOL-STICKY')).toBe(true)
    expect(new Set(picked.map((m) => m.asset)).size).toBe(2)
    // Only one BTC despite two BTC markets
    expect(picked.filter((m) => m.asset === 'BTC').length).toBeLessThanOrEqual(1)
  })

  it('scoreMarketEdge reports no_spot / no_strike reasons', () => {
    const m = mk({
      ticker: 'X',
      asset: 'BTC',
      floorStrike: null,
      title: 'opaque',
      rulesPrimary: 'n/a',
    })
    const noSpot = scoreMarketEdge(m, null, 0.7, 2)
    expect(noSpot.fvMissingReason).toBe('no_spot')
    expect(noSpot.fairValue).toBeNull()
    expect(noSpot.midFallbackEligible).toBe(true)

    const withSpot = scoreMarketEdge(m, 100, 0.7, 2)
    // opaque rules → no spot_reference → no_strike
    expect(withSpot.fvMissingReason).toBe('no_strike')
  })
})
