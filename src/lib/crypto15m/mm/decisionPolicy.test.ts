/**
 * Decision policy — U3.1 Family E (S1–S5 not used).
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canAcceptInventoryIncreasingFill,
  decideQuoteSides,
  DEFAULT_DECISION_POLICY,
  QUOTING_PAUSED_REASON,
  U31_BLACKOUT,
  U311_EXTREME_MID,
  U31_NO_FV,
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
    quotingEnabled: true,
    blackoutMinutes: DEFAULT_DECISION_POLICY.blackoutMinutes,
    quoteClampEpsilon: DEFAULT_DECISION_POLICY.quoteClampEpsilon,
    tauSkewAccel: DEFAULT_DECISION_POLICY.tauSkewAccel,
    ...partial,
  }
}

function baseInput(partial: Partial<DecisionPolicyInput> = {}): DecisionPolicyInput {
  return {
    mid: 0.5,
    fairValue: 0.55,
    edgeCents: 5,
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

describe('decisionPolicy U3.1 Family E', () => {
  it('quotingEnabled false → U3.0 pause', () => {
    const d = decideQuoteSides(
      baseInput({ config: baseConfig({ quotingEnabled: false }) }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toBe(QUOTING_PAUSED_REASON)
  })

  it('two-sided open around FV when flat and outside flatten', () => {
    const d = decideQuoteSides(baseInput())
    expect(d.bidActive).toBe(true)
    expect(d.askActive).toBe(true)
    expect(d.active).toBe(true)
    expect(d.centerMode).toBe('fv')
    expect(d.activeScenario).toBe('open')
    expect(d.yesAsk).toBeGreaterThan(d.yesBid)
    expect(d.yesBid).toBeGreaterThanOrEqual(0.01)
    expect(d.yesAsk).toBeLessThanOrEqual(0.99)
  })

  it('blackout both OFF', () => {
    const d = decideQuoteSides(
      baseInput({
        minutesRemaining: 0.5,
        config: baseConfig({ blackoutMinutes: 0.75 }),
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toBe(U31_BLACKOUT)
    expect(d.activeScenario).toBe('blackout')
  })

  it('flatten only reduces (long → ask only)', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 3,
        minutesRemaining: 1.5,
        config: baseConfig({ hardFlatMinutes: 2, blackoutMinutes: 0.75 }),
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(true)
    expect(d.unwindActive).toBe(true)
    expect(d.activeScenario).toBe('flatten')
    expect(String(d.bidReason + d.askReason)).not.toMatch(/S[1-5]/)
  })

  it('no quote without FV / spot block', () => {
    const d = decideQuoteSides(
      baseInput({ fairValue: null, fvBlockReason: 'U3.1: no spot — needs Binance US/Coinbase' }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toMatch(/U3\.1: no spot/)
  })

  it('no fair value parks with U31_NO_FV', () => {
    const d = decideQuoteSides(baseInput({ fairValue: null }))
    expect(d.bothOffReason).toBe(U31_NO_FV)
  })

  it('clamp bounds hold even with extreme FV', () => {
    const d = decideQuoteSides(
      baseInput({
        fairValue: 0.99,
        mid: 0.5,
        bookBestBid: 0.01,
        bookBestAsk: 0.99,
        config: baseConfig({ quoteClampEpsilon: 0.02, halfSpreadCents: 2 }),
      }),
    )
    expect(d.yesBid).toBeGreaterThanOrEqual(0.02 - 1e-9)
    expect(d.yesAsk).toBeLessThanOrEqual(0.98 + 1e-9)
  })

  it('max inventory withdraws adding side', () => {
    const d = decideQuoteSides(baseInput({ inventory: 10 }))
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(true)
  })

  it('not running parks without U3.1', () => {
    const d = decideQuoteSides(baseInput({ running: false }))
    expect(d.bothOffReason).toMatch(/not running/i)
  })

  it('canAcceptInventoryIncreasingFill still gates adds', () => {
    expect(canAcceptInventoryIncreasingFill('buy_yes', 0, 10, 1)).toBe(true)
    expect(canAcceptInventoryIncreasingFill('buy_yes', 1, 10, 1)).toBe(false)
  })

  it('DEFAULT_DECISION_POLICY.quotingEnabled is true', () => {
    expect(DEFAULT_DECISION_POLICY.quotingEnabled).toBe(true)
  })

  it('U3.1.1: flat @ mid 0.99 parks both — no new opens', () => {
    const d = decideQuoteSides(
      baseInput({
        mid: 0.99,
        fairValue: 0.96,
        inventory: 0,
        bookBestBid: 0.98,
        bookBestAsk: 0.99,
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toBe(U311_EXTREME_MID)
    expect(d.activeScenario).toBe('extreme_mid')
  })

  it('U3.1.1: flat @ mid 0.01 parks both — no new opens', () => {
    const d = decideQuoteSides(
      baseInput({
        mid: 0.01,
        fairValue: 0.04,
        inventory: 0,
        bookBestBid: 0.01,
        bookBestAsk: 0.02,
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toBe(U311_EXTREME_MID)
  })

  it('U3.1.1: long @ mid 0.99 — bid OFF, flatten ask may stay', () => {
    const d = decideQuoteSides(
      baseInput({
        mid: 0.99,
        fairValue: 0.96,
        inventory: 2,
        minutesRemaining: 8,
        bookBestBid: 0.98,
        bookBestAsk: 0.99,
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(true)
    expect(String(d.bidReason)).toMatch(/U3\.1\.1|no new longs/i)
  })

  it('U3.1.1: short @ mid 0.01 — ask OFF, flatten bid may stay', () => {
    const d = decideQuoteSides(
      baseInput({
        mid: 0.01,
        fairValue: 0.04,
        inventory: -2,
        minutesRemaining: 8,
        bookBestBid: 0.01,
        bookBestAsk: 0.02,
      }),
    )
    expect(d.askActive).toBe(false)
    expect(d.bidActive).toBe(true)
  })

  it('blackout still parks both (unchanged)', () => {
    const d = decideQuoteSides(
      baseInput({
        mid: 0.99,
        inventory: 0,
        minutesRemaining: 0.5,
        config: baseConfig({ blackoutMinutes: 0.75 }),
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toBe(U31_BLACKOUT)
  })

})
