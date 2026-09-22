/**
 * Named profitable scenarios — the ONLY paths allowed to open/close paper quotes.
 * Paper research only; never places live orders; positive P&L not guaranteed.
 *
 * S1 OPEN_BID  — buy cheap YES (FV ≫ mid, maker capture OK)
 * S2 OPEN_ASK  — sell rich YES (mid ≫ FV, maker capture OK)
 * S3 CLOSE_PROFIT — reduce inventory only with ≥ minCloseProfitCents vs avgEntry
 * S4 CLOSE_RISK — forced flatten without profit (hard flat / max inv / guard / toxic)
 * S5 NO_TRADE — default; both sides OFF
 */

export type ScenarioId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5'

export const SCENARIO_LABEL: Record<ScenarioId, string> = {
  S1: 'OPEN_BID',
  S2: 'OPEN_ASK',
  S3: 'CLOSE_PROFIT',
  S4: 'CLOSE_RISK',
  S5: 'NO_TRADE',
}

/** Threshold knobs (machine names) with sensible paper defaults. */
export interface ScenarioThresholds {
  /** S1/S2: |FV−mid| must be ≥ this to open. Default 4¢. */
  openMinEdgeCents: number
  /** S1/S2: after maker clamp, capture vs FV ≥ this. Default 1.5¢. */
  minCaptureCents: number
  /** S3: reducing fill capture vs avgEntry ≥ this. Default 1.0¢. */
  minCloseProfitCents: number
  /** No opens / S4 risk flat when minutesRemaining < this. Default 2. */
  hardFlatMinutes: number
  maxInventory: number
  maxSaneEdgeCents: number
  toxicMidLow: number
  toxicMidHigh: number
}

export const DEFAULT_SCENARIO_THRESHOLDS: ScenarioThresholds = {
  openMinEdgeCents: 4,
  minCaptureCents: 1.5,
  minCloseProfitCents: 1.0,
  hardFlatMinutes: 2,
  maxInventory: 10,
  maxSaneEdgeCents: 25,
  toxicMidLow: 0.05,
  toxicMidHigh: 0.95,
}

export function scenarioTag(id: ScenarioId): string {
  return `${id} ${SCENARIO_LABEL[id]}`
}

/** Signed close capture in cents vs avgEntry. Null if not a reducing fill. */
export function closeCaptureCents(args: {
  side: 'buy_yes' | 'sell_yes'
  price: number
  avgEntry: number | null
  inventory: number
}): number | null {
  const { side, price, avgEntry, inventory } = args
  if (avgEntry == null || !Number.isFinite(avgEntry) || !Number.isFinite(price)) return null
  if (side === 'sell_yes' && inventory > 0) return (price - avgEntry) * 100
  if (side === 'buy_yes' && inventory < 0) return (avgEntry - price) * 100
  return null
}

/** Expected close capture at a resting reduce quote vs avgEntry. */
export function expectedCloseCaptureCents(args: {
  reduceSide: 'bid' | 'ask'
  restingPx: number
  avgEntry: number | null
  inventory: number
}): number | null {
  const { reduceSide, restingPx, avgEntry, inventory } = args
  if (avgEntry == null || !Number.isFinite(avgEntry) || !Number.isFinite(restingPx)) return null
  if (reduceSide === 'ask' && inventory > 0) return (restingPx - avgEntry) * 100
  if (reduceSide === 'bid' && inventory < 0) return (avgEntry - restingPx) * 100
  return null
}

export interface RiskFlatInput {
  minutesRemaining: number | null
  inventory: number
  maxInventory: number
  hardFlatMinutes: number
  spotGuardCancel: boolean
  /** Extreme widen treated as risk (same as cancel for S4). */
  guardWidenExtreme?: boolean
  mid: number
  toxicMidLow: number
  toxicMidHigh: number
  /** Holding long → toxic when mid ≥ high; short → toxic when mid ≤ low. */
  holdingSide: 'long' | 'short' | 'flat'
}

/**
 * S4 CLOSE_RISK gates — may close without profit only when one of these is true.
 */
