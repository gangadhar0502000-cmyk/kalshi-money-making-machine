/**
 * Explicit, testable decision policy for paper MM quoting.
 * U3.2 House rules v1 — mid-centered maker (not Family E FV opens / not S1–S5).
 * Retains U3.1.1 extreme-mid refuse + U3.1.2 blackout flatten.
 * Paper research only — never places live orders.
 */

import { clampPx, isValidQuoteMid } from './prices'
import {
  U31_BLACKOUT,
  U312_BLACKOUT_FLATTEN,
  U31_NO_FV,
  familyESideArms,
} from './digitalFvQuote'
import {
  U32_HOUSE_MID,
  U32_NO_MID,
  U323_NO_LATE_OPENS,
  U323_LONG_OPEN_CURB,
  DEFAULT_LONG_OPEN_MIN_MID,
  aggressiveFlattenPrices,
  isFlattenHouseTag,
  houseMidQuotePrices,
  type HouseTag,
} from './houseMidQuote'

export {
  U321_STUCK_NO_BID,
  U321_STUCK_NO_ASK,
  isFlattenHouseTag,
  U323_NO_LATE_OPENS,
  U323_LONG_OPEN_CURB,
  DEFAULT_LONG_OPEN_MIN_MID,
  toHouseFillTag,
} from './houseMidQuote'

/** Fail-loud strip / reason when paper quotes stay OFF (U3.0 legacy pause). */
export const QUOTING_PAUSED_REASON =
  'U3.0: paper quoting paused — needs new quote logic'

export {
  U31_BLACKOUT,
  U312_BLACKOUT_FLATTEN,
  U31_NO_FV,
  U31_NO_SPOT,
  U31_NO_STRIKE,
  U31_NO_TAU,
} from './digitalFvQuote'

export { U32_HOUSE_MID, U32_NO_MID, U32_RANK_LIQUIDITY } from './houseMidQuote'

/** U3.1.1: flat inventory + pinned extreme mid — no new opens. */
export const U311_EXTREME_MID = 'U3.1.1: extreme mid — no new opens'

export interface DecisionPolicyConfig {
  halfSpreadCents: number
  quoteSize: number
  maxInventory: number
  inventorySkewCentsPerUnit: number
  guardWidenCents: number
  toxicMidLow: number
  toxicMidHigh: number
  minEdgeCents: number
  /** Legacy alias; blackoutMinutes is preferred for U3.1.x gates. */
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
   * When false, never arm bid/ask (U3.0 pause). Default true for house mid.
   */
  quotingEnabled: boolean
  /**
   * U3.1.2: when minutesRemaining ≤ this — flat inventory parks both
   * (settlement blackout); inventory ≠ 0 forces flatten-only (exit).
   * Default ~0.75 min.
   */
  blackoutMinutes: number
  /**
   * Clamp posted probs to (ε, 1−ε). Default 0.01.
   */
  quoteClampEpsilon: number
  /**
   * Skew accel × (hardFlatMinutes / τ). Default 1.
   */
  tauSkewAccel: number
  /**
   * U3.2.3: refuse NEW long YES opens when mid ≤ this (dollars 0–1).
   * Dig evidence: low-mid longs repeatedly died via flatten@1¢. Default 0.40.
   * Short opens / flatten reduces still allowed.
   */
  longOpenMinMid: number
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
  | 'longOpenMinMid'
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
  longOpenMinMid: DEFAULT_LONG_OPEN_MIN_MID,
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
  /**
   * Legacy Family E FV block — U3.2 ignores for quote arming (FV is telemetry only).
   * Kept on the input so callers can still compute/pass it without effect.
   */
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
  /** Plain tags: house_mid / open / flatten / blackout / blackout_flatten — not S1–S5. */
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
  tag?: HouseTag,
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
 * Bid: FV − bid; ask: ask − FV. Telemetry only under U3.2.
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
 * Never cross the live BBO.
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
 * U3.2 house mid when quotingEnabled; else U3.0 pause. No S1–S5 / no FV center.
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

  const midOk = isValidQuoteMid(input.mid)
  const mins =
    input.minutesRemaining != null && Number.isFinite(input.minutesRemaining)
      ? input.minutesRemaining
      : null

  let yesBid = 0.01
  let yesAsk = 0.99
  let skewCents = 0
  const centerMode: 'fv' | 'mid' = 'mid'

