/**
 * Decision policy — U3.2 house mid (S1–S5 not used; FV does not center).
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canAcceptInventoryIncreasingFill,
  decideQuoteSides,
  DEFAULT_DECISION_POLICY,
  QUOTING_PAUSED_REASON,
  U31_BLACKOUT,
  U312_BLACKOUT_FLATTEN,
  U311_EXTREME_MID,
  U32_HOUSE_MID,
  U32_NO_MID,
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

describe('decisionPolicy U3.2 house mid', () => {
  it('quotingEnabled false → U3.0 pause', () => {
    const d = decideQuoteSides(
      baseInput({ config: baseConfig({ quotingEnabled: false }) }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toBe(QUOTING_PAUSED_REASON)
  })

  it('two-sided open around mid (not FV) when flat', () => {
    const d = decideQuoteSides(baseInput())
    expect(d.bidActive).toBe(true)
    expect(d.askActive).toBe(true)
    expect(d.active).toBe(true)
    expect(d.centerMode).toBe('mid')
    expect(d.activeScenario).toBe('house_mid')
    expect(d.bidReason).toBe(U32_HOUSE_MID)
    expect(d.yesAsk).toBeGreaterThan(d.yesBid)
  })

  it('mid 0.05 + FV 0.25 → quotes near mid, not near FV', () => {
    const d = decideQuoteSides(
      baseInput({
        mid: 0.05,
        fairValue: 0.25,
        edgeCents: 20,
        bookBestBid: 0.04,
        bookBestAsk: 0.06,
        // mid == toxicMidLow (0.05) is extreme — use just above for open path
        config: baseConfig({ toxicMidLow: 0.04, toxicMidHigh: 0.95 }),
      }),
    )
    expect(d.centerMode).toBe('mid')
    expect(d.bidActive).toBe(true)
    expect(d.askActive).toBe(true)
    const center = (d.yesBid + d.yesAsk) / 2
    expect(Math.abs(center - 0.05)).toBeLessThan(0.06)
    expect(Math.abs(center - 0.25)).toBeGreaterThan(0.1)
    expect(d.yesBid).toBeLessThan(0.15)
  })

  it('missing FV / fvBlockReason does NOT park (telemetry only)', () => {
    const d = decideQuoteSides(
      baseInput({
        fairValue: null,
        fvBlockReason: 'U3.1: no spot — needs Binance US/Coinbase',
      }),
    )
    expect(d.bidActive).toBe(true)
    expect(d.askActive).toBe(true)
    expect(d.centerMode).toBe('mid')
    expect(d.activeScenario).toBe('house_mid')
  })

  it('invalid mid → U3.2 no mid park', () => {
    const d = decideQuoteSides(baseInput({ mid: 0 }))
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toBe(U32_NO_MID)
  })

  it('blackout + flat → both OFF', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 0,
        minutesRemaining: 0.5,
        config: baseConfig({ blackoutMinutes: 0.75 }),
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toBe(U31_BLACKOUT)
    expect(d.activeScenario).toBe('blackout')
  })

  it('U3.1.2: blackout + long → ask only (bid OFF)', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 2,
        minutesRemaining: 0.5,
        config: baseConfig({ blackoutMinutes: 0.75, hardFlatMinutes: 2 }),
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(true)
    expect(d.unwindActive).toBe(true)
    expect(d.activeScenario).toBe('blackout_flatten')
    expect(d.askReason).toBe(U312_BLACKOUT_FLATTEN)
    expect(d.bothOffReason).toBeNull()
  })

  it('U3.1.2: blackout + short → bid only (ask OFF)', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: -2,
        minutesRemaining: 0.4,
        config: baseConfig({ blackoutMinutes: 0.75, hardFlatMinutes: 2 }),
      }),
    )
    expect(d.askActive).toBe(false)
    expect(d.bidActive).toBe(true)
    expect(d.unwindActive).toBe(true)
    expect(d.activeScenario).toBe('blackout_flatten')
    expect(d.bidReason).toBe(U312_BLACKOUT_FLATTEN)
  })

  it('τ > blackout + hardFlat → flatten (not blackout_flatten)', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 3,
        minutesRemaining: 1.5,
        config: baseConfig({ hardFlatMinutes: 2, blackoutMinutes: 0.75 }),
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(true)
    expect(d.activeScenario).toBe('flatten')
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

  it('clamp bounds hold with extreme mid still maker-clamped', () => {
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
    expect(d.centerMode).toBe('mid')
  })

  it('max inventory withdraws adding side', () => {
    const d = decideQuoteSides(baseInput({ inventory: 10 }))
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(true)
  })

  it('not running parks without U3.2', () => {
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

  it('blackout + flat still parks both (U3.1.2 unchanged for q=0)', () => {
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

  it('U3.1.2 + U3.1.1: blackout long @ extreme mid — ask stays, no new longs', () => {
    const d = decideQuoteSides(
      baseInput({
        mid: 0.99,
        fairValue: 0.96,
        inventory: 1,
        minutesRemaining: 0.5,
        bookBestBid: 0.98,
        bookBestAsk: 0.99,
        config: baseConfig({ blackoutMinutes: 0.75 }),
      }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(true)
    expect(d.activeScenario).toBe('blackout_flatten')
  })
})
