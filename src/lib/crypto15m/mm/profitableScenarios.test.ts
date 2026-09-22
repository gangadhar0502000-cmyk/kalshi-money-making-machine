/**
 * S1–S5 profitable scenario gates — happy paths + forbidden rejects.
 * Paper research only.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  decideQuoteSides,
  DEFAULT_DECISION_POLICY,
  type DecisionPolicyConfig,
  type DecisionPolicyInput,
} from './decisionPolicy'
import {
  closeCaptureCents,
  evaluateClose,
  isRiskFlat,
  scenarioTag,
} from './profitableScenarios'

function baseConfig(partial: Partial<DecisionPolicyConfig> = {}): DecisionPolicyConfig {
  return {
    halfSpreadCents: 2,
    quoteSize: 2,
    maxInventory: 10,
    inventorySkewCentsPerUnit: 0.15,
    guardWidenCents: 4,
    toxicMidLow: 0.05,
    toxicMidHigh: 0.95,
    minEdgeCents: 4,
    expiryPullMinutes: 0.5,
    fvQuoting: true,
    sizeDownEdgeMult: DEFAULT_DECISION_POLICY.sizeDownEdgeMult,
    sizeUpEdgeMult: DEFAULT_DECISION_POLICY.sizeUpEdgeMult,
    unwindThreshold: 1,
    maxSaneEdgeCents: 25,
    minCaptureCents: 1.5,
    edgePersistTicks: 1,
    twoSidedEdgeBandCents: 0,
    openingEdgeExtraCents: 0,
    openEdgeAddHalfSpread: false,
    openMinEdgeCents: 4,
    hardFlatMinutes: 2,
    minCloseProfitCents: 1.0,
    stuckUnwindTicks: 30,
    markBleedCents: 5,
    ...partial,
  }
}

function baseInput(partial: Partial<DecisionPolicyInput> = {}): DecisionPolicyInput {
  return {
    mid: 0.5,
    fairValue: 0.56,
    edgeCents: 6,
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

describe('S1 OPEN_BID happy path', () => {
  it('quotes bid only when FV−mid ≥ openMin and capture OK', () => {
    const d = decideQuoteSides(
      baseInput({
        fairValue: 0.58,
        mid: 0.5,
        edgeCents: 8,
        bookBestBid: 0.49,
        bookBestAsk: 0.52,
      }),
    )
    expect(d.bidActive).toBe(true)
    expect(d.askActive).toBe(false)
    expect(d.bidScenario).toBe('S1')
    expect(d.bidReason).toMatch(/S1 OPEN_BID/)
    expect(d.activeScenario).toBe('S1')
  })
})

describe('S2 OPEN_ASK happy path', () => {
  it('quotes ask only when mid−FV ≥ openMin', () => {
    const d = decideQuoteSides(
      baseInput({
        fairValue: 0.42,
        mid: 0.5,
        edgeCents: -8,
        bookBestBid: 0.48,
        bookBestAsk: 0.51,
      }),
    )
    expect(d.askActive).toBe(true)
    expect(d.bidActive).toBe(false)
    expect(d.askScenario).toBe('S2')
    expect(d.askReason).toMatch(/S2 OPEN_ASK/)
    expect(d.activeScenario).toBe('S2')
  })
})

describe('S3 CLOSE_PROFIT happy path', () => {
  it('allows reduce ask when capture vs avgEntry ≥ 1¢', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 2,
        avgEntry: 0.5,
        fairValue: 0.5,
        mid: 0.52,
        edgeCents: 0,
        bookBestBid: 0.5,
        bookBestAsk: 0.52, // join ask @ 0.52 → +2¢ vs entry
      }),
    )
    expect(d.askActive).toBe(true)
    expect(d.askScenario).toBe('S3')
    expect(d.askReason).toMatch(/S3 CLOSE_PROFIT/)
    expect(d.bidActive).toBe(false)
  })
})

describe('S4 CLOSE_RISK happy path', () => {
  it('allows risk flat at maxInventory even with lossy capture', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 10,
        avgEntry: 0.55,
        fairValue: null,
        edgeCents: null,
        mid: 0.5,
        bookBestBid: 0.48,
        bookBestAsk: 0.5, // sell @ 0.50 vs entry 0.55 = −5¢ but S4
      }),
    )
    expect(d.askActive).toBe(true)
    expect(d.askScenario).toBe('S4')
    expect(d.askReason).toMatch(/S4 CLOSE_RISK/)
    expect(d.askReason).toMatch(/risk flat/)
    expect(d.unwindActive).toBe(true)
  })

  it('allows risk flat when minutesRemaining < hardFlatMinutes', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 2,
        avgEntry: 0.55,
        minutesRemaining: 1.5,
        fairValue: null,
        edgeCents: null,
        mid: 0.5,
        bookBestAsk: 0.5,
      }),
    )
    expect(d.askActive).toBe(true)
    expect(d.askScenario).toBe('S4')
    expect(d.askReason).toMatch(/risk flat/)
  })
})

describe('S5 NO_TRADE default', () => {
  it('both OFF when no edge', () => {
    const d = decideQuoteSides(
      baseInput({ fairValue: 0.5, mid: 0.5, edgeCents: 1 }),
    )
    expect(d.bidActive).toBe(false)
    expect(d.askActive).toBe(false)
    expect(d.activeScenario).toBe('S5')
  })
})

describe('forbidden paths rejected', () => {
  it('refuses open-then-unwind at ≤0 capture (churn loss) unless S4', () => {
    // Long, join ask below entry → lossy; not at max, not hard-flat
    const d = decideQuoteSides(
      baseInput({
        inventory: 2,
        avgEntry: 0.5,
        mid: 0.5,
        fairValue: 0.5,
        edgeCents: 0,
        minutesRemaining: 8,
        bookBestBid: 0.48,
        bookBestAsk: 0.4912, // −0.88¢ vs entry
      }),
    )
    expect(d.askActive).toBe(false)
    expect(d.askReason).toMatch(/CLOSE blocked: capture/)
    expect(d.askReason).toMatch(/</)

    const fill = evaluateClose({
      side: 'sell_yes',
      price: 0.4912,
      avgEntry: 0.5,
      inventory: 2,
      minCloseProfitCents: 1,
      risk: {
        minutesRemaining: 8,
        inventory: 2,
        maxInventory: 10,
        hardFlatMinutes: 2,
        spotGuardCancel: false,
        mid: 0.5,
        toxicMidLow: 0.05,
        toxicMidHigh: 0.95,
        holdingSide: 'long',
      },
    })
    expect(fill.allow).toBe(false)
    expect(fill.captureCents).toBeCloseTo(-0.88, 2)
  })

  it('never quotes both sides into a one-sided edge', () => {
    const d = decideQuoteSides(
      baseInput({ edgeCents: 8, fairValue: 0.58, mid: 0.5, inventory: 0 }),
    )
    expect(d.bidActive).toBe(true)
    expect(d.askActive).toBe(false)
  })

  it('parks mid-fallback when FV insane (edge sanity)', () => {
    const d = decideQuoteSides(
      baseInput({
        inventory: 0,
        mid: 0.01,
        fairValue: 0.96,
        edgeCents: 95,
      }),
    )
    expect(d.active).toBe(false)
    expect(d.bothOffReason).toMatch(/edge sanity/i)
  })

  it('refuses open when edge < openMin after clamp', () => {
    const d = decideQuoteSides(
      baseInput({
        mid: 0.5,
        fairValue: 0.505,
        edgeCents: 5,
        bookBestBid: 0.5,
        bookBestAsk: 0.52,
        config: baseConfig({
          minCaptureCents: 1.5,
          openMinEdgeCents: 4,
          halfSpreadCents: 0.5,
        }),
      }),
    )
    // Unclamped bid ≈ FV−0.5¢ then clamp ≤0.50 → capture 0.5¢ < 1.5¢
    expect(d.bidActive).toBe(false)
    expect(d.bidReason.toLowerCase()).toMatch(/clamp killed edge/)
  })

  it('recent-style −0.88¢ unwind blocked unless S4', () => {
    const lossy = closeCaptureCents({
      side: 'sell_yes',
      price: 0.4912,
      avgEntry: 0.5,
      inventory: 3,
    })
    expect(lossy).toBeCloseTo(-0.88, 2)

    const blocked = evaluateClose({
      side: 'sell_yes',
      price: 0.4912,
      avgEntry: 0.5,
      inventory: 3,
      minCloseProfitCents: 1,
      risk: {
        minutesRemaining: 10,
        inventory: 3,
        maxInventory: 10,
        hardFlatMinutes: 2,
        spotGuardCancel: false,
        mid: 0.49,
        toxicMidLow: 0.05,
        toxicMidHigh: 0.95,
        holdingSide: 'long',
      },
    })
    expect(blocked.allow).toBe(false)
    expect(blocked.reason).toMatch(/CLOSE blocked: capture/)

    const forced = evaluateClose({
      side: 'sell_yes',
      price: 0.4912,
      avgEntry: 0.5,
      inventory: 10,
      minCloseProfitCents: 1,
      risk: {
        minutesRemaining: 10,
        inventory: 10,
        maxInventory: 10,
        hardFlatMinutes: 2,
        spotGuardCancel: false,
        mid: 0.49,
        toxicMidLow: 0.05,
        toxicMidHigh: 0.95,
        holdingSide: 'long',
      },
    })
    expect(forced.allow).toBe(true)
    expect(forced.scenario).toBe('S4')
    expect(forced.reason).toMatch(/risk flat/)
  })
})

describe('isRiskFlat helpers', () => {
  it('true at hard flat / max inv / guard / toxic', () => {
    expect(
      isRiskFlat({
        minutesRemaining: 1,
        inventory: 1,
        maxInventory: 10,
        hardFlatMinutes: 2,
        spotGuardCancel: false,
        mid: 0.5,
        toxicMidLow: 0.05,
        toxicMidHigh: 0.95,
        holdingSide: 'long',
      }),
    ).toBe(true)
    expect(scenarioTag('S3')).toBe('S3 CLOSE_PROFIT')
  })
})

describe('S4.1 STUCK_UNWIND', () => {
  it('escalates to ≥0¢ reduce after stuckUnwindTicks blocked ticks', () => {
    const cfg = baseConfig({ stuckUnwindTicks: 3, minCloseProfitCents: 1 })
    // Long, join ask at entry → 0¢ capture (< 1¢ S3 bar)
    const inputBase = {
      inventory: 2,
      avgEntry: 0.5,
      mid: 0.5,
      fairValue: 0.5,
      edgeCents: 0,
      minutesRemaining: 8,
      bookBestBid: 0.48,
      bookBestAsk: 0.5,
      config: cfg,
    }

    // Tick 1–2: still blocked
    let stuck = { ticks: 0, invSign: 0 as number }
    for (let i = 0; i < 2; i++) {
      const d = decideQuoteSides(baseInput({ ...inputBase, stuckUnwind: stuck }))
      expect(d.askActive).toBe(false)
      expect(d.askReason).toMatch(/CLOSE blocked: capture/)
      stuck = d.stuckUnwind
      expect(stuck.ticks).toBe(i + 1)
      expect(stuck.invSign).toBe(1)
    }

    // Tick 3: escalate S4.1 at 0¢
    const d3 = decideQuoteSides(baseInput({ ...inputBase, stuckUnwind: stuck }))
    expect(d3.askActive).toBe(true)
    expect(d3.askScenario).toBe('S4.1')
    expect(d3.askReason).toMatch(/S4\.1 STUCK_UNWIND/)
    expect(d3.activeScenario).toBe('S4.1')
    expect(d3.stuckUnwind.ticks).toBe(0) // reset on allow
  })

  it('still blocks −0.5¢ after stuck when above −markBleed (S4.2 not yet)', () => {
    const cfg = baseConfig({ stuckUnwindTicks: 2, minCloseProfitCents: 1, markBleedCents: 5 })
    // Resting ask −1¢ vs entry — S4.1 refuses; S4.2 needs ≤ −5¢
    const d = decideQuoteSides(
      baseInput({
        inventory: 2,
        avgEntry: 0.5,
        mid: 0.5,
        fairValue: 0.5,
        edgeCents: 0,
        minutesRemaining: 8,
        bookBestBid: 0.48,
        bookBestAsk: 0.49,
        config: cfg,
        stuckUnwind: { ticks: 10, invSign: 1 },
      }),
    )
    expect(d.askActive).toBe(false)
    expect(d.askReason).toMatch(/CLOSE blocked: capture/)
    expect(d.askScenario).toBe('S5')

    const fill = evaluateClose({
      side: 'sell_yes',
      price: 0.495,
      avgEntry: 0.5,
      inventory: 2,
      minCloseProfitCents: 1,
      risk: {
        minutesRemaining: 8,
        inventory: 2,
        maxInventory: 10,
        hardFlatMinutes: 2,
        spotGuardCancel: false,
        mid: 0.5,
        toxicMidLow: 0.05,
        toxicMidHigh: 0.95,
        holdingSide: 'long',
      },
      stuckBlockedTicks: 99,
      stuckUnwindTicks: 2,
    })
    expect(fill.allow).toBe(false)
    expect(fill.captureCents!).toBeLessThan(0)
    expect(fill.captureCents).toBeCloseTo(-0.5, 1)
  })

  it('resets stuck counter when flat or S3 allows', () => {
    const cfg = baseConfig({ stuckUnwindTicks: 5 })
    const blocked = decideQuoteSides(
      baseInput({
        inventory: 2,
        avgEntry: 0.5,
        mid: 0.5,
        fairValue: 0.5,
        edgeCents: 0,
        bookBestAsk: 0.5,
        config: cfg,
        stuckUnwind: { ticks: 4, invSign: 1 },
      }),
    )
    // 0¢ with stuck 4+1=5 → S4.1 allow → reset
    expect(blocked.askScenario).toBe('S4.1')
    expect(blocked.stuckUnwind.ticks).toBe(0)

    const flat = decideQuoteSides(
      baseInput({
        inventory: 0,
        avgEntry: null,
        config: cfg,
        stuckUnwind: { ticks: 9, invSign: 1 },
      }),
    )
    expect(flat.stuckUnwind.ticks).toBe(0)
    expect(flat.stuckUnwind.invSign).toBe(0)
  })
})

describe('S4.2 MARK_BLEED', () => {
  const riskOk = {
    minutesRemaining: 8,
    inventory: 2,
    maxInventory: 10,
    hardFlatMinutes: 2,
    spotGuardCancel: false,
    mid: 0.5,
    toxicMidLow: 0.05,
    toxicMidHigh: 0.95,
    holdingSide: 'long' as const,
  }

  it('allows −5¢ after stuckUnwindTicks (lossy OK)', () => {
    const fill = evaluateClose({
      side: 'sell_yes',
      price: 0.45, // −5¢ vs entry 0.50
      avgEntry: 0.5,
      inventory: 2,
      minCloseProfitCents: 1,
      risk: riskOk,
      stuckBlockedTicks: 30,
      stuckUnwindTicks: 30,
      markBleedCents: 5,
    })
    expect(fill.allow).toBe(true)
    expect(fill.scenario).toBe('S4.2')
    expect(fill.reason).toMatch(/S4\.2 MARK_BLEED/)
    expect(fill.captureCents).toBeCloseTo(-5, 1)

    const d = decideQuoteSides(
      baseInput({
        inventory: 2,
        avgEntry: 0.5,
        mid: 0.5,
        fairValue: 0.5,
        edgeCents: 0,
        minutesRemaining: 8,
        bookBestBid: 0.44,
        bookBestAsk: 0.45,
        config: baseConfig({ stuckUnwindTicks: 2, markBleedCents: 5 }),
        stuckUnwind: { ticks: 10, invSign: 1 },
      }),
    )
    expect(d.askActive).toBe(true)
    expect(d.askScenario).toBe('S4.2')
    expect(d.askReason).toMatch(/S4\.2 MARK_BLEED/)
    expect(d.activeScenario).toBe('S4.2')
    expect(d.stuckUnwind.ticks).toBe(0)
  })

  it('refuses −4¢ after stuck (not yet ≤ −markBleedCents)', () => {
    const fill = evaluateClose({
      side: 'sell_yes',
      price: 0.46, // −4¢
      avgEntry: 0.5,
      inventory: 2,
      minCloseProfitCents: 1,
      risk: riskOk,
      stuckBlockedTicks: 99,
      stuckUnwindTicks: 2,
      markBleedCents: 5,
    })
    expect(fill.allow).toBe(false)
    expect(fill.scenario).toBe('S5')
    expect(fill.reason).toMatch(/CLOSE blocked: capture/)
    expect(fill.captureCents).toBeCloseTo(-4, 1)

    const d = decideQuoteSides(
      baseInput({
        inventory: 2,
        avgEntry: 0.5,
        mid: 0.5,
        fairValue: 0.5,
        edgeCents: 0,
        minutesRemaining: 8,
        bookBestBid: 0.45,
        bookBestAsk: 0.46,
        config: baseConfig({ stuckUnwindTicks: 2, markBleedCents: 5 }),
        stuckUnwind: { ticks: 10, invSign: 1 },
      }),
    )
    expect(d.askActive).toBe(false)
    expect(d.askScenario).toBe('S5')
    expect(d.askReason).not.toMatch(/S4\.2/)
  })

  it('S4.1 still preferred at 0¢ when stuck', () => {
    const fill = evaluateClose({
      side: 'sell_yes',
      price: 0.5,
      avgEntry: 0.5,
      inventory: 2,
      minCloseProfitCents: 1,
      risk: riskOk,
      stuckBlockedTicks: 99,
      stuckUnwindTicks: 2,
      markBleedCents: 5,
    })
    expect(fill.allow).toBe(true)
    expect(fill.scenario).toBe('S4.1')
    expect(fill.reason).toMatch(/S4\.1 STUCK_UNWIND/)
  })

  it('does not open — only reducing paths', () => {
    const openish = evaluateClose({
      side: 'buy_yes',
      price: 0.4,
      avgEntry: 0.5,
      inventory: 0, // flat — not reducing
      minCloseProfitCents: 1,
      risk: { ...riskOk, inventory: 0, holdingSide: 'flat' },
      stuckBlockedTicks: 99,
      stuckUnwindTicks: 2,
      markBleedCents: 5,
    })
    expect(openish.allow).toBe(false)
    expect(openish.scenario).toBe('S5')
    expect(openish.reason).toMatch(/not reducing/)
  })
})
