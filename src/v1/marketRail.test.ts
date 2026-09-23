import { describe, expect, it } from 'vitest'
import { fmtMmInvHint, sortMarketsForRail } from './marketRail'

describe('sortMarketsForRail', () => {
  const markets = [
    { ticker: 'A' },
    { ticker: 'B' },
    { ticker: 'C' },
    { ticker: 'D' },
  ]

  it('returns a copy in feed order when quoted set is empty', () => {
    const out = sortMarketsForRail(markets, new Set())
    expect(out.map((m) => m.ticker)).toEqual(['A', 'B', 'C', 'D'])
    expect(out).not.toBe(markets)
  })

  it('floats quoted tickers first, stable within groups', () => {
    const out = sortMarketsForRail(markets, new Set(['C', 'A']))
    expect(out.map((m) => m.ticker)).toEqual(['A', 'C', 'B', 'D'])
  })

  it('preserves relative order among quoted and among rest', () => {
    const out = sortMarketsForRail(markets, new Set(['D', 'B']))
    expect(out.map((m) => m.ticker)).toEqual(['B', 'D', 'A', 'C'])
  })

  it('leaves order unchanged when no tickers match', () => {
    const out = sortMarketsForRail(markets, new Set(['Z']))
    expect(out.map((m) => m.ticker)).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('fmtMmInvHint', () => {
  it('formats signed inventory', () => {
    expect(fmtMmInvHint(2)).toBe('Inv +2')
    expect(fmtMmInvHint(-1)).toBe('Inv -1')
    expect(fmtMmInvHint(0)).toBe('Inv 0')
  })
})
