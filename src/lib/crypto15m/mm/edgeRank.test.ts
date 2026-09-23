/**
 * Multi-book edge ranking + maxActiveMarkets cap.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import {
  isMmQuoteUniverseMarket,
  pickActiveMarkets,
  rankMarketsByAbsEdge,
  scoreMarketEdge,
} from './edgeRank'

function mk(
  partial: Partial<Crypto15mMarket> & Pick<Crypto15mMarket, 'ticker' | 'asset'>,
): Crypto15mMarket {
  return {
    eventTicker: partial.eventTicker ?? partial.ticker,
    seriesTicker: partial.seriesTicker ?? `KX${partial.asset}15M`,
    title: partial.title ?? 'test',
    status: partial.status ?? 'active',
    openTime: partial.openTime ?? null,
    closeTime: partial.closeTime ?? '2026-09-21T20:00:00.000Z',
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
    yesBidSize: 0,
    yesAskSize: 0,
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

describe('edgeRank', () => {
  const now = Date.parse('2026-09-21T19:50:00.000Z')

  it('U3.2: does NOT prefer larger |FV−mid|; prefers L2 / mid quality', () => {
    // Wide-mid book with huge |FV−mid| vs tight L2 mid-quality book with tiny edge
    const hugeEdge = mk({
      ticker: 'BTC-HUGE-EDGE',
      asset: 'BTC',
      midYes: 0.2,
      yesBid: 0.1,
      yesAsk: 0.3, // 20¢ wide
      floorStrike: 100_000,
      minutesRemaining: 10,
      closeTime: '2026-09-21T20:00:00.000Z',
    })
    const tightL2 = mk({
      ticker: 'ETH-TIGHT',
      asset: 'ETH',
      midYes: 0.5,
      yesBid: 0.49,
      yesAsk: 0.51, // 2¢ tight
      floorStrike: 3_000,
      minutesRemaining: 15,
      closeTime: '2026-09-21T20:05:00.000Z',
    })
    // BTC far OTM vs high strike → large |edge|; ETH ATM → ~0
    const ranked = rankMarketsByAbsEdge(
      [hugeEdge, tightL2],
      { BTC: 100_200, ETH: 3_000 },
      0.7,
      2,
      now,
      25,
    )
    expect(ranked[0]!.ticker).toBe('ETH-TIGHT')
    expect(ranked[0]!.hasL2).toBe(true)
    expect(ranked[0]!.midQuality).toBeGreaterThan(ranked[1]!.midQuality)
    // Fail-loud: must not rank by absEdge descending
    expect(ranked[0]!.absEdgeCents).toBeLessThanOrEqual(ranked[1]!.absEdgeCents + 1e-9)
  })

  it('enforces maxActiveMarkets cap', () => {
    const markets = ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'BNB'].map((asset, i) =>
      mk({
        ticker: `${asset}-T`,
        asset,
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 10,
        closeTime: `2026-09-21T20:0${i}:00.000Z`,
      }),
    )
    // Tiny ITM — ~8¢ sane edge
    const spots = Object.fromEntries(markets.map((m) => [m.asset, 100.05]))
    const ranked = rankMarketsByAbsEdge(markets, spots, 0.7, 2, now, 25)
    expect(ranked.every((r) => !r.sanityPark)).toBe(true)
    expect(ranked.every((r) => r.quoteEligible)).toBe(true)
    const picked = pickActiveMarkets(ranked, { maxActive: 4 })
    expect(picked).toHaveLength(4)
    expect(new Set(picked.map((m) => m.asset)).size).toBe(4)
  })

  it('different assets with different spots get different FV', () => {
    const btc = mk({
      ticker: 'BTC-1',
      asset: 'BTC',
      midYes: 0.5,
      floorStrike: 100_000,
      minutesRemaining: 5,
    })
    const eth = mk({
      ticker: 'ETH-1',
      asset: 'ETH',
      midYes: 0.5,
      floorStrike: 3_000,
      minutesRemaining: 5,
    })
    const btcScore = scoreMarketEdge(btc, 102_000, 0.7, 2)
    const ethScore = scoreMarketEdge(eth, 2_900, 0.7, 2)
    expect(btcScore.fairValue).not.toBeNull()
    expect(ethScore.fairValue).not.toBeNull()
    expect(btcScore.fairValue!).toBeGreaterThan(0.5)
    expect(ethScore.fairValue!).toBeLessThan(0.5)
    expect(btcScore.fairValue).not.toBe(ethScore.fairValue)
  })

  it('sticky tickers kept when still open; extras fill by edge', () => {
    const markets = [
      mk({ ticker: 'A', asset: 'BTC', midYes: 0.48, floorStrike: 100, minutesRemaining: 10 }),
      mk({ ticker: 'B', asset: 'ETH', midYes: 0.48, floorStrike: 100, minutesRemaining: 10 }),
      mk({ ticker: 'C', asset: 'SOL', midYes: 0.48, floorStrike: 100, minutesRemaining: 10 }),
    ]
    const spots = { BTC: 100.05, ETH: 100.05, SOL: 100.05 }
    const ranked = rankMarketsByAbsEdge(markets, spots, 0.7, 2, now, 25)
    const picked = pickActiveMarkets(ranked, {
      maxActive: 2,
      stickyTickers: ['C'],
    })
    expect(picked).toHaveLength(2)
    expect(picked.some((m) => m.ticker === 'C')).toBe(true)
  })

  it('excludes CRYPTOLEAD / CRYPTOCOMP and no-strike from ranking & pickActiveMarkets', () => {
    const lead = mk({
      ticker: 'KXCRYPTOLEAD15M-BTC',
      asset: 'CRYPTO',
      seriesTicker: 'KXCRYPTOLEAD15M',
      midYes: 0.4,
      floorStrike: null,
      title: 'BTC leads in next 15 mins?',
      minutesRemaining: 2,
    })
    const comp = mk({
      ticker: 'KXCRYPTOCOMP15M-1',
      asset: 'CRYPTO',
      seriesTicker: 'KXCRYPTOCOMP15M',
      midYes: 0.4,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const noStrike = mk({
      ticker: 'KXBTC15M-NOK',
      asset: 'BTC',
      seriesTicker: 'KXBTC15M',
      midYes: 0.4,
      floorStrike: null,
      minutesRemaining: 2,
    })
    const real = mk({
      ticker: 'KXBTC15M-OK',
      asset: 'BTC',
      seriesTicker: 'KXBTC15M',
      midYes: 0.55,
      floorStrike: 100_000,
      minutesRemaining: 10,
    })
    expect(isMmQuoteUniverseMarket(lead)).toBe(false)
    expect(isMmQuoteUniverseMarket(comp)).toBe(false)
    expect(isMmQuoteUniverseMarket(noStrike)).toBe(false)
    expect(isMmQuoteUniverseMarket(real)).toBe(true)

    const ranked = rankMarketsByAbsEdge(
      [lead, comp, noStrike, real],
      { BTC: 100_200, CRYPTO: 1 },
      0.7,
      2,
      now,
      25,
    )
    expect(ranked.every((r) => r.ticker === 'KXBTC15M-OK')).toBe(true)
    expect(ranked).toHaveLength(1)
    const picked = pickActiveMarkets(ranked, { maxActive: 5 })
    expect(picked.map((m) => m.ticker)).toEqual(['KXBTC15M-OK'])
  })

  it('ZEC without ZEC spot → no FV from BTC spot; U3.2 still quoteEligible on mid+L2', () => {
    const zec = mk({
      ticker: 'KXZEC15M-1',
      asset: 'ZEC',
      seriesTicker: 'KXZEC15M',
      midYes: 0.5,
      floorStrike: 40,
      minutesRemaining: 5,
    })
    // Only BTC spot present — must NOT invent FV from $102k vs ZEC strike 40
    const scored = scoreMarketEdge(zec, null, 0.7, 2)
    expect(scored.asset).toBe('ZEC')
    expect(scored.fairValue).toBeNull()
    expect(scored.fvMissingReason).toBe('no_spot')
    // U3.2: mid+L2 eligible regardless of FV
    expect(scored.hasL2).toBe(true)
    expect(scored.quoteEligible).toBe(true)
    expect(scored.absEdgeCents).toBe(0)

    const ranked = rankMarketsByAbsEdge(
      [zec],
      { BTC: 102_000 }, // deliberate contamination attempt
      0.7,
      2,
      now,
    )
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.asset).toBe('ZEC')
    expect(ranked[0]!.spot).toBeNull()
    expect(ranked[0]!.fairValue).toBeNull()
    expect(ranked[0]!.fvMissingReason).toBe('no_spot')
  })

  it('BTC and ZEC do not collapse to same one-per-asset key', () => {
    const btc = mk({
      ticker: 'KXBTC15M-1',
      asset: 'BTC',
      midYes: 0.55,
      floorStrike: 100_000,
      minutesRemaining: 10,
    })
    const zec = mk({
      ticker: 'KXZEC15M-1',
      asset: 'ZEC',
      midYes: 0.55,
      floorStrike: 40,
      minutesRemaining: 10,
    })
    const ranked = rankMarketsByAbsEdge(
      [btc, zec],
      { BTC: 100_200, ZEC: 40.08 },
      0.7,
      2,
      now,
      25,
    )
    expect(ranked.map((r) => r.asset).sort()).toEqual(['BTC', 'ZEC'])
    const picked = pickActiveMarkets(ranked, { maxActive: 2, onePerAsset: true })
    expect(picked).toHaveLength(2)
    expect(new Set(picked.map((m) => m.asset)).size).toBe(2)
  })

  it('ZEC with its own spot scores FV against ZEC strike, not BTC', () => {
    const zec = mk({
      ticker: 'KXZEC15M-OK',
      asset: 'ZEC',
      midYes: 0.5,
      floorStrike: 40,
      minutesRemaining: 5,
    })
    const scored = scoreMarketEdge(zec, 42, 0.7, 2)
    expect(scored.asset).toBe('ZEC')
    expect(scored.spot).toBe(42)
    expect(scored.fairValue).not.toBeNull()
    // Deep ITM vs strike 40 at spot 42 → FV well above 0.5, but not the absurd
    // ~0.99 you get from comparing $102k BTC spot to a $40 ZEC strike.
    expect(scored.fairValue!).toBeGreaterThan(0.5)
    expect(scored.fairValue!).toBeLessThan(0.999)
  })

})

describe('U3.2 SLOT_EVICT (FV sanity telemetry only)', () => {
  const now = Date.parse('2026-09-21T19:50:00.000Z')

  it('does NOT evict sanity+flat — |FV−mid| no longer drives slots', () => {
    const insane = mk({
      ticker: 'BNB-INSANE',
      asset: 'BNB',
      midYes: 0.2,
      floorStrike: 100,
      minutesRemaining: 10,
      closeTime: '2026-09-21T20:00:00.000Z',
    })
    const sane = mk({
      ticker: 'BTC-SANE',
      asset: 'BTC',
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 10,
      closeTime: '2026-09-21T20:01:00.000Z',
    })
    const ranked = rankMarketsByAbsEdge(
      [insane, sane],
      { BNB: 150, BTC: 100.05 },
      0.7,
      2,
      now,
      25,
    )
    const bnb = ranked.find((r) => r.ticker === 'BNB-INSANE')!
    expect(bnb.sanityPark).toBe(true) // telemetry flag may still set

    const picked = pickActiveMarkets(ranked, {
      maxActive: 2,
      stickyTickers: ['BNB-INSANE'],
      inventoryByTicker: { 'BNB-INSANE': 0 },
      requireEdge: true,
      evictSanityFlat: true,
    })
    // Sticky BNB kept — U3.2 does not evict on FV sanity
    expect(picked.some((m) => m.ticker === 'BNB-INSANE')).toBe(true)
  })

  it('sticky inventory book still kept', () => {
    const insane = mk({
      ticker: 'BNB-HOLD',
      asset: 'BNB',
      midYes: 0.2,
      floorStrike: 100,
      minutesRemaining: 10,
      closeTime: '2026-09-21T20:00:00.000Z',
    })
    const ranked = rankMarketsByAbsEdge(
      [insane],
      { BNB: 150 },
      0.7,
      2,
      now,
      25,
    )
    expect(ranked[0]!.sanityPark).toBe(true)

    const picked = pickActiveMarkets(ranked, {
      maxActive: 2,
      stickyTickers: ['BNB-HOLD'],
      inventoryByTicker: { 'BNB-HOLD': 3 },
      requireEdge: true,
      evictSanityFlat: true,
    })
    expect(picked.some((m) => m.ticker === 'BNB-HOLD')).toBe(true)
  })
})
