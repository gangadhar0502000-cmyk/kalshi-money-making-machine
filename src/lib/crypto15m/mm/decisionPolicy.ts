/**
 * Explicit, testable decision policy for paper MM quoting.
 * U3.0: S1–S5 scenario playbook removed. Paper quoting is paused until the user
 * defines new quote logic (`quotingEnabled` + replacement path).
 * Paper research only — never places live orders.
 */

import { clampPx, isValidQuoteMid } from './prices'

/** Fail-loud strip / reason when paper quotes stay OFF (U3.0). */
export const QUOTING_PAUSED_REASON =
  'U3.0: paper quoting paused — needs new quote logic'

export interface DecisionPolicyConfig {
  halfSpreadCents: number
  quoteSize: number
  maxInventory: number
  inventorySkewCentsPerUnit: number
  guardWidenCents: number
  toxicMidLow: number
  toxicMidHigh: number
  minEdgeCents: number
  /** Pull both sides when minutesRemaining < this (default 0.5). */
  expiryPullMinutes: number
  fvQuoting: boolean
  sizeDownEdgeMult: number
  sizeUpEdgeMult: number
  unwindThreshold: number
  maxSaneEdgeCents: number
  minCaptureCents: number
  edgePersistTicks: number
  twoSidedEdgeBandCents: number
  openingEdgeExtraCents: number
  openEdgeAddHalfSpread: boolean
  openMinEdgeCents: number
  hardFlatMinutes: number
  minCloseProfitCents: number
  stuckUnwindTicks: number
  markBleedCents: number
  /**
   * U3.0: when false (default), never arm bid/ask — awaiting user-defined logic.
   * Flip later when a replacement quote path exists; do not re-enable S1–S5.
   */
  quotingEnabled: boolean
}

export const DEFAULT_DECISION_POLICY: Pick<
  DecisionPolicyConfig,
  | 'expiryPullMinutes'
  | 'sizeDownEdgeMult'
  | 'sizeUpEdgeMult'
  | 'unwindThreshold'
  | 'maxSaneEdgeCents'
  | 'minCaptureCents'
  | 'edgePersistTicks'
  | 'twoSidedEdgeBandCents'
  | 'openingEdgeExtraCents'
  | 'openEdgeAddHalfSpread'
  | 'openMinEdgeCents'
  | 'hardFlatMinutes'
  | 'minCloseProfitCents'
  | 'stuckUnwindTicks'
  | 'markBleedCents'
  | 'quotingEnabled'
> = {
  expiryPullMinutes: 0.5,
  sizeDownEdgeMult: 1.5,
  sizeUpEdgeMult: 3,
  unwindThreshold: 1,
  maxSaneEdgeCents: 25,
  minCaptureCents: 1.5,
  edgePersistTicks: 3,
  twoSidedEdgeBandCents: 0,
  openingEdgeExtraCents: 0,
  openEdgeAddHalfSpread: false,
  openMinEdgeCents: 4,
  hardFlatMinutes: 2,
  minCloseProfitCents: 1.0,
  stuckUnwindTicks: 30,
  markBleedCents: 5,
  quotingEnabled: false,
}

/** Mutable edge-persistence counters carried across quote rebuilds. */
export interface EdgePersistState {
  bidTicks: number
  askTicks: number
}

export function emptyEdgePersistState(): EdgePersistState {
  return { bidTicks: 0, askTicks: 0 }
}

/** Per-book counter retained for session/journal compat (unused while quoting paused). */
export interface StuckUnwindState {
  ticks: number
  invSign: number
}

export function emptyStuckUnwindState(): StuckUnwindState {
  return { ticks: 0, invSign: 0 }
}

/** Effective minimum |edge| to *open* (add inventory). Kept for config/UI; unused while paused. */
export function effectiveOpeningMinEdgeCents(cfg: DecisionPolicyConfig): number {
  const openMin =
    Number.isFinite(cfg.openMinEdgeCents) && cfg.openMinEdgeCents > 0
      ? cfg.openMinEdgeCents
      : cfg.minEdgeCents
  let m = openMin + (cfg.openingEdgeExtraCents || 0)
  if (cfg.openEdgeAddHalfSpread) {
    m = Math.max(m, openMin + cfg.halfSpreadCents)
  }
  return m
}

export interface DecisionPolicyInput {
  mid: number
  fairValue: number | null
  edgeCents: number | null
  inventory: number
  bookBestBid: number | null
  bookBestAsk: number | null
  minutesRemaining: number | null
  running: boolean
  settled: boolean
  moneyPrinterBug: boolean
  spotGuardCancel: boolean
  guardWiden: boolean
  toxicBidPullUntil: number
  toxicAskPullUntil: number
  now: number
  config: DecisionPolicyConfig
  feedDownReason?: string | null
  edgePersist?: EdgePersistState | null
  avgEntry?: number | null
  stuckUnwind?: StuckUnwindState | null
}

export interface DecisionPolicyResult {
  bidActive: boolean
  askActive: boolean
  bidReason: string
  askReason: string
  bothOffReason: string | null
  yesBid: number
  yesAsk: number
  size: number
  skewCents: number
  halfSpreadCents: number
  centerMode: 'fv' | 'mid'
  active: boolean
  unwindActive: boolean
  edgePersist: EdgePersistState
  stuckUnwind: StuckUnwindState
  /** Optional legacy / journal id — not used to drive quotes (U3.0). */
  bidScenario?: string
  askScenario?: string
  activeScenario?: string
}

