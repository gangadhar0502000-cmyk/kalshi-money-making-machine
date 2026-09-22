import { describe, expect, it } from 'vitest'
import { pickMmUniverse } from './mmMarketFeed'
import type { Crypto15mMarket } from '../../../types/crypto15m'

function m(ticker: string): Crypto15mMarket {
  return { ticker } as Crypto15mMarket
}

describe('pickMmUniverse', () => {
  it('uses Lab fallback only when MM poll has never succeeded (null)', () => {
    const lab = [m('LAB-1')]
    expect(pickMmUniverse(null, lab)).toEqual(lab)
  })

  it('prefers MM-owned list after first success (even if empty)', () => {
    const lab = [m('LAB-1')]
    expect(pickMmUniverse([], lab)).toEqual([])
    expect(pickMmUniverse([m('MM-1')], lab)).toEqual([m('MM-1')])
  })
})
