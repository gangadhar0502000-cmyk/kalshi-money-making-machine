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
    minCaptureCents: DEFAULT_DECISION_POLICY.minCaptureCents,
    edgePersistTicks: 1, // unit tests: activate on first qualifying tick
    twoSidedEdgeBandCents: DEFAULT_DECISION_POLICY.twoSidedEdgeBandCents,
    openingEdgeExtraCents: DEFAULT_DECISION_POLICY.openingEdgeExtraCents,
    openEdgeAddHalfSpread: DEFAULT_DECISION_POLICY.openEdgeAddHalfSpread,
    openMinEdgeCents: DEFAULT_DECISION_POLICY.openMinEdgeCents,
    hardFlatMinutes: DEFAULT_DECISION_POLICY.hardFlatMinutes,
    minCloseProfitCents: DEFAULT_DECISION_POLICY.minCloseProfitCents,
    stuckUnwindTicks: DEFAULT_DECISION_POLICY.stuckUnwindTicks,
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
    avgEntry: null,
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
    expect(d.bidReason).toMatch(/S1 OPEN_BID/)
    expect(d.askActive).toBe(false)
    expect(d.centerMode).toBe('fv')
  })

  it('FV ≪ mid → ask ON, bid OFF', () => {
    const d = decideQuoteSides(
      baseInput({ fairValue: 0.35, mid: 0.55, edgeCents: -20 }),
    )
    expect(d.askActive).toBe(true)
    expect(d.bidActive).toBe(false)
    expect(d.askReason).toMatch(/S2 OPEN_ASK/)
    expect(d.bidActive).toBe(false)
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
    const flat = decideQuoteSides(
      baseInput({ inventory: 0, edgeCents: 6, fairValue: 0.56, mid: 0.5 }),
    )
    const long = decideQuoteSides(
      baseInput({
        inventory: 8,
        edgeCents: 6,
        avgEntry: 0.5,
        bookBestAsk: 0.52,
        mid: 0.5,
      }),
    )
    expect(flat.bidActive).toBe(true)
    expect(long.bidActive).toBe(false)
    // Long with +2¢ capture at ask → S3 CLOSE_PROFIT
    expect(long.askActive).toBe(true)
    expect(long.askReason).toMatch(/S3 CLOSE_PROFIT|S4 CLOSE_RISK/)
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
    expect(d.askReason).toMatch(/S4 CLOSE_RISK|risk flat/)
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
    expect(d.bidReason).toMatch(/S4 CLOSE_RISK|risk flat|S3 CLOSE_PROFIT/)
    expect(d.active).toBe(true)
    expect(d.unwindActive).toBe(true)
  })

  it('flat + edge +6 → bid ON ask OFF', () => {
    const d = decideQuoteSides(
      baseInput({ inventory: 0, fairValue: 0.56, mid: 0.5, edgeCents: 6 }),
    )
    expect(d.bidActive).toBe(true)
    expect(d.askActive).toBe(false)
    expect(d.bidReason).toMatch(/S1 OPEN_BID|bid ON:/)
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
    expect(unwind.askReason).toMatch(/S4 CLOSE_RISK|risk flat|S3/)
    expect(unwind.bidActive).toBe(false)
  })

  it('unwind works even without FV when long at max (S4)', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 10,
        fairValue: null,
        edgeCents: null,
        mid: 0.5,
        avgEntry: 0.55, // lossy vs ask join → must be S4 not S3
        bookBestAsk: 0.5,
        config: baseConfig({ maxInventory: 10 }),
      }),
    )
    expect(d.askActive).toBe(true)
    expect(d.askReason).toMatch(/S4 CLOSE_RISK|risk flat/)
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


describe('decisionPolicy hardening (opening bar / clamp / persist / one-sided)', () => {
  it('Opening quote blocked when edge 2.5¢ < openMin (4)', () => {
    const d = decideQuoteSides(
      baseInput({
        edgeCents: 2.5,
        fairValue: 0.525,
        mid: 0.5,
        config: baseConfig({ minEdgeCents: 4, openMinEdgeCents: 4, edgePersistTicks: 1 }),
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason ?? d.bidReason).toMatch(/no edge|open min/i)
  })

  it('Clamp to BBO that removes edge → side off with clamp killed edge', () => {
    // FV barely above bestBid after clamp → capture < minCaptureCents
    const d = decideQuoteSides(
      baseInput({
        mid: 0.5,
        fairValue: 0.505,
        edgeCents: 5,
        bookBestBid: 0.5,
        bookBestAsk: 0.52,
        config: baseConfig({
          minEdgeCents: 3,
          halfSpreadCents: 0.5,
          minCaptureCents: 1,
          edgePersistTicks: 1,
          maxSaneEdgeCents: 25,
        }),
      }),
    )
    // After clamp bid joins ≤ 0.50; FV−bid = 0.5¢ < 1¢ → killed
    expect(d.bidActive).toBe(false)
    expect(d.bidReason.toLowerCase()).toMatch(/clamp killed edge/)
  })

  it('Edge must persist N ticks before ON; flips off immediately on reverse', () => {
    const cfg = baseConfig({ minEdgeCents: 3, edgePersistTicks: 3 })
    const mk = (edge: number, persist: { bidTicks: number; askTicks: number }) =>
      decideQuoteSides(
        baseInput({
          edgeCents: edge,
          fairValue: 0.5 + edge / 100,
          mid: 0.5,
          config: cfg,
          edgePersist: persist,
        }),
      )

    const t1 = mk(5, { bidTicks: 0, askTicks: 0 })
    expect(t1.bidActive).toBe(false)
    expect(t1.bidReason.toLowerCase()).toMatch(/flicker|persist/)
    expect(t1.edgePersist.bidTicks).toBe(1)

    const t2 = mk(5, t1.edgePersist)
    expect(t2.bidActive).toBe(false)
    expect(t2.edgePersist.bidTicks).toBe(2)

    const t3 = mk(5, t2.edgePersist)
    expect(t3.bidActive).toBe(true)
    expect(t3.bidReason).toMatch(/S1 OPEN_BID/)
    expect(t3.askActive).toBe(false)

    // Reverse edge → drop immediately
    const flip = mk(-5, t3.edgePersist)
    expect(flip.bidActive).toBe(false)
    expect(flip.askActive).toBe(false) // ask needs 3 ticks too
    expect(flip.edgePersist.bidTicks).toBe(0)
    expect(flip.edgePersist.askTicks).toBe(1)
    expect(flip.askReason.toLowerCase()).toMatch(/flicker/)
  })

  it('|edge| large → only one side', () => {
    const d = decideQuoteSides(
      baseInput({
        edgeCents: 8,
        fairValue: 0.58,
        mid: 0.5,
        inventory: 0,
        config: baseConfig({ minEdgeCents: 3.5, edgePersistTicks: 1, twoSidedEdgeBandCents: 0 }),
      }),
    )
    expect(d.bidActive).toBe(true)
    expect(d.askActive).toBe(false)
  })

  it('S4 forces reduce at max inventory even without edge', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 10,
        fairValue: null,
        edgeCents: null,
        mid: 0.5,
        avgEntry: 0.55,
        config: baseConfig({ edgePersistTicks: 1, maxInventory: 10 }),
      }),
    )
    expect(d.askActive).toBe(true)
    expect(d.askReason).toMatch(/S4 CLOSE_RISK|risk flat/)
    expect(d.bidActive).toBe(false)
    expect(d.unwindActive).toBe(true)
  })
})

