/**
 * Explicit, testable decision policy for paper MM quoting.
 * U3.1: Family E — Digital FV + inventory skew + hard τ-flatten
 * (see docs/research/U3_QUOTE_LOGIC_RESEARCH.md §9 Family E).
 * S1–S5 scenario playbook is not used. Paper research only — never places live orders.
 */

import { clampPx, isValidQuoteMid } from './prices'
import {
  U31_BLACKOUT,
  U31_NO_FV,
  familyEQuotePrices,
  familyESideArms,
  type FamilyETag,
} from './digitalFvQuote'

/** Fail-loud strip / reason when paper quotes stay OFF (U3.0 legacy pause). */
export const QUOTING_PAUSED_REASON =
  'U3.0: paper quoting paused — needs new quote logic'

export {
  U31_BLACKOUT,
  U31_NO_FV,
  U31_NO_SPOT,
  U31_NO_STRIKE,
  U31_NO_TAU,
} from './digitalFvQuote'

export interface DecisionPolicyConfig {
  halfSpreadCents: number
  quoteSize: number
  maxInventory: number
  inventorySkewCentsPerUnit: number
  guardWidenCents: number
  toxicMidLow: number
  toxicMidHigh: number
  minEdgeCents: number
  /** Legacy alias; blackoutMinutes is preferred for U3.1. */
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
   * When false, never arm bid/ask (U3.0 pause). Default true once Family E is wired.
   */
  quotingEnabled: boolean
  /**
   * U3.1: both sides OFF when minutesRemaining ≤ this (settlement blackout).
   * Default ~0.75 min.
   */
  blackoutMinutes: number
  /**
   * U3.1: clamp posted probs to (ε, 1−ε). Default 0.01.
   */
  quoteClampEpsilon: number
  /**
   * U3.1: skew accel × (hardFlatMinutes / τ). Default 1.
   */
  tauSkewAccel: number
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
  | 'blackoutMinutes'
  | 'quoteClampEpsilon'
  | 'tauSkewAccel'
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
  quotingEnabled: true,
  blackoutMinutes: 0.75,
  quoteClampEpsilon: 0.01,
  tauSkewAccel: 1,
}

/** Mutable edge-persistence counters carried across quote rebuilds. */
export interface EdgePersistState {
  bidTicks: number
  askTicks: number
}

export function emptyEdgePersistState(): EdgePersistState {
  return { bidTicks: 0, askTicks: 0 }
}

/** Per-book counter retained for session/journal compat. */
export interface StuckUnwindState {
  ticks: number
  invSign: number
}

export function emptyStuckUnwindState(): StuckUnwindState {
  return { ticks: 0, invSign: 0 }
}

/** Effective minimum |edge| to *open* (add inventory). Kept for config/UI compat. */
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
  /** U3.1 fail-loud from engine when spot/strike/τ missing. */
  fvBlockReason?: string | null
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
  /** Plain Family E tags: open / flatten / blackout — not S1–S5. */
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
  tag?: FamilyETag,
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
    bidScenario: tag,
    askScenario: tag,
    activeScenario: tag,
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
 * U3.1 Family E when quotingEnabled; else U3.0 pause. No S1–S5.
 */
