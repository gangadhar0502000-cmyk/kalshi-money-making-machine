/**
 * U3.1 Family E — digital FV helpers (skew, clamp, side arms).
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { estimateYesFairValue } from './fairValue'
import {
  U31_BLACKOUT,
  clampProbEps,
  familyEQuotePrices,
  familyEReservation,
  familyESideArms,
  familyESkewCents,
} from './digitalFvQuote'
import { clampQuotesMakerOnly } from './decisionPolicy'

describe('Family E FV monotonic in S vs K', () => {
  it('N(d2) rises when spot rises above strike', () => {
    const below = estimateYesFairValue({
      spot: 95_000,
      strike: 100_000,
      minutesRemaining: 8,
      annualVol: 0.7,
    })
    const atm = estimateYesFairValue({
      spot: 100_000,
      strike: 100_000,
      minutesRemaining: 8,
      annualVol: 0.7,
    })
    const above = estimateYesFairValue({
      spot: 105_000,
      strike: 100_000,
      minutesRemaining: 8,
      annualVol: 0.7,
    })
    expect(below!.fairProb).toBeLessThan(atm!.fairProb)
    expect(atm!.fairProb).toBeLessThan(above!.fairProb)
  })
})

describe('familyESkew / reservation', () => {
  it('long inventory lowers reservation; skew grows as τ→0', () => {
    const far = familyESkewCents(5, 10, {
      inventorySkewCentsPerUnit: 0.15,
      hardFlatMinutes: 2,
      tauSkewAccel: 1,
    })
    const near = familyESkewCents(5, 0.5, {
      inventorySkewCentsPerUnit: 0.15,
      hardFlatMinutes: 2,
      tauSkewAccel: 1,
    })
    expect(near).toBeGreaterThan(far)
    const { reservation } = familyEReservation(0.55, 5, 10, {
      inventorySkewCentsPerUnit: 0.15,
      hardFlatMinutes: 2,
      tauSkewAccel: 1,
    })
    expect(reservation).toBeLessThan(0.55)
  })
})

describe('clampProbEps', () => {
  it('clamps to (ε, 1−ε)', () => {
    expect(clampProbEps(-1, 0.02)).toBeCloseTo(0.02, 5)
    expect(clampProbEps(2, 0.02)).toBeCloseTo(0.98, 5)
    expect(clampProbEps(0.5, 0.02)).toBeCloseTo(0.5, 5)
  })
})

describe('familyEQuotePrices', () => {
  it('posts bid/ask around reservation within clamp', () => {
    const q = familyEQuotePrices({
      fairValue: 0.5,
      inventory: 0,
      minutesRemaining: 8,
      halfSpreadCents: 2,
      inventorySkewCentsPerUnit: 0.15,
      hardFlatMinutes: 2,
      tauSkewAccel: 1,
      quoteClampEpsilon: 0.01,
      bookBestBid: 0.48,
      bookBestAsk: 0.52,
      makerOnly: true,
      clampQuotesMakerOnly,
    })
    expect(q.yesBid).toBeGreaterThanOrEqual(0.01)
    expect(q.yesAsk).toBeLessThanOrEqual(0.99)
    expect(q.yesAsk).toBeGreaterThan(q.yesBid)
  })
})

describe('familyESideArms', () => {
  it('blackout is caller-side; flatten only reduces', () => {
    const flatLong = familyESideArms({
      inventory: 3,
      maxInventory: 10,
      minutesRemaining: 1,
      hardFlatMinutes: 2,
    })
    expect(flatLong.bidActive).toBe(false)
    expect(flatLong.askActive).toBe(true)
    expect(flatLong.tag).toBe('flatten')
    expect(flatLong.unwindActive).toBe(true)

    const flatShort = familyESideArms({
      inventory: -2,
      maxInventory: 10,
      minutesRemaining: 1,
      hardFlatMinutes: 2,
    })
    expect(flatShort.bidActive).toBe(true)
    expect(flatShort.askActive).toBe(false)

    const maxLong = familyESideArms({
      inventory: 10,
      maxInventory: 10,
      minutesRemaining: 8,
      hardFlatMinutes: 2,
    })
    expect(maxLong.bidActive).toBe(false)
    expect(maxLong.askActive).toBe(true)
    expect(maxLong.tag).toBe('max_inv')
  })

  it('exports blackout constant', () => {
    expect(U31_BLACKOUT).toMatch(/settlement blackout/)
  })
})
