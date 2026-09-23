/**
 * U3.2 House mid quote helpers.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { clampQuotesMakerOnly } from './decisionPolicy'
import {
  U32_HOUSE_MID,
  U32_NO_MID,
  houseMidQuotePrices,
  houseReservation,
  midQualityScore,
} from './houseMidQuote'

describe('houseMidQuotePrices', () => {
  it('centers near mid when FV would be far (mid 0.05, not near 0.25)', () => {
    const q = houseMidQuotePrices({
      mid: 0.05,
      inventory: 0,
      minutesRemaining: 8,
      halfSpreadCents: 2,
      inventorySkewCentsPerUnit: 0.15,
      hardFlatMinutes: 2,
      tauSkewAccel: 1,
      quoteClampEpsilon: 0.01,
      bookBestBid: 0.04,
      bookBestAsk: 0.06,
      makerOnly: true,
      clampQuotesMakerOnly,
    })
    // Around mid 0.05 ± 2¢ → ~0.03–0.07 (maker may join BBO)
    expect(q.reservation).toBeCloseTo(0.05, 5)
    expect(q.yesBid).toBeLessThan(0.12)
    expect(q.yesAsk).toBeLessThan(0.15)
    expect(q.yesBid).toBeGreaterThanOrEqual(0.01)
    // Must NOT sit near a hypothetical FV of 0.25
    expect(Math.abs((q.yesBid + q.yesAsk) / 2 - 0.25)).toBeGreaterThan(0.1)
    expect(Math.abs((q.yesBid + q.yesAsk) / 2 - 0.05)).toBeLessThan(0.05)
  })

  it('long inventory lowers reservation below mid', () => {
    const { reservation, skewCents } = houseReservation(0.5, 5, 10, {
      inventorySkewCentsPerUnit: 0.15,
      hardFlatMinutes: 2,
      tauSkewAccel: 1,
    })
    expect(skewCents).toBeGreaterThan(0)
    expect(reservation).toBeLessThan(0.5)
  })

  it('exports fail-loud constants', () => {
    expect(U32_HOUSE_MID).toMatch(/house mid/)
    expect(U32_NO_MID).toMatch(/no mid/)
  })
})

describe('midQualityScore', () => {
  it('prefers mid near 0.5 over near toxic extremes', () => {
    expect(midQualityScore(0.5)).toBeGreaterThan(midQualityScore(0.1))
    expect(midQualityScore(0.5)).toBeGreaterThan(midQualityScore(0.9))
  })
})
