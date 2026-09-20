import { describe, expect, it } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { isMarketOpen, pickBestOpenMarket, pickRollTarget } from './marketSelect'

function mk(
  partial: Partial<Crypto15mMarket> & Pick<Crypto15mMarket, 'ticker' | 'asset' | 'closeTime'>,
): Crypto15mMarket {
  return {
    eventTicker: partial.eventTicker ?? partial.ticker,
    seriesTicker: partial.seriesTicker ?? 'KXBTC15M',
    title: partial.title ?? 'test',
    status: partial.status ?? 'active',
    openTime: partial.openTime ?? null,
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
    floorStrike: null,
    rulesPrimary: '',
    kalshiUrl: '',
    windowMinutes: 15,
    minutesElapsed: partial.minutesElapsed ?? 5,
    minutesRemaining: partial.minutesRemaining ?? 10,
    feeEstimate1: 0,
    thinBook: false,
    raw: {} as Crypto15mMarket['raw'],
    ...partial,
  }
}

describe('marketSelect auto-roll', () => {
  const now = Date.parse('2026-09-20T03:45:00.000Z')

  it('rolls when current is closed/expired and a new open 15m appears', () => {
    const dead = mk({
      ticker: 'KXBTC15M-OLD',
      asset: 'BTC',
      status: 'closed',
      closeTime: '2026-09-20T03:45:00.000Z',
      minutesRemaining: 0,
    })
    const next = mk({
      ticker: 'KXBTC15M-NEW',
      asset: 'BTC',
      status: 'active',
      closeTime: '2026-09-20T04:00:00.000Z',
      minutesRemaining: 15,
    })
    const target = pickRollTarget([dead, next], dead, now)
    expect(target?.ticker).toBe('KXBTC15M-NEW')
  })

  it('rolls to newer same-asset window while old still briefly open', () => {
    const older = mk({
      ticker: 'KXBTC15M-A',
      asset: 'BTC',
      closeTime: '2026-09-20T03:50:00.000Z',
      minutesRemaining: 5,
    })
    const newer = mk({
      ticker: 'KXBTC15M-B',
      asset: 'BTC',
      closeTime: '2026-09-20T04:05:00.000Z',
      minutesRemaining: 20,
    })
    const target = pickRollTarget([older, newer], older, now)
    expect(target?.ticker).toBe('KXBTC15M-B')
  })

  it('does not roll when current is the best open market', () => {
    const cur = mk({
      ticker: 'KXBTC15M-ONLY',
      asset: 'BTC',
      closeTime: '2026-09-20T04:00:00.000Z',
      minutesRemaining: 15,
    })
    expect(pickRollTarget([cur], cur, now)).toBeNull()
    expect(isMarketOpen(cur, now)).toBe(true)
    expect(pickBestOpenMarket([cur], 'BTC', now)?.ticker).toBe('KXBTC15M-ONLY')
  })

  it('prefers same underlying over other assets', () => {
    const deadBtc = mk({
      ticker: 'KXBTC15M-OLD',
      asset: 'BTC',
      status: 'settled',
      closeTime: '2026-09-20T03:45:00.000Z',
      minutesRemaining: -1,
    })
    const eth = mk({
      ticker: 'KXETH15M-NEW',
      asset: 'ETH',
      closeTime: '2026-09-20T04:00:00.000Z',
      minutesRemaining: 15,
    })
    const btc = mk({
      ticker: 'KXBTC15M-NEW',
      asset: 'BTC',
      closeTime: '2026-09-20T03:55:00.000Z',
      minutesRemaining: 10,
    })
    expect(pickRollTarget([eth, btc], deadBtc, now)?.ticker).toBe('KXBTC15M-NEW')
  })
})
