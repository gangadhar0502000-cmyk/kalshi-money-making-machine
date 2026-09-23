import { describe, expect, it } from 'vitest'
import type { Crypto15mMarket } from '../../types/crypto15m'
import {
  bookHasTwoSidedTouch,
  marketForQuoteBook,
  resolveQuoteBook,
} from './quoteBook'

function m(
  over: Partial<
    Pick<
      Crypto15mMarket,
      | 'yesBid'
      | 'yesAsk'
      | 'noBid'
      | 'noAsk'
      | 'midYes'
      | 'spreadCents'
      | 'ticker'
      | 'asset'
    >
  > = {},
): Crypto15mMarket {
  return {
    ticker: 'KXBTC15M-DEMO',
    eventTicker: 'KXBTC15M',
    seriesTicker: 'KXBTC15M',
    asset: 'BTC',
    title: 'BTC demo',
    status: 'active',
    openTime: null,
    closeTime: new Date(Date.now() + 600_000).toISOString(),
    yesBid: 0.48,
    yesAsk: 0.52,
    noBid: 0.48,
    noAsk: 0.52,
    midYes: 0.5,
    spreadCents: 4,
    last: 0.5,
    volume: 10,
    volume24h: 10,
    openInterest: 10,
    yesBidSize: 5,
    yesAskSize: 5,
    floorStrike: 100_000,
    rulesPrimary: '',
    kalshiUrl: '',
    windowMinutes: 15,
    minutesElapsed: 5,
    minutesRemaining: 10,
    feeEstimate1: 0,
    thinBook: false,
    raw: {} as Crypto15mMarket['raw'],
    ...over,
  }
}

describe('bookHasTwoSidedTouch', () => {
  it('YES requires both yesBid and yesAsk > 0', () => {
    expect(bookHasTwoSidedTouch(m(), 'YES')).toBe(true)
    expect(bookHasTwoSidedTouch(m({ yesBid: 0 }), 'YES')).toBe(false)
    expect(bookHasTwoSidedTouch(m({ yesAsk: 0 }), 'YES')).toBe(false)
  })

  it('NO requires both noBid and noAsk > 0', () => {
    expect(bookHasTwoSidedTouch(m(), 'NO')).toBe(true)
    expect(bookHasTwoSidedTouch(m({ noBid: 0 }), 'NO')).toBe(false)
  })
})

describe('resolveQuoteBook', () => {
  it('picks YES when hint is YES (tighter YES spread)', () => {
    const market = m({
      yesBid: 0.49,
      yesAsk: 0.51,
      spreadCents: 2,
      noBid: 0.4,
      noAsk: 0.6,
    })
    const r = resolveQuoteBook(market, null, 0)
    expect(r).toEqual({ book: 'YES', switched: false, error: null })
  })

  it('picks NO when hint is NO (tighter NO spread)', () => {
    const market = m({
      yesBid: 0.4,
      yesAsk: 0.6,
      spreadCents: 20,
      noBid: 0.49,
      noAsk: 0.51,
    })
    const r = resolveQuoteBook(market, null, 0)
    expect(r).toEqual({ book: 'NO', switched: false, error: null })
  })

  it('TIE defaults to sticky ?? YES', () => {
    const market = m() // equal 4¢ spreads → TIE
    expect(resolveQuoteBook(market, null, 0).book).toBe('YES')
    expect(resolveQuoteBook(market, 'NO', 0).book).toBe('NO')
  })

  it('keeps sticky while |inventory| >= 1 even if hint flips', () => {
    const market = m({
      yesBid: 0.4,
      yesAsk: 0.6,
      spreadCents: 20,
      noBid: 0.49,
      noAsk: 0.51,
    })
    const r = resolveQuoteBook(market, 'YES', 2)
    expect(r).toEqual({ book: 'YES', switched: false, error: null })
  })

  it('falls back to other book when preferred is one-sided', () => {
    // YES one-sided, NO two-sided → prefer YES fails → NO
    const market = m({
      yesBid: 0.5,
      yesAsk: 0,
      spreadCents: Number.POSITIVE_INFINITY,
      noBid: 0.48,
      noAsk: 0.52,
    })
    const r = resolveQuoteBook(market, null, 0)
    expect(r.book).toBe('NO')
    expect(r.error).toBeNull()
  })

  it('fail-loud when preferred one-sided and no two-sided fallback', () => {
    const market = m({
      yesBid: 0.5,
      yesAsk: 0,
      noBid: 0.4,
      noAsk: 0,
      spreadCents: Number.POSITIVE_INFINITY,
    })
    const r = resolveQuoteBook(market, null, 0)
    expect(r.error).toEqual({
      message: 'YES book one-sided',
      dependency: 'two-sided YES and NO touch on feed',
    })
    expect(r.book).toBe('YES') // any-touch preferred
  })

  it('marks switched when flat and book changes from sticky', () => {
    const market = m({
      yesBid: 0.4,
      yesAsk: 0.6,
      spreadCents: 20,
      noBid: 0.49,
      noAsk: 0.51,
    })
    const r = resolveQuoteBook(market, 'YES', 0)
    expect(r.book).toBe('NO')
    expect(r.switched).toBe(true)
  })
})

describe('marketForQuoteBook', () => {
  it('YES returns same reference', () => {
    const market = m()
    expect(marketForQuoteBook(market, 'YES')).toBe(market)
  })

  it('NO swaps touch into yesBid/yesAsk/midYes/spreadCents', () => {
    const market = m({
      yesBid: 0.4,
      yesAsk: 0.6,
      midYes: 0.5,
      spreadCents: 20,
      noBid: 0.49,
      noAsk: 0.51,
      ticker: 'KXETH-1',
      asset: 'ETH',
      floorStrike: 3_000,
    })
    const out = marketForQuoteBook(market, 'NO')
    expect(out.yesBid).toBe(0.49)
    expect(out.yesAsk).toBe(0.51)
    expect(out.midYes).toBeCloseTo(0.5)
    expect(out.spreadCents).toBeCloseTo(2)
    expect(out.ticker).toBe('KXETH-1')
    expect(out.asset).toBe('ETH')
    expect(out.floorStrike).toBe(3_000)
    expect(out.noBid).toBe(0.49)
    expect(out.noAsk).toBe(0.51)
  })
})
