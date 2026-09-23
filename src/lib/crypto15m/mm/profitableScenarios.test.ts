/**
 * Legacy scenario helpers — optional journal/digest only (U3.0).
 * S1–S5 no longer drive quotes.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  evaluateClose,
  closeCaptureCents,
  isRiskFlat,
  scenarioTag,
} from './profitableScenarios'
import {
  decideQuoteSides,
  DEFAULT_DECISION_POLICY,
  QUOTING_PAUSED_REASON,
  type DecisionPolicyConfig,
  type DecisionPolicyInput,
} from './decisionPolicy'

function baseConfig(): DecisionPolicyConfig {
  return {
    halfSpreadCents: 2,
    quoteSize: 1,
    maxInventory: 10,
    inventorySkewCentsPerUnit: 0.15,
    guardWidenCents: 4,
    toxicMidLow: 0.05,
    toxicMidHigh: 0.95,
    minEdgeCents: 4,
    fvQuoting: true,
    ...DEFAULT_DECISION_POLICY,
    edgePersistTicks: 1,
    quotingEnabled: false,
  }
}

describe('U3.0 — scenarios do not drive quotes', () => {
  it('decideQuoteSides never opens via S1–S5', () => {
    const input: DecisionPolicyInput = {
      mid: 0.45,
      fairValue: 0.65,
      edgeCents: 20,
      inventory: 0,
      bookBestBid: 0.44,
      bookBestAsk: 0.46,
      minutesRemaining: 10,
      running: true,
      settled: false,
      moneyPrinterBug: false,
      spotGuardCancel: false,
      guardWiden: false,
      toxicBidPullUntil: 0,
      toxicAskPullUntil: 0,
      now: 1,
      config: baseConfig(),
    }
    const d = decideQuoteSides(input)
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.bothOffReason).toBe(QUOTING_PAUSED_REASON)
    expect(String(d.bidReason + d.askReason)).not.toMatch(/S1 OPEN_BID|S2 OPEN_ASK/)
  })
})

describe('legacy evaluateClose (journal-only helper)', () => {
  it('still computes close capture for old digests', () => {
    const cap = closeCaptureCents({
      inventory: 2,
      avgEntry: 0.4,
      side: 'sell_yes',
      price: 0.45,
    })
    expect(cap).toBeCloseTo(5, 5)
  })

  it('isRiskFlat / scenarioTag remain pure helpers', () => {
    expect(
      isRiskFlat({
        minutesRemaining: 1,
        hardFlatMinutes: 2,
        inventory: 0,
        maxInventory: 10,
        spotGuardCancel: false,
        mid: 0.5,
        toxicMidLow: 0.05,
        toxicMidHigh: 0.95,
        holdingSide: 'flat',
      }),
    ).toBe(true)
    expect(scenarioTag('S3')).toMatch(/S3/)
  })

  it('evaluateClose allow/refuse still pure (unused by quote path)', () => {
    const allow = evaluateClose({
      inventory: 2,
      avgEntry: 0.4,
      side: 'sell_yes',
      price: 0.45,
      minCloseProfitCents: 1,
      risk: {
        minutesRemaining: 10,
        hardFlatMinutes: 2,
        inventory: 2,
        maxInventory: 10,
        spotGuardCancel: false,
        mid: 0.5,
        toxicMidLow: 0.05,
        toxicMidHigh: 0.95,
        holdingSide: 'long',
      },
      stuckBlockedTicks: 0,
      stuckUnwindTicks: 30,
      markBleedCents: 5,
    })
    expect(allow.allow).toBe(true)
  })
})
