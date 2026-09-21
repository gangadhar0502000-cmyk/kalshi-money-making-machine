/**
 * Decision policy unit tests — explicit quote ON/OFF rules + inventory unwind.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canAcceptInventoryIncreasingFill,
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
    unwindThreshold: DEFAULT_DECISION_POLICY.unwindThreshold,
    maxSaneEdgeCents: DEFAULT_DECISION_POLICY.maxSaneEdgeCents,
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
      baseInput({ fairValue: 0.65, mid: 0.45, edgeCents: 20 }),
    )
    expect(d.bidActive).toBe(true)
    expect(d.askActive).toBe(false)
    expect(d.bidReason).toMatch(/bid ON:.*FV−mid=\+/)
    expect(d.askReason.toLowerCase()).toMatch(/no edge/)
    expect(d.centerMode).toBe('fv')
  })

  it('FV ≪ mid → ask ON, bid OFF', () => {
    const d = decideQuoteSides(
      baseInput({ fairValue: 0.35, mid: 0.55, edgeCents: -20 }),
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
    // Keep |edge| under sanity cap so toxic mid is the decisive gate
    const d = decideQuoteSides(
      baseInput({
        mid: 0.02,
        fairValue: 0.2,
        edgeCents: 18,
        config: baseConfig({ maxSaneEdgeCents: 50 }),
      }),
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
    // Long ≥ unwindThreshold → bid off (unwind-only or skew); ask must be ON for unwind
    expect(long.askActive).toBe(true)
    expect(long.askReason.toLowerCase()).toMatch(/unwind/)
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

  // ---- Advanced: inventory unwind priority (the IDLE-with-inventory bug) ----

  it('long at maxInventory + FV≫mid → ask ON unwind, bid OFF; not both idle', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 10,
        fairValue: 0.7,
        mid: 0.45,
        edgeCents: 25,
        config: baseConfig({ maxInventory: 10, unwindThreshold: 1, maxSaneEdgeCents: 30 }),
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(true)
    expect(d.askReason.toLowerCase()).toMatch(/inventory unwind/)
    expect(d.bidReason.toLowerCase()).toMatch(/max inventory|unwind-only/)
    expect(d.active).toBe(true)
    expect(d.unwindActive).toBe(true)
    expect(d.size).toBeLessThanOrEqual(10)
  })

  it('short at −max + FV≪mid → bid ON unwind', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: -10,
        fairValue: 0.3,
        mid: 0.55,
        edgeCents: -25,
        config: baseConfig({ maxInventory: 10, unwindThreshold: 1, maxSaneEdgeCents: 30 }),
      }),
    )
    expect(d.askActive).toBe(false)
    expect(d.bidActive).toBe(true)
    expect(d.bidReason.toLowerCase()).toMatch(/inventory unwind/)
    expect(d.active).toBe(true)
    expect(d.unwindActive).toBe(true)
  })

  it('flat + edge +6 → bid ON ask OFF', () => {
    const d = decideQuoteSides(
      baseInput({ inventory: 0, fairValue: 0.56, mid: 0.5, edgeCents: 6 }),
    )
    expect(d.bidActive).toBe(true)
    expect(d.askActive).toBe(false)
    expect(d.bidReason).toMatch(/bid ON:/)
  })

  it('|edge| 95 with mid≈0.01 → sanity park (unless unwind)', () => {
    const parked = decideQuoteSides(
      baseInput({
        inventory: 0,
        mid: 0.01,
        fairValue: 0.96,
        edgeCents: 95,
      }),
    )
    expect(parked.bidActive).toBe(false)
    expect(parked.askActive).toBe(false)
    expect(parked.bothOffReason).toMatch(/edge sanity/i)

    const unwind = decideQuoteSides(
      baseInput({
        inventory: 10,
        mid: 0.2,
        fairValue: 0.96,
        edgeCents: 76,
        bookBestBid: 0.18,
        bookBestAsk: 0.22,
      }),
    )
    expect(unwind.askActive).toBe(true)
    expect(unwind.askReason.toLowerCase()).toMatch(/unwind/)
    expect(unwind.bidActive).toBe(false)
  })

  it('unwind works even without FV when long', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 5,
        fairValue: null,
        edgeCents: null,
        mid: 0.5,
      }),
    )
    expect(d.askActive).toBe(true)
    expect(d.askReason.toLowerCase()).toMatch(/unwind/)
    expect(d.bidActive).toBe(false)
  })
})

describe('canAcceptInventoryIncreasingFill', () => {
  it('refuses buy_yes when inventory >= unwindThreshold', () => {
    expect(canAcceptInventoryIncreasingFill('buy_yes', 1, 10, 1)).toBe(false)
    expect(canAcceptInventoryIncreasingFill('buy_yes', 10, 10, 1)).toBe(false)
    expect(canAcceptInventoryIncreasingFill('buy_yes', 0, 10, 1)).toBe(true)
  })

  it('refuses sell_yes when inventory <= -unwindThreshold', () => {
    expect(canAcceptInventoryIncreasingFill('sell_yes', -1, 10, 1)).toBe(false)
    expect(canAcceptInventoryIncreasingFill('sell_yes', 0, 10, 1)).toBe(true)
    expect(canAcceptInventoryIncreasingFill('sell_yes', 5, 10, 1)).toBe(true) // reducing long OK
  })
})