  if (midOk && mins != null) {
    const priced = houseMidQuotePrices({
      mid: input.mid,
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
  } else if (midOk) {
    // Display-only mid center when τ missing (still parked below).
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

  // --- U3.2 House mid path (FV / fvBlockReason do NOT center or gate opens) ---
  if (!midOk) {
    return parkBoth(U32_NO_MID, blank, persist, stuck)
  }
  if (mins == null) {
    return parkBoth(U32_NO_MID, blank, persist, stuck)
  }

  // U3.1.2: blackout + flat → park both; blackout + inventory → flatten-only
  const inBlackout = mins <= blackout
  if (inBlackout && input.inventory === 0) {
    return parkBoth(U31_BLACKOUT, blank, persist, stuck, 'blackout')
  }
  const forceBlackoutFlatten = inBlackout && input.inventory !== 0

  // U3.2.3: hardFlat + flat → no new opens (inv≠0 still flattens via arms below)
  const hardFlat =
    Number.isFinite(cfg.hardFlatMinutes) && cfg.hardFlatMinutes >= 0
      ? cfg.hardFlatMinutes
      : 2
  if (!forceBlackoutFlatten && mins <= hardFlat && input.inventory === 0) {
    return parkBoth(U323_NO_LATE_OPENS, blank, persist, stuck)
  }

  const arms = familyESideArms({
    inventory: input.inventory,
    maxInventory: cfg.maxInventory,
    minutesRemaining: mins,
    // Force flatten even if blackoutMinutes > hardFlatMinutes.
    hardFlatMinutes: forceBlackoutFlatten
      ? Math.max(cfg.hardFlatMinutes, mins)
      : cfg.hardFlatMinutes,
  })

  let bidActive = arms.bidActive
  let askActive = arms.askActive
  let bidReason = arms.bidReason
  let askReason = arms.askReason
  const unwindActive = arms.unwindActive
  let tag: HouseTag = forceBlackoutFlatten ? 'blackout_flatten' : arms.tag
  if (tag === 'open') tag = 'house_mid'
  if (forceBlackoutFlatten) {
    if (input.inventory > 0) {
      bidReason = `${U312_BLACKOUT_FLATTEN} — no new longs`
      askReason = U312_BLACKOUT_FLATTEN
    } else {
      bidReason = U312_BLACKOUT_FLATTEN
      askReason = `${U312_BLACKOUT_FLATTEN} — no new shorts`
    }
  } else if (tag === 'house_mid') {
    bidReason = U32_HOUSE_MID
    askReason = U32_HOUSE_MID
  }

  
  // U3.2.1: in flatten / blackout_flatten, price exit through the touch so L2 can fill.
  // Maker-only join leaves ask above a 1¢ dump and never exits — hit bid (long) / lift ask (short).
  if (unwindActive && isFlattenHouseTag(tag)) {
    const flatPx = aggressiveFlattenPrices({
      inventory: input.inventory,
      yesBid,
      yesAsk,
      bookBestBid: input.bookBestBid,
      bookBestAsk: input.bookBestAsk,
      quoteClampEpsilon: eps,
    })
    yesBid = flatPx.yesBid
    yesAsk = flatPx.yesAsk
    if (flatPx.stuckReason) {
      if (input.inventory > 0) {
        askReason = flatPx.stuckReason
      } else if (input.inventory < 0) {
        bidReason = flatPx.stuckReason
      }
    }
  }

  // U3.1.1 symmetric extreme-mid: refuse opens; keep reduce/flatten side.
  const mid = input.mid
  const inv = input.inventory
  {
    const atLow = mid <= cfg.toxicMidLow
    const atHigh = mid >= cfg.toxicMidHigh
    if ((atLow || atHigh) && inv === 0) {
      return parkBoth(U311_EXTREME_MID, blank, persist, stuck, 'extreme_mid')
    }
    if ((atLow || atHigh) && bidActive && inv >= 0) {
      bidActive = false
      bidReason = atHigh
        ? `U3.1.1: no new longs @ mid ≥ ${(cfg.toxicMidHigh * 100).toFixed(0)}¢`
        : `U3.1.1: no new longs @ mid ≤ ${(cfg.toxicMidLow * 100).toFixed(0)}¢`
    }
    if ((atLow || atHigh) && askActive && inv <= 0) {
      askActive = false
      askReason = atLow
        ? `U3.1.1: no new shorts @ mid ≤ ${(cfg.toxicMidLow * 100).toFixed(0)}¢`
        : `U3.1.1: no new shorts @ mid ≥ ${(cfg.toxicMidHigh * 100).toFixed(0)}¢`
    }
  }

  // U3.2.3: curb NEW long opens when mid in bleed band (shorts / covers OK)
  {
    const minLong =
      Number.isFinite(cfg.longOpenMinMid) && cfg.longOpenMinMid > 0
        ? cfg.longOpenMinMid
        : DEFAULT_LONG_OPEN_MIN_MID
    if (mid <= minLong && bidActive && inv >= 0 && !unwindActive) {
      bidActive = false
      bidReason = U323_LONG_OPEN_CURB
    }
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
    centerMode: 'mid',
    active,
    unwindActive,
    edgePersist: persist,
    stuckUnwind: stuck,
    bidScenario: bidActive ? tag : undefined,
    askScenario: askActive ? tag : undefined,
    activeScenario: tag,
  }
}
