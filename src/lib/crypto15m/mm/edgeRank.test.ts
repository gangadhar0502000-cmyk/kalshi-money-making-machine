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

  it('ranks higher |edge| markets first', () => {
    const btc = mk({
      ticker: 'BTC-HI',
      asset: 'BTC',
      midYes: 0.4,
      floorStrike: 100_000,
      minutesRemaining: 2,
      closeTime: '2026-09-21T20:00:00.000Z',
    })
    const eth = mk({
      ticker: 'ETH-LO',
      asset: 'ETH',
      midYes: 0.5,
      floorStrike: 3_000,
      minutesRemaining: 10,
      closeTime: '2026-09-21T20:05:00.000Z',
    })
    // BTC deep ITM → large |edge|; ETH ATM-ish → small
    const ranked = rankMarketsByAbsEdge(
      [eth, btc],
      { BTC: 102_000, ETH: 3_000 },
      0.7,
      2,
      now,
    )
    expect(ranked[0]!.ticker).toBe('BTC-HI')
    expect(ranked[0]!.absEdgeCents).toBeGreaterThan(ranked[1]!.absEdgeCents)
    expect(ranked[0]!.quoteEligible).toBe(true)
  })

  it('enforces maxActiveMarkets cap', () => {
    const markets = ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'BNB'].map((asset, i) =>
      mk({
        ticker: `${asset}-T`,
        asset,
        midYes: 0.4,
        floorStrike: 100,
        minutesRemaining: 2,
        closeTime: `2026-09-21T20:0${i}:00.000Z`,
      }),
    )
    // All deep ITM with spot 120 vs strike 100
    const spots = Object.fromEntries(markets.map((m) => [m.asset, 120]))
    const ranked = rankMarketsByAbsEdge(markets, spots, 0.7, 2, now)
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
      mk({ ticker: 'A', asset: 'BTC', midYes: 0.45, floorStrike: 100, minutesRemaining: 2 }),
      mk({ ticker: 'B', asset: 'ETH', midYes: 0.45, floorStrike: 100, minutesRemaining: 2 }),
      mk({ ticker: 'C', asset: 'SOL', midYes: 0.45, floorStrike: 100, minutesRemaining: 2 }),
    ]
    const spots = { BTC: 120, ETH: 120, SOL: 120 }
    const ranked = rankMarketsByAbsEdge(markets, spots, 0.7, 2, now)
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
      midYes: 0.4,
      floorStrike: 100_000,
      minutesRemaining: 2,
    })
    expect(isMmQuoteUniverseMarket(lead)).toBe(false)
    expect(isMmQuoteUniverseMarket(comp)).toBe(false)
    expect(isMmQuoteUniverseMarket(noStrike)).toBe(false)
    expect(isMmQuoteUniverseMarket(real)).toBe(true)

    const ranked = rankMarketsByAbsEdge(
      [lead, comp, noStrike, real],
      { BTC: 102_000, CRYPTO: 1 },
      0.7,
      2,
      now,
    )
    expect(ranked.every((r) => r.ticker === 'KXBTC15M-OK')).toBe(true)
    expect(ranked).toHaveLength(1)
    const picked = pickActiveMarkets(ranked, { maxActive: 5 })
    expect(picked.map((m) => m.ticker)).toEqual(['KXBTC15M-OK'])
  })
})
