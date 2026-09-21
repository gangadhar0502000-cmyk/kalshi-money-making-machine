/**
 * Spot asset normalization — never default unknown → BTC.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractAsset } from './detect'
import {
  canonicalMmAsset,
  fetchPublicSpot,
  isSpotSupported,
  normalizeSpotAsset,
} from './spot'

describe('normalizeSpotAsset / canonicalMmAsset', () => {
  it('normalizeSpotAsset(ZEC) !== BTC and is supported', () => {
    expect(normalizeSpotAsset('ZEC')).toBe('ZEC')
    expect(normalizeSpotAsset('ZEC')).not.toBe('BTC')
    expect(isSpotSupported('ZEC')).toBe(true)
  })

  it('unknown / foreign assets → null (never BTC)', () => {
    expect(normalizeSpotAsset('NOTACOIN')).toBeNull()
    expect(normalizeSpotAsset('PEPE')).toBeNull()
    expect(normalizeSpotAsset('CRYPTO')).toBeNull()
    expect(normalizeSpotAsset('')).toBeNull()
    expect(isSpotSupported('NOTACOIN')).toBe(false)
  })

  it('aliases map to real symbols without inventing BTC for alts', () => {
    expect(normalizeSpotAsset('BITCOIN')).toBe('BTC')
    expect(normalizeSpotAsset('ETHEREUM')).toBe('ETH')
    expect(normalizeSpotAsset('ZCASH')).toBe('ZEC')
    expect(canonicalMmAsset('ZCASH')).toBe('ZEC')
    expect(canonicalMmAsset('HYPE')).toBe('HYPE')
    expect(canonicalMmAsset('NEAR')).toBe('NEAR')
  })

  it('BTC and ZEC cannot collapse to the same spot key', () => {
    expect(normalizeSpotAsset('BTC')).toBe('BTC')
    expect(normalizeSpotAsset('ZEC')).toBe('ZEC')
    expect(normalizeSpotAsset('BTC')).not.toBe(normalizeSpotAsset('ZEC'))
    expect(canonicalMmAsset('BTC')).not.toBe(canonicalMmAsset('ZEC'))
  })

  it('NEAR / HYPE / TON are spot-supported and distinct from BTC', () => {
    for (const a of ['NEAR', 'HYPE', 'TON'] as const) {
      expect(normalizeSpotAsset(a)).toBe(a)
      expect(normalizeSpotAsset(a)).not.toBe('BTC')
    }
  })
})

describe('extractAsset series codes', () => {
  it("extractAsset('KXZEC15M-...') === 'ZEC'", () => {
    expect(extractAsset('KXZEC15M-26SEP211800')).toBe('ZEC')
    expect(extractAsset('KXHYPE15M-26SEP211800')).toBe('HYPE')
    expect(extractAsset('KXNEAR15M-26SEP211800')).toBe('NEAR')
    expect(extractAsset('KXBTC15M-26SEP211800')).toBe('BTC')
  })
})

describe('fetchPublicSpot fail-closed', () => {
  it('rejects unsupported assets (no demo BTC walk)', async () => {
    await expect(fetchPublicSpot('NOTACOIN')).rejects.toThrow(/unsupported spot asset/i)
    await expect(fetchPublicSpot('PEPE')).rejects.toThrow(/unsupported spot asset/i)
  })
})