export function isRiskFlat(input: RiskFlatInput): boolean {
  const mins = input.minutesRemaining
  if (
    mins != null &&
    Number.isFinite(mins) &&
    mins < input.hardFlatMinutes
  ) {
    return true
  }
  if (Math.abs(input.inventory) >= input.maxInventory) return true
  if (input.spotGuardCancel) return true
  if (input.guardWidenExtreme) return true
  if (input.holdingSide === 'long' && input.mid >= input.toxicMidHigh) return true
  if (input.holdingSide === 'short' && input.mid <= input.toxicMidLow) return true
  return false
}

export type CloseDecision =
  | { allow: true; scenario: 'S3'; captureCents: number; reason: string }
  | { allow: true; scenario: 'S4'; captureCents: number | null; reason: string }
  | { allow: false; scenario: 'S5'; captureCents: number | null; reason: string }

/**
 * Decide whether a reducing fill / reduce quote is allowed (S3 or S4).
 * Lossy / sub-1¢ voluntary unwinds → S5 refuse (fixes −0.88¢/fill churn).
 */
export function evaluateClose(args: {
  side: 'buy_yes' | 'sell_yes' | 'bid' | 'ask'
  price: number
  avgEntry: number | null
  inventory: number
  minCloseProfitCents: number
  risk: RiskFlatInput
}): CloseDecision {
  const reducing =
    (args.side === 'sell_yes' || args.side === 'ask') && args.inventory > 0
      ? true
      : (args.side === 'buy_yes' || args.side === 'bid') && args.inventory < 0
  if (!reducing) {
    return {
      allow: false,
      scenario: 'S5',
      captureCents: null,
      reason: `CLOSE blocked: S5 ${SCENARIO_LABEL.S5} (not reducing)`,
    }
  }

  const fillSide: 'buy_yes' | 'sell_yes' =
    args.side === 'ask' || args.side === 'sell_yes' ? 'sell_yes' : 'buy_yes'
  const cap = closeCaptureCents({
    side: fillSide,
    price: args.price,
    avgEntry: args.avgEntry,
    inventory: args.inventory,
  })
  const minP = Math.max(0, args.minCloseProfitCents)
  const riskOn = isRiskFlat(args.risk)

  if (cap != null && cap >= minP - 1e-9) {
    return {
      allow: true,
      scenario: 'S3',
      captureCents: cap,
      reason: `${fillSide === 'sell_yes' ? 'ask' : 'bid'} ON: ${scenarioTag('S3')} +${cap.toFixed(1)}¢`,
    }
  }

  if (riskOn) {
    return {
      allow: true,
      scenario: 'S4',
      captureCents: cap,
      reason: `${fillSide === 'sell_yes' ? 'ask' : 'bid'} ON: ${scenarioTag('S4')} risk flat`,
    }
  }

  const shown = cap == null ? 'n/a' : `${cap.toFixed(1)}¢`
  return {
    allow: false,
    scenario: 'S5',
    captureCents: cap,
    reason: `CLOSE blocked: capture ${shown} < ${minP}¢`,
  }
}

export function formatOpenOn(
  side: 'bid' | 'ask',
  scenario: 'S1' | 'S2',
  edgeCents: number,
): string {
  const sign = edgeCents >= 0 ? '+' : ''
  return `${side} ON: ${scenarioTag(scenario)} ${sign}${edgeCents.toFixed(1)}¢`
}

export function formatSideOff(side: 'bid' | 'ask', detail: string): string {
  return `${side} OFF: ${detail}`
}

export function formatBothOff(detail: string): string {
  return `both OFF: ${detail.includes('S5') ? detail : `S5 ${SCENARIO_LABEL.S5} · ${detail}`}`
}

/** Active scenario summary for UI (prefer ON side, else S5). */
export function pickActiveScenario(args: {
  bidActive: boolean
  askActive: boolean
  bidScenario: ScenarioId
  askScenario: ScenarioId
}): ScenarioId {
  if (args.askActive && (args.askScenario === 'S2' || args.askScenario === 'S3' || args.askScenario === 'S4')) {
    return args.askScenario
  }
  if (args.bidActive && (args.bidScenario === 'S1' || args.bidScenario === 'S3' || args.bidScenario === 'S4')) {
    return args.bidScenario
  }
  if (args.bidActive) return args.bidScenario
  if (args.askActive) return args.askScenario
  return 'S5'
}

export function activeScenarioLabel(id: ScenarioId): string {
  return scenarioTag(id)
}