export function decideQuoteSides(input: DecisionPolicyInput): DecisionPolicyResult {
  const cfg = input.config
  let half = cfg.halfSpreadCents
  if (input.guardWiden) half += cfg.guardWidenCents

  const size = Math.max(1, Math.floor(cfg.quoteSize))
  const eps =
    Number.isFinite(cfg.quoteClampEpsilon) && cfg.quoteClampEpsilon > 0
      ? cfg.quoteClampEpsilon
      : 0.01
  const tauAccel =
    Number.isFinite(cfg.tauSkewAccel) && cfg.tauSkewAccel >= 0 ? cfg.tauSkewAccel : 1
  const blackout =
    Number.isFinite(cfg.blackoutMinutes) && cfg.blackoutMinutes >= 0
      ? cfg.blackoutMinutes
      : cfg.expiryPullMinutes

  const persist = emptyEdgePersistState()
  const stuck = emptyStuckUnwindState()

  const hasFv =
    cfg.fvQuoting && input.fairValue != null && Number.isFinite(input.fairValue)
  const mins =
    input.minutesRemaining != null && Number.isFinite(input.minutesRemaining)
      ? input.minutesRemaining
      : null

  let yesBid = 0.01
  let yesAsk = 0.99
  let skewCents = 0
  let centerMode: 'fv' | 'mid' = 'mid'

  if (hasFv && mins != null) {
    const priced = familyEQuotePrices({
      fairValue: input.fairValue!,
      inventory: input.inventory,
      minutesRemaining: mins,
      halfSpreadCents: half,
      inventorySkewCentsPerUnit: cfg.inventorySkewCentsPerUnit,
      hardFlatMinutes: cfg.hardFlatMinutes,
      tauSkewAccel: tauAccel,
      quoteClampEpsilon: eps,
      bookBestBid: input.bookBestBid,
      bookBestAsk: input.bookBestAsk,
      makerOnly: true,
      clampQuotesMakerOnly,
    })
    yesBid = priced.yesBid
    yesAsk = priced.yesAsk
    skewCents = priced.skewCents
    half = priced.halfSpreadCents
    centerMode = 'fv'
  } else if (isValidQuoteMid(input.mid)) {
    // Display-only mid center when FV unavailable (still parked if quoting on).
    skewCents = input.inventory * cfg.inventorySkewCentsPerUnit
    const skew = skewCents / 100
    yesBid = clampPx(input.mid - half / 100 - skew)
    yesAsk = clampPx(input.mid + half / 100 - skew)
    if (!(yesAsk > yesBid)) yesAsk = clampPx(yesBid + 0.01)
    const clamped = clampQuotesMakerOnly(
      yesBid,
      yesAsk,
      input.bookBestBid,
      input.bookBestAsk,
    )
    yesBid = clamped.bid
    yesAsk = clamped.ask
    centerMode = 'mid'
  }

  const blank = {
    yesBid,
    yesAsk,
    size,
    skewCents,
    halfSpreadCents: half,
    centerMode,
  }

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

  if (!cfg.quotingEnabled) {
    return parkBoth(QUOTING_PAUSED_REASON, blank, persist, stuck, 'paused')
  }

  // --- Family E path ---
  if (input.fvBlockReason) {
    return parkBoth(input.fvBlockReason, blank, persist, stuck)
  }
  if (!hasFv) {
    return parkBoth(U31_NO_FV, blank, persist, stuck)
  }
  if (mins == null) {
    return parkBoth(U31_NO_TAU, blank, persist, stuck)
  }

  if (mins <= blackout) {
    return parkBoth(U31_BLACKOUT, blank, persist, stuck, 'blackout')
  }

  const arms = familyESideArms({
    inventory: input.inventory,
    maxInventory: cfg.maxInventory,
    minutesRemaining: mins,
    hardFlatMinutes: cfg.hardFlatMinutes,
  })

  let bidActive = arms.bidActive
  let askActive = arms.askActive
  let bidReason = arms.bidReason
  let askReason = arms.askReason
  const unwindActive = arms.unwindActive
  let tag: FamilyETag = arms.tag

  // Toxic extreme mid overlays (safety; not S-scenarios)
  const mid = isValidQuoteMid(input.mid) ? input.mid : null
  if (mid != null && mid < cfg.toxicMidLow && bidActive) {
    bidActive = false
    bidReason = `toxic mid < ${(cfg.toxicMidLow * 100).toFixed(0)}¢`
  }
  if (mid != null && mid > cfg.toxicMidHigh && askActive) {
    askActive = false
    askReason = `toxic mid > ${(cfg.toxicMidHigh * 100).toFixed(0)}¢`
  }

  if (input.now < input.toxicBidPullUntil && bidActive) {
    bidActive = false
    bidReason = 'toxic fill pull'
  }
  if (input.now < input.toxicAskPullUntil && askActive) {
    askActive = false
    askReason = 'toxic fill pull'
  }

  // Spot-guard cancel parks opens; flatten reduce may stay (engine may also gate).
  if (input.spotGuardCancel && !unwindActive) {
    return parkBoth('spot guard cancel', blank, persist, stuck, tag)
  }
  if (input.spotGuardCancel && unwindActive) {
    if (input.inventory > 0) {
      bidActive = false
      bidReason = 'guard: flatten ask only'
    } else if (input.inventory < 0) {
      askActive = false
      askReason = 'guard: flatten bid only'
    }
  }

  const active = bidActive || askActive
  return {
    bidActive,
    askActive,
    bidReason,
    askReason,
    bothOffReason: active ? null : `${bidReason} / ${askReason}`,
    yesBid,
    yesAsk,
    size,
    skewCents,
    halfSpreadCents: half,
    centerMode: 'fv',
    active,
    unwindActive,
    edgePersist: persist,
    stuckUnwind: stuck,
    bidScenario: bidActive ? tag : undefined,
    askScenario: askActive ? tag : undefined,
    activeScenario: tag,
  }
}
