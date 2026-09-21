/**
 * Decision policy unit tests — explicit quote ON/OFF rules.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  decideQuoteSides,
  DEFAULT_DECISION_POLICY,
  type DecisionPolicyConfig,
  type DecisionPolicyInput,
} from './decisionPolicy'

function baseConfig(partial: Partial<DecisionPolicyConfig> = {}): DecisionPolicyConfig {
  return {
    halfSpreadCents: 2,
    quoteSize: 2,
    maxInventory: 10,
    inventorySkewCentsPerUnit: 0.15,
    guardWidenCents: 4,
    toxicMidLow: 0.05,
    toxicMidHigh: 0.95,
    minEdgeCents: 2.5,
    expiryPullMinutes: 0.5,
    fvQuoting: true,
    sizeDownEdgeMult: DEFAULT_DECISION_POLICY.sizeDownEdgeMult,
    sizeUpEdgeMult: DEFAULT_DECISION_POLICY.sizeUpEdgeMult,
    ...partial,
  }
}

function baseInput(partial: Partial<DecisionPolicyInput> = {}): DecisionPolicyInput {
  return {
    mid: 0.5,
    fairValue: 0.6,
    edgeCents: 10,
    inventory: 0,
    bookBestBid: 0.48,
    bookBestAsk: 0.52,
    minutesRemaining: 8,
    running: true,
    settled: false,
    moneyPrinterBug: false,
    spotGuardCancel: false,
    guardWiden: false,
    toxicBidPullUntil: 0,
    toxicAskPullUntil: 0,
    now: 1_000_000,
    config: baseConfig(),
    ...partial,
  }
}

describe('decisionPolicy', () => {
  it('FV ≫ mid → bid ON, ask OFF', () => {
    const d = decideQuoteSides(
      baseInput({ fairValue: 0.7, mid: 0.4, edgeCents: 30 }),
    )
    expect(d.bidActive).toBe(true)
    expect(d.askActive).toBe(false)
    expect(d.bidReason).toMatch(/bid ON:.*FV−mid=\+/)
    expect(d.askReason.toLowerCase()).toMatch(/no edge/)
    expect(d.centerMode).toBe('fv')
  })

  it('FV ≪ mid → ask ON, bid OFF', () => {
    const d = decideQuoteSides(
      baseInput({ fairValue: 0.3, mid: 0.6, edgeCents: -30 }),
    )
    expect(d.askActive).toBe(true)
    expect(d.bidActive).toBe(false)
    expect(d.askReason).toMatch(/ask ON:.*FV−mid=-/)
    expect(d.bidReason.toLowerCase()).toMatch(/no edge/)
  })

  it('no edge → both OFF', () => {
    const d = decideQuoteSides(
      baseInput({ fairValue: 0.5, mid: 0.5, edgeCents: 0.5 }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toMatch(/no edge/i)
  })

  it('expiry pull → both OFF', () => {
    const d = decideQuoteSides(baseInput({ minutesRemaining: 0.2, edgeCents: 20 }))
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toMatch(/expiry pull/i)
  })

  it('toxic mid → bid OFF at extreme low', () => {
    const d = decideQuoteSides(
      baseInput({ mid: 0.02, fairValue: 0.8, edgeCents: 78 }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.bidReason.toLowerCase()).toMatch(/toxic/)
  })

  it('invalid mid → both OFF', () => {
    const d = decideQuoteSides(baseInput({ mid: 0, fairValue: 0.6, edgeCents: null }))
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toMatch(/invalid mid/i)
  })

  it('FV mode with no FV → both OFF (no mid spam)', () => {
    const d = decideQuoteSides(
      baseInput({ fairValue: null, edgeCents: null, mid: 0.5 }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toMatch(/no FV/i)
  })

  it('incoherent book spread → both OFF', () => {
    const d = decideQuoteSides(
      baseInput({ bookBestBid: 0.55, bookBestAsk: 0.5, edgeCents: 20 }),
    )
    expect(d.active).toBe(false)
    expect(d.bothOffReason).toMatch(/incoherent/i)
  })

  it('spot guard cancel → both OFF', () => {
    const d = decideQuoteSides(baseInput({ spotGuardCancel: true, edgeCents: 20 }))
    expect(d.bothOffReason).toMatch(/spot guard/i)
  })

  it('inventory long suppresses bid harder', () => {
    const flat = decideQuoteSides(baseInput({ inventory: 0, edgeCents: 3 }))
    const long = decideQuoteSides(baseInput({ inventory: 8, edgeCents: 3 }))
    expect(flat.bidActive).toBe(true)
    expect(long.bidActive).toBe(false)
    expect(long.bidReason.toLowerCase()).toMatch(/inventory/)
  })

  it('sizes down when |edge| small, up when large', () => {
    const small = decideQuoteSides(baseInput({ edgeCents: 2.6 }))
    const large = decideQuoteSides(baseInput({ edgeCents: 20 }))
    expect(small.size).toBeLessThanOrEqual(large.size)
    expect(large.size).toBeGreaterThanOrEqual(2)
    expect(large.size).toBeLessThanOrEqual(10)
  })

  it('toxic fill pull parks that side', () => {
    const d = decideQuoteSides(
      baseInput({
        edgeCents: 20,
        toxicBidPullUntil: 1_000_000 + 5000,
        now: 1_000_000,
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.bidReason.toLowerCase()).toMatch(/toxic fill/)
    expect(d.askActive).toBe(false) // edge is +20 so ask already off
  })

  it('live feed down reason parks both', () => {
    const d = decideQuoteSides(baseInput({ feedDownReason: 'live feed down', edgeCents: 20 }))
    expect(d.bothOffReason).toBe('live feed down')
  })
})