function parkBoth(
  reason: string,
  partial: Partial<DecisionPolicyResult> &
    Pick<
      DecisionPolicyResult,
      'yesBid' | 'yesAsk' | 'size' | 'skewCents' | 'halfSpreadCents' | 'centerMode'
    >,
  persist: EdgePersistState = emptyEdgePersistState(),
  stuck: StuckUnwindState = emptyStuckUnwindState(),
): DecisionPolicyResult {
  return {
    bidActive: false,
    askActive: false,
    bidReason: `both OFF: ${reason}`,
    askReason: `both OFF: ${reason}`,
    bothOffReason: reason,
    active: false,
    unwindActive: false,
    edgePersist: persist,
    stuckUnwind: stuck,
    bidScenario: undefined,
    askScenario: undefined,
    activeScenario: undefined,
    ...partial,
  }
}

/**
 * Refuse fills that increase inventory when already at/over unwindThreshold
 * or past maxInventory on that side. Settlement fills bypass via caller.
 */
export function canAcceptInventoryIncreasingFill(
  side: 'buy_yes' | 'sell_yes',
  inventory: number,
  maxInventory: number,
  unwindThreshold: number,
): boolean {
  const thresh = Math.max(1, Math.floor(unwindThreshold))
  if (side === 'buy_yes') {
    if (inventory >= maxInventory) return false
    if (inventory >= thresh) return false
    return true
  }
  if (inventory <= -maxInventory) return false
  if (inventory <= -thresh) return false
  return true
}

/**
 * Resting maker capture vs FV in cents. Null if FV unavailable.
 * Bid: FV − bid; ask: ask − FV.
 */
export function makerCaptureCents(
  side: 'bid' | 'ask',
  restingPx: number,
  fairValue: number | null,
): number | null {
  if (fairValue == null || !Number.isFinite(fairValue)) return null
  if (!Number.isFinite(restingPx)) return null
  if (side === 'bid') return (fairValue - restingPx) * 100
  return (restingPx - fairValue) * 100
}

/**
 * Maker-only clamp: bid ≤ bestBid (join touch), ask ≥ bestAsk.
 * Never cross the live BBO — prevents taker_cross fee bleed when FV is far from mid.
 */
export function clampQuotesMakerOnly(
  bid: number,
  ask: number,
  bookBestBid: number | null,
  bookBestAsk: number | null,
): { bid: number; ask: number } {
  let b = clampPx(bid)
  let a = clampPx(ask)
  const hasBid = bookBestBid != null && Number.isFinite(bookBestBid) && bookBestBid > 0
  const hasAsk = bookBestAsk != null && Number.isFinite(bookBestAsk) && bookBestAsk > 0

  if (hasBid) {
    b = clampPx(Math.min(b, bookBestBid!))
  }
  if (hasAsk) {
    a = clampPx(Math.max(a, bookBestAsk!))
  }
  if (hasAsk && !(b < bookBestAsk!)) {
    b = clampPx(bookBestAsk! - 0.01)
  }
  if (hasBid && !(a > bookBestBid!)) {
    a = clampPx(bookBestBid! + 0.01)
  }
  if (!(a > b)) {
    if (hasBid && hasAsk && bookBestAsk! > bookBestBid!) {
      b = clampPx(bookBestBid!)
      a = clampPx(bookBestAsk!)
    } else {
      a = clampPx(b + 0.01)
    }
  }
  return { bid: b, ask: a }
}

/**
 * Decide which sides (if any) to quote.
 * U3.0: always both OFF while quotingEnabled is false (default), or until a
 * replacement quote path is implemented. Does not use S1–S5 scenarios.
 */
export function decideQuoteSides(input: DecisionPolicyInput): DecisionPolicyResult {
  const cfg = input.config
  let half = cfg.halfSpreadCents
  if (input.guardWiden) half += cfg.guardWidenCents

  const skewCents = input.inventory * cfg.inventorySkewCentsPerUnit
  const skew = skewCents / 100
  const size = Math.max(1, Math.floor(cfg.quoteSize))

  let yesBid = 0.01
  let yesAsk = 0.99
  let centerMode: 'fv' | 'mid' = 'mid'
  if (isValidQuoteMid(input.mid)) {
    const center =
      cfg.fvQuoting && input.fairValue != null && Number.isFinite(input.fairValue)
        ? input.fairValue
        : input.mid
    centerMode =
      cfg.fvQuoting && input.fairValue != null && Number.isFinite(input.fairValue)
        ? 'fv'
        : 'mid'
    yesBid = clampPx(center - half / 100 - skew)
    yesAsk = clampPx(center + half / 100 - skew)
    if (!(yesAsk > yesBid)) {
      yesAsk = clampPx(yesBid + 0.01)
    }
    const clamped = clampQuotesMakerOnly(
      yesBid,
      yesAsk,
      input.bookBestBid,
      input.bookBestAsk,
    )
    yesBid = clamped.bid
    yesAsk = clamped.ask
  }

  const blank = {
    yesBid,
    yesAsk,
    size,
    skewCents,
    halfSpreadCents: half,
    centerMode,
  }

  const persist = emptyEdgePersistState()
  const stuck = emptyStuckUnwindState()

  if (input.moneyPrinterBug) {
    return parkBoth('money printer freeze', blank, persist, stuck)
  }
  if (!input.running) {
    return parkBoth('not running', blank, persist, stuck)
  }
  if (input.settled) {
    return parkBoth('settled', blank, persist, stuck)
  }
  if (input.feedDownReason) {
    return parkBoth(input.feedDownReason, blank, persist, stuck)
  }

  // U3.0 hard pause — no S1–S5 / FV-edge opens even if quotingEnabled flipped early.
  if (!cfg.quotingEnabled) {
    return parkBoth(QUOTING_PAUSED_REASON, blank, persist, stuck)
  }

  // Flag on but no replacement logic yet (do not resurrect scenario playbook).
  return parkBoth(QUOTING_PAUSED_REASON, blank, persist, stuck)
}
