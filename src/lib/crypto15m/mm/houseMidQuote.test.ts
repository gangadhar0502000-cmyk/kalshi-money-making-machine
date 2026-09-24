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
  aggressiveFlattenPrices,
  U321_STUCK_NO_BID,
  U321_STUCK_NO_ASK,
  isFlattenHouseTag,
  toHouseFillTag,
  U323_NO_LATE_OPENS,
  U323_LONG_OPEN_CURB,
  DEFAULT_LONG_OPEN_MIN_MID,
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


describe('U3.2.1 aggressiveFlattenPrices', () => {
  it('long hits best bid (not maker ask above touch)', () => {
    const r = aggressiveFlattenPrices({
      inventory: 1,
      yesBid: 0.01,
      yesAsk: 0.03,
      bookBestBid: 0.01,
      bookBestAsk: 0.02,
      quoteClampEpsilon: 0.01,
    })
    expect(r.stuckReason).toBeNull()
    expect(r.yesAsk).toBeCloseTo(0.01, 5)
    expect(r.yesAsk).toBeLessThanOrEqual(0.01 + 1e-9)
  })

  it('long with no bid → stuck fail-loud', () => {
    const r = aggressiveFlattenPrices({
      inventory: 1,
      yesBid: 0.01,
      yesAsk: 0.02,
      bookBestBid: null,
      bookBestAsk: 0.02,
      quoteClampEpsilon: 0.01,
    })
    expect(r.stuckReason).toBe(U321_STUCK_NO_BID)
  })

  it('short lifts best ask', () => {
    const r = aggressiveFlattenPrices({
      inventory: -1,
      yesBid: 0.97,
      yesAsk: 0.99,
      bookBestBid: 0.98,
      bookBestAsk: 0.99,
      quoteClampEpsilon: 0.01,
    })
    expect(r.stuckReason).toBeNull()
    expect(r.yesBid).toBeCloseTo(0.99, 5)
  })

  it('isFlattenHouseTag', () => {
    expect(isFlattenHouseTag('flatten')).toBe(true)
    expect(isFlattenHouseTag('blackout_flatten')).toBe(true)
    expect(isFlattenHouseTag('house_soft_exit')).toBe(true)
    expect(isFlattenHouseTag('house_mid')).toBe(false)
  })
})


describe('U3.2.3 house fill tags', () => {
  it('maps leftover S* to house tags', () => {
    expect(toHouseFillTag('S3')).toBe('house_cover')
    expect(toHouseFillTag('S4')).toBe('house_close')
    expect(U323_NO_LATE_OPENS).toMatch(/hardFlat/)
    expect(U323_LONG_OPEN_CURB).toMatch(/U3\.2\.5.*50¢|long open curb/)
    expect(DEFAULT_LONG_OPEN_MIN_MID).toBe(0.5)
  })
})
