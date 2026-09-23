/**
 * Decision policy — U3.0 quoting paused (S1–S5 playbook removed).
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canAcceptInventoryIncreasingFill,
  decideQuoteSides,
  DEFAULT_DECISION_POLICY,
  QUOTING_PAUSED_REASON,
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
    edgePersistTicks: 1,
    twoSidedEdgeBandCents: DEFAULT_DECISION_POLICY.twoSidedEdgeBandCents,
    openingEdgeExtraCents: DEFAULT_DECISION_POLICY.openingEdgeExtraCents,
    openEdgeAddHalfSpread: DEFAULT_DECISION_POLICY.openEdgeAddHalfSpread,
    openMinEdgeCents: DEFAULT_DECISION_POLICY.openMinEdgeCents,
    hardFlatMinutes: DEFAULT_DECISION_POLICY.hardFlatMinutes,
    minCloseProfitCents: DEFAULT_DECISION_POLICY.minCloseProfitCents,
    stuckUnwindTicks: DEFAULT_DECISION_POLICY.stuckUnwindTicks,
    markBleedCents: DEFAULT_DECISION_POLICY.markBleedCents,
    quotingEnabled: false,
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

describe('decisionPolicy U3.0 pause', () => {
  it('default quotingEnabled false → both OFF + U3.0 paused reason', () => {
    const d = decideQuoteSides(
      baseInput({ fairValue: 0.65, mid: 0.45, edgeCents: 20 }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.active).toBe(false)
    expect(d.bothOffReason).toBe(QUOTING_PAUSED_REASON)
    expect(d.bidReason).toMatch(/U3\.0.*paused/)
    expect(d.askReason).toMatch(/U3\.0.*paused/)
    expect(d.activeScenario).toBeUndefined()
  })

  it('quotingEnabled true still yields no active quotes (no replacement logic)', () => {
    const d = decideQuoteSides(
      baseInput({
        config: baseConfig({ quotingEnabled: true }),
        fairValue: 0.65,
        mid: 0.45,
        edgeCents: 20,
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toMatch(/U3\.0/)
  })

  it('not running parks without claiming U3.0 when already idle', () => {
    const d = decideQuoteSides(baseInput({ running: false, edgeCents: 20 }))
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toMatch(/not running/i)
  })

  it('canAcceptInventoryIncreasingFill still gates adds at unwind threshold', () => {
    expect(canAcceptInventoryIncreasingFill('buy_yes', 0, 10, 1)).toBe(true)
    expect(canAcceptInventoryIncreasingFill('buy_yes', 1, 10, 1)).toBe(false)
    expect(canAcceptInventoryIncreasingFill('sell_yes', 0, 10, 1)).toBe(true)
    expect(canAcceptInventoryIncreasingFill('sell_yes', -1, 10, 1)).toBe(false)
  })

  it('DEFAULT_DECISION_POLICY.quotingEnabled is false', () => {
    expect(DEFAULT_DECISION_POLICY.quotingEnabled).toBe(false)
  })
})
