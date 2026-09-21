/**
 * Pure unit tests for spot/strike FV model.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { edgeVsMidCents, normCdf, estimateYesFairValue } from './fairValue'

describe('normCdf', () => {
  it('is ~0.5 at 0 and monotone', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 5)
    expect(normCdf(-2)).toBeLessThan(normCdf(0))
    expect(normCdf(2)).toBeGreaterThan(normCdf(0))
  })
})

describe('estimateYesFairValue', () => {
  it('returns low FV when spot is below strike late in the window', () => {
    const est = estimateYesFairValue({
      spot: 95_000,
      strike: 100_000,
      minutesRemaining: 1,
      annualVol: 0.7,
    })
    expect(est).not.toBeNull()
    expect(est!.fairProb).toBeLessThan(0.2)
  })

  it('returns high FV when spot is above strike late in the window', () => {
    const est = estimateYesFairValue({
      spot: 105_000,
      strike: 100_000,
      minutesRemaining: 1,
      annualVol: 0.7,
    })
    expect(est).not.toBeNull()
    expect(est!.fairProb).toBeGreaterThan(0.8)
  })

  it('approaches a step at T→0', () => {
    const above = estimateYesFairValue({
      spot: 100_001,
      strike: 100_000,
      minutesRemaining: 0,
      annualVol: 0.7,
    })
    const below = estimateYesFairValue({
      spot: 99_999,
      strike: 100_000,
      minutesRemaining: 0,
      annualVol: 0.7,
    })
    expect(above!.fairProb).toBe(0.99)
    expect(below!.fairProb).toBe(0.01)
  })

  it('is nearer 0.5 when ATM with time left', () => {
    const est = estimateYesFairValue({
      spot: 100_000,
      strike: 100_000,
      minutesRemaining: 10,
      annualVol: 0.7,
    })
    expect(est!.fairProb).toBeCloseTo(0.5, 2)
  })

  it('returns null for invalid inputs', () => {
    expect(
      estimateYesFairValue({
        spot: 0,
        strike: 100,
        minutesRemaining: 5,
        annualVol: 0.7,
      }),
    ).toBeNull()
  })
})

describe('edgeVsMidCents', () => {
  it('is positive when FV above mid', () => {
    expect(edgeVsMidCents(0.6, 0.5)).toBeCloseTo(10, 6)
  })
})
