/**
 * Explicit, testable decision policy for paper MM quoting.
 * Default = S5 NO_TRADE. Engine must call this before activating any side.
 * Paper research only — never places live orders; positive P&L not guaranteed.
 *
 * Only profitable scenarios may open/close (see profitableScenarios.ts + RULES.md):
 *   S1 OPEN_BID · S2 OPEN_ASK · S3 CLOSE_PROFIT · S4 CLOSE_RISK · S4.1 STUCK_UNWIND · S5 NO_TRADE
 *
 * Priority (hard → smart):
 * 1. Hard parks (money printer / not running / settled / feed / bad mid)
 * 2. S3/S4 reduce quotes (profit close or forced risk flat) beat edge opens
 * 3. Edge sanity cap (absurd |FV−mid| → park, except S4)
 * 4. S1/S2 opens when |edge| ≥ openMinEdgeCents, persisted, maker capture OK
 * 5. One-sided discipline: never both sides into a one-sided edge
 */

import { clampPx, isValidQuoteMid } from './prices'
import { allowAskAtMid, allowBidAtMid } from './toxicity'
import {
  type ScenarioId,
  DEFAULT_SCENARIO_THRESHOLDS,
  evaluateClose,
  formatOpenOn,
  pickActiveScenario,
} from './profitableScenarios'

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
  /**
   * When |edge| < minEdge * sizeDownEdgeMult → size down.
   * When |edge| >= minEdge * sizeUpEdgeMult → size up (capped).
   */
  sizeDownEdgeMult: number
  sizeUpEdgeMult: number
  /**
   * Absolute |inventory| at/above which unwind quotes take priority over the edge gate.
   * Default 1 — any non-flat book must be able to reduce risk.
   */
  unwindThreshold: number
  /**
   * Park (except unwind) when |edgeCents| exceeds this — near-zero mid vs FV≈1 junk.
   */
  maxSaneEdgeCents: number
  /**
   * After maker clamp to BBO, resting price must still capture ≥ this many cents
   * vs FV (bid: FV−bid; ask: ask−FV). Default 1¢. Opening sides only; unwind exempt.
   */
  minCaptureCents: number
  /**
   * Consecutive quote rebuilds where edge sign+threshold must hold before a side
   * turns ON (~3–5s at default quoteRefreshMs). Drop immediately on flip/insanity.
   * 1 = activate on first qualifying tick (tests / loose).
   */
  edgePersistTicks: number
  /**
   * When |edge| < this band AND inventory flat, both sides may quote.
   * Default 0 = never two-sided from edge mode (strict one-sided when |edge| ≥ minEdge).
   */
  twoSidedEdgeBandCents: number
  /**
   * Extra cents added to minEdge for *opening* (inventory-adding) quotes only.
   * Unwind unchanged. Default 0.
   */
  openingEdgeExtraCents: number
  /**
   * When true, opening min also requires ≥ minEdge + halfSpreadCents.
   */
  openEdgeAddHalfSpread: boolean
  /** S1/S2 open bar (default 4¢). */
  openMinEdgeCents: number
  /** No opens / S4 when minutesRemaining < this (default 2). */
  hardFlatMinutes: number
  /** S3 voluntary close min signed capture vs avgEntry (default 1¢). */
  minCloseProfitCents: number
  /**
   * S4.1: consecutive quote ticks with S3 reduce blocked by minCloseProfit
   * before break-even (≥0¢) escalate. Default 30 (~45s @ 1.5s refresh).
   */
  stuckUnwindTicks: number
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
}

/** Mutable edge-persistence counters carried across quote rebuilds. */
export interface EdgePersistState {
  bidTicks: number
  askTicks: number
}

export function emptyEdgePersistState(): EdgePersistState {
  return { bidTicks: 0, askTicks: 0 }
}

/** Per-book counter for S4.1 STUCK_UNWIND escalation. */
export interface StuckUnwindState {
  /** Consecutive ticks where reduce was blocked by S3 minCloseProfit. */
  ticks: number
  /** Inventory sign while counting: 1 long, -1 short, 0 flat. */
  invSign: number
}

export function emptyStuckUnwindState(): StuckUnwindState {
  return { ticks: 0, invSign: 0 }
}

/** Effective minimum |edge| to *open* (add inventory). Unwind ignores this. */
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
  /** Epoch ms — pull bid until this time after toxic buy fill. */
  toxicBidPullUntil: number
  /** Epoch ms — pull ask until this time after toxic sell fill. */
  toxicAskPullUntil: number
  now: number
  config: DecisionPolicyConfig
  /** Optional loud global reason (e.g. live feed down) — forces both OFF. */
  feedDownReason?: string | null
  /** Prior persist counters (from last rebuild). */
  edgePersist?: EdgePersistState | null
  /** Avg entry of open inventory (dollars 0–1) — required for S3 CLOSE_PROFIT. */
  avgEntry?: number | null
  /** Prior S4.1 stuck-unwind counters (from last rebuild). */
  stuckUnwind?: StuckUnwindState | null
}

export interface DecisionPolicyResult {
  bidActive: boolean
  askActive: boolean
  bidReason: string
  askReason: string
  /** Set when both sides share one parked reason. */
  bothOffReason: string | null
  yesBid: number
  yesAsk: number
  size: number
  skewCents: number
  halfSpreadCents: number
  centerMode: 'fv' | 'mid'
  active: boolean
  /** True when ask (or bid) was forced on for inventory reduction. */
  unwindActive: boolean
  /** Updated persist counters for the next rebuild. */
  edgePersist: EdgePersistState
  /** Updated S4.1 stuck counters for the next rebuild. */
  stuckUnwind: StuckUnwindState
  bidScenario: ScenarioId
  askScenario: ScenarioId
  /** Dominant scenario for UI ("Active scenario"). */
  activeScenario: ScenarioId
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
    bidScenario: 'S5',
    askScenario: 'S5',
    activeScenario: 'S5',
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
    if (inventory >= thresh) return false // unwind-only: no more longs
    return true
  }
  // sell_yes increases short (more negative inventory)
  if (inventory <= -maxInventory) return false
  if (inventory <= -thresh) return false // unwind-only: no more shorts
  return true
}

/**
 * Mid near 0/1 with a large conflicting FV → absurd edge (screenshot +95¢ symptom).
 */
function edgeFailsSanity(
  mid: number,
  fairValue: number | null,
  edgeCents: number | null,
  maxSane: number,
): boolean {
  if (edgeCents != null && Math.abs(edgeCents) > maxSane) return true
  if (fairValue == null || edgeCents == null) return false
  // Near-zero mid with FV far above, or near-one mid with FV far below
  if (mid <= 0.05 && fairValue >= 0.5 && edgeCents > maxSane * 0.5) return true
  if (mid >= 0.95 && fairValue <= 0.5 && -edgeCents > maxSane * 0.5) return true
  return false
}

function resolvePersistNeeded(cfg: DecisionPolicyConfig): number {
  const raw = cfg.edgePersistTicks
  if (!Number.isFinite(raw) || raw <= 1) return 1
  return Math.min(30, Math.floor(raw))
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
    // Join touch or sit behind — never bid through bestAsk / above bestBid
    b = clampPx(Math.min(b, bookBestBid!))
  }
  if (hasAsk) {
    a = clampPx(Math.max(a, bookBestAsk!))
  }
  // Belt: still must not cross the opposite BBO side
  if (hasAsk && !(b < bookBestAsk!)) {
    b = clampPx(bookBestAsk! - 0.01)
  }
  if (hasBid && !(a > bookBestBid!)) {
    a = clampPx(bookBestBid! + 0.01)
  }
  if (!(a > b)) {
    // Keep a coherent one-tick spread after clamp
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
 * Unwind ask: join live best ask (maker) — never cross to take bids.
 */
function priceUnwindAsk(
  mid: number,
  half: number,
  bookBestBid: number | null,
  bookBestAsk: number | null,
): number {
  let ask = clampPx(mid + half / 100)
  if (bookBestAsk != null && Number.isFinite(bookBestAsk) && bookBestAsk > 0) {
    // Prefer join touch as maker when long
    ask = clampPx(bookBestAsk)
  }
  if (bookBestBid != null && Number.isFinite(bookBestBid) && !(ask > bookBestBid)) {
    ask = clampPx(bookBestBid + 0.01)
  }
  return ask
}

/**
 * Unwind bid: join live best bid (maker) — never cross to take asks.
 */
function priceUnwindBid(
  mid: number,
  half: number,
  bookBestBid: number | null,
  bookBestAsk: number | null,
): number {
  let bid = clampPx(mid - half / 100)
  if (bookBestBid != null && Number.isFinite(bookBestBid) && bookBestBid > 0) {
    // Prefer join touch as maker when short
    bid = clampPx(bookBestBid)
  }
  if (bookBestAsk != null && Number.isFinite(bookBestAsk) && !(bid < bookBestAsk)) {
    bid = clampPx(bookBestAsk - 0.01)
  }
  return bid
}

/**
 * Decide which sides (if any) to quote. Pure / deterministic.
 */
export function decideQuoteSides(input: DecisionPolicyInput): DecisionPolicyResult {
  const cfg = input.config
  let half = cfg.halfSpreadCents
  if (input.guardWiden) half += cfg.guardWidenCents

  const skewCents = input.inventory * cfg.inventorySkewCentsPerUnit
  const skew = skewCents / 100
  const openMin = effectiveOpeningMinEdgeCents(cfg)
  const persistNeeded = resolvePersistNeeded(cfg)
  const prevPersist = input.edgePersist ?? emptyEdgePersistState()
  let nextPersist: EdgePersistState = { ...prevPersist }
  const prevStuck = input.stuckUnwind ?? emptyStuckUnwindState()
  let nextStuck: StuckUnwindState = { ...prevStuck }

  const blank = {
    yesBid: 0.01,
    yesAsk: 0.99,
    size: Math.max(1, cfg.quoteSize),
    skewCents,
    halfSpreadCents: half,
    centerMode: 'mid' as const,
  }

  const resetPersist = (): EdgePersistState => {
    nextPersist = emptyEdgePersistState()
    return nextPersist
  }

  if (input.moneyPrinterBug) {
    return parkBoth('money printer freeze', blank, resetPersist())
  }
  if (!input.running) {
    return parkBoth('not running', blank, resetPersist())
  }
  if (input.settled) {
    return parkBoth('settled', blank, resetPersist())
  }
  if (input.feedDownReason) {
    return parkBoth(input.feedDownReason, blank, resetPersist())
  }
  // Spot-guard cancel: park opens; inventory may still S4 risk-flat below.
  const spotGuardCancelParkOpens = input.spotGuardCancel
  if (input.spotGuardCancel && input.inventory === 0) {
    return parkBoth('spot guard cancel', blank, resetPersist())
  }

  const mins = input.minutesRemaining
  const hardFlat = Number.isFinite(cfg.hardFlatMinutes) ? cfg.hardFlatMinutes : 2
  const inHardFlat =
    mins != null && Number.isFinite(mins) && mins < hardFlat
  const inExpiryPull =
    mins != null && Number.isFinite(mins) && mins < cfg.expiryPullMinutes
  // Expiry pull parks only when flat — inventory may still S4 risk-flat.
  if (inExpiryPull && input.inventory === 0) {
    return parkBoth('expiry pull', blank, resetPersist())
  }

  const midValid = isValidQuoteMid(input.mid)
  if (!midValid) {
    return parkBoth('invalid mid', blank, resetPersist())
  }

  if (
    input.bookBestBid != null &&
    input.bookBestAsk != null &&
    Number.isFinite(input.bookBestBid) &&
    Number.isFinite(input.bookBestAsk) &&
    !(input.bookBestAsk > input.bookBestBid)
  ) {
    return parkBoth('incoherent book spread', blank, resetPersist())
  }

  const useFv = cfg.fvQuoting && input.fairValue != null && midValid
  // FV mode: require FV for *edge* quoting — S3/S4 reduce may proceed on mid
  const hasInventory = input.inventory !== 0
  if (cfg.fvQuoting && !useFv && !hasInventory) {
    return parkBoth('no FV', { ...blank, centerMode: 'mid' }, resetPersist())
  }

  const center = useFv ? input.fairValue! : input.mid
  const centerMode: 'fv' | 'mid' = useFv ? 'fv' : 'mid'

  let bid = clampPx(center - half / 100 - skew)
  let ask = clampPx(center + half / 100 - skew)
  if (!(ask > bid)) {
    ask = clampPx(bid + 0.01)
  }
  if (!(ask > bid)) {
    return parkBoth(
      'incoherent quote spread',
      {
        yesBid: 0.01,
        yesAsk: 0.99,
        size: Math.max(1, cfg.quoteSize),
        skewCents,
        halfSpreadCents: half,
        centerMode,
      },
      resetPersist(),
    )
  }

  const absEdge = input.edgeCents != null ? Math.abs(input.edgeCents) : 0
  let size = cfg.quoteSize
  if (cfg.fvQuoting && input.edgeCents != null && !hasInventory) {
    if (absEdge < cfg.minEdgeCents * cfg.sizeDownEdgeMult) {
      size = Math.max(1, Math.floor(cfg.quoteSize / 2))
    } else if (absEdge >= cfg.minEdgeCents * cfg.sizeUpEdgeMult) {
      size = Math.min(cfg.quoteSize * 2, cfg.maxInventory)
    }
  }
  // Reduce size = min(quoteSize, |inventory|)
  if (hasInventory) {
    size = Math.max(1, Math.min(cfg.quoteSize, Math.abs(input.inventory)))
  }
  size = Math.max(1, Math.min(size, cfg.maxInventory))

  const atMaxLong = input.inventory >= cfg.maxInventory
  const atMaxShort = input.inventory <= -cfg.maxInventory
  const midOkBid = allowBidAtMid(input.mid, cfg.toxicMidLow)
  const midOkAsk = allowAskAtMid(input.mid, cfg.toxicMidHigh)
  const toxicBidPull = input.now < input.toxicBidPullUntil
  const toxicAskPull = input.now < input.toxicAskPullUntil

  const sanityBroken = edgeFailsSanity(
    input.mid,
    input.fairValue,
    input.edgeCents,
    cfg.maxSaneEdgeCents,
  )

  // --- Abs edge sanity: park edge mode (unwind still allowed) ---
  if (sanityBroken && !hasInventory) {
    return parkBoth(
      'edge sanity',
      {
        yesBid: 0.01,
        yesAsk: 0.99,
        size,
        skewCents,
        halfSpreadCents: half,
        centerMode,
      },
      resetPersist(),
    )
  }

  let bidActive = false
  let askActive = false
  let bidReason = 'bid OFF: parked'
  let askReason = 'ask OFF: parked'
  let unwindActive = false
  /** Edge-side candidates before persist / capture / one-sided gates. */
  let bidEdgeCandidate = false
  let askEdgeCandidate = false

  // ========== 1. S3 CLOSE_PROFIT / S4 CLOSE_RISK (priority over edge opens) ==========
  let bidScenario: ScenarioId = 'S5'
  let askScenario: ScenarioId = 'S5'
  const avgEntry = input.avgEntry ?? null
  const minClose =
    Number.isFinite(cfg.minCloseProfitCents) ? Math.max(0, cfg.minCloseProfitCents) : 1
  const holdingSide: 'long' | 'short' | 'flat' =
    input.inventory > 0 ? 'long' : input.inventory < 0 ? 'short' : 'flat'
  const riskInputBase = {
    minutesRemaining: mins,
    inventory: input.inventory,
    maxInventory: cfg.maxInventory,
    hardFlatMinutes: hardFlat,
    spotGuardCancel: input.spotGuardCancel,
    guardWidenExtreme: input.guardWiden && inHardFlat,
    mid: input.mid,
    toxicMidLow: cfg.toxicMidLow,
    toxicMidHigh: cfg.toxicMidHigh,
    holdingSide,
  }

  // Pre-price unwind touches for capture checks (maker join)
  const unwindAskPx = priceUnwindAsk(input.mid, half, input.bookBestBid, input.bookBestAsk)
  const unwindBidPx = priceUnwindBid(input.mid, half, input.bookBestBid, input.bookBestAsk)

  // S4.1 stuck counter: same-sign inventory only; reset on flat / flip / allow
  const invSign =
    input.inventory > 0 ? 1 : input.inventory < 0 ? -1 : 0
  const stuckThresh =
    Number.isFinite(cfg.stuckUnwindTicks) && cfg.stuckUnwindTicks > 0
      ? Math.max(1, Math.floor(cfg.stuckUnwindTicks))
      : DEFAULT_SCENARIO_THRESHOLDS.stuckUnwindTicks
  const baseStuckTicks =
    invSign !== 0 && prevStuck.invSign === invSign ? prevStuck.ticks : 0

  const applyStuckAfterClose = (closeDec: ReturnType<typeof evaluateClose>) => {
    if (invSign === 0) {
      nextStuck = emptyStuckUnwindState()
      return
    }
    if (closeDec.allow) {
      // S3 / S4 / S4.1 succeeded — clear stuck counter
      nextStuck = { ticks: 0, invSign }
      return
    }
    // Only escalate on S3 profit-bar blocks (CLOSE blocked: capture …)
    if (/CLOSE blocked:\s*capture/i.test(closeDec.reason)) {
      nextStuck = { ticks: baseStuckTicks + 1, invSign }
    } else {
      nextStuck = { ticks: 0, invSign }
    }
  }

  if (input.inventory > 0) {
    // Long → only ask can reduce
    if (!midOkAsk) {
      askActive = false
      askReason = 'ask OFF: toxic mid'
      askScenario = 'S5'
      nextStuck = { ticks: 0, invSign }
    } else if (toxicAskPull) {
      askActive = false
      askReason = 'ask OFF: toxic fill pull'
      askScenario = 'S5'
      nextStuck = { ticks: 0, invSign }
    } else {
      const candidateStuck = baseStuckTicks + 1
      const closeDec = evaluateClose({
        side: 'ask',
        price: unwindAskPx,
        avgEntry,
        inventory: input.inventory,
        minCloseProfitCents: minClose,
        risk: { ...riskInputBase, holdingSide: 'long' },
        stuckBlockedTicks: candidateStuck,
        stuckUnwindTicks: stuckThresh,
      })
      applyStuckAfterClose(closeDec)
      if (closeDec.allow) {
        askActive = true
        askReason = closeDec.reason
        askScenario = closeDec.scenario
        unwindActive = true
        ask = unwindAskPx
        if (!(ask > bid)) bid = clampPx(ask - 0.01)
      } else {
        askActive = false
        askReason = closeDec.reason
        askScenario = 'S5'
      }
    }
  } else if (input.inventory < 0) {
    if (!midOkBid) {
      bidActive = false
      bidReason = 'bid OFF: toxic mid'
      bidScenario = 'S5'
      nextStuck = { ticks: 0, invSign }
    } else if (toxicBidPull) {
      bidActive = false
      bidReason = 'bid OFF: toxic fill pull'
      bidScenario = 'S5'
      nextStuck = { ticks: 0, invSign }
    } else {
      const candidateStuck = baseStuckTicks + 1
      const closeDec = evaluateClose({
        side: 'bid',
        price: unwindBidPx,
        avgEntry,
        inventory: input.inventory,
        minCloseProfitCents: minClose,
        risk: { ...riskInputBase, holdingSide: 'short' },
        stuckBlockedTicks: candidateStuck,
        stuckUnwindTicks: stuckThresh,
      })
      applyStuckAfterClose(closeDec)
      if (closeDec.allow) {
        bidActive = true
        bidReason = closeDec.reason
        bidScenario = closeDec.scenario
        unwindActive = true
        bid = unwindBidPx
        if (!(ask > bid)) ask = clampPx(bid + 0.01)
      } else {
        bidActive = false
        bidReason = closeDec.reason
        bidScenario = 'S5'
      }
    }
  } else {
    nextStuck = emptyStuckUnwindState()
  }

  // Unwind-only flags for inventory-adding suppression
  const needAskUnwind = input.inventory > 0 && unwindActive && askActive
  // Also suppress adds whenever inventory is non-zero (scarce — reduce or hold, don't dig)
  // Any open inventory: no S1/S2 adds — only S3/S4 reduce (already decided above).
  const blockBidOpen = input.inventory !== 0 || atMaxLong || inHardFlat || spotGuardCancelParkOpens
  const blockAskOpen = input.inventory !== 0 || atMaxShort || inHardFlat || spotGuardCancelParkOpens

  // ========== 2. EDGE MODE — S1 / S2 opens only when flat-ish ==========
  if (!blockBidOpen) {
    if (!midOkBid) {
      if (!bidActive) {
        bidActive = false
        bidReason = 'bid OFF: toxic mid'
        bidScenario = 'S5'
      }
    } else if (toxicBidPull) {
      if (!bidActive) {
        bidActive = false
        bidReason = 'bid OFF: toxic fill pull'
        bidScenario = 'S5'
      }
    } else if (cfg.fvQuoting) {
      if (sanityBroken) {
        if (!bidActive) {
          bidActive = false
          bidReason = 'bid OFF: edge sanity'
          bidScenario = 'S5'
        }
      } else {
        const edge = input.edgeCents
        if (edge == null || edge < openMin) {
          if (!bidActive) {
            bidActive = false
            bidReason =
              edge == null || edge < cfg.minEdgeCents
                ? 'bid OFF: no edge'
                : `bid OFF: open min ${openMin.toFixed(1)}¢`
            bidScenario = 'S5'
          }
        } else {
          const longPenalty =
            input.inventory > 0 ? input.inventory * cfg.inventorySkewCentsPerUnit : 0
          if (edge < openMin + longPenalty) {
            if (!bidActive) {
              bidActive = false
              bidReason = 'bid OFF: inventory skew'
              bidScenario = 'S5'
            }
          } else {
            bidEdgeCandidate = true
          }
        }
      }
    } else if (!bidActive) {
      bidEdgeCandidate = true
    }
  } else if (!bidActive) {
    bidActive = false
    if (!/CLOSE blocked/i.test(bidReason)) {
      if (inHardFlat && input.inventory === 0) {
        bidReason = `bid OFF: hard flat <${hardFlat}m`
      } else if (atMaxLong) {
        bidReason = 'bid OFF: max inventory'
      } else if (input.inventory !== 0) {
        bidReason = 'bid OFF: unwind-only (long)'
      }
      bidScenario = 'S5'
    }
  }

  if (!blockAskOpen) {
    if (!midOkAsk) {
      if (!askActive) {
        askActive = false
        askReason = 'ask OFF: toxic mid'
        askScenario = 'S5'
      }
    } else if (toxicAskPull && !needAskUnwind) {
      if (!askActive) {
        askActive = false
        askReason = 'ask OFF: toxic fill pull'
        askScenario = 'S5'
      }
    } else if (cfg.fvQuoting) {
      if (sanityBroken && !needAskUnwind) {
        if (!askActive) {
          askActive = false
          askReason = 'ask OFF: edge sanity'
          askScenario = 'S5'
        }
      } else if (!needAskUnwind) {
        const edge = input.edgeCents
        if (edge == null || -edge < openMin) {
          if (!askActive) {
            askActive = false
            askReason =
              edge == null || -edge < cfg.minEdgeCents
                ? 'ask OFF: no edge'
                : `ask OFF: open min ${openMin.toFixed(1)}¢`
            askScenario = 'S5'
          }
        } else {
          const shortPenalty =
            input.inventory < 0
              ? Math.abs(input.inventory) * cfg.inventorySkewCentsPerUnit
              : 0
          if (-edge < openMin + shortPenalty) {
            if (!askActive) {
              askActive = false
              askReason = 'ask OFF: inventory skew'
              askScenario = 'S5'
            }
          } else {
            askEdgeCandidate = true
          }
        }
      }
    } else if (!askActive) {
      askEdgeCandidate = true
    }
  } else if (!askActive) {
    askActive = false
    if (!/CLOSE blocked/i.test(askReason)) {
      if (inHardFlat && input.inventory === 0) {
        askReason = `ask OFF: hard flat <${hardFlat}m`
      } else if (atMaxShort) {
        askReason = 'ask OFF: max inventory'
      } else if (input.inventory !== 0) {
        askReason = 'ask OFF: unwind-only (short)'
      }
      askScenario = 'S5'
    }
  }

  // ========== 3. EDGE PERSISTENCE (anti-flicker) ==========
  // Qualify → count up; flip / lose threshold / sanity → drop immediately.
  if (sanityBroken) {
    nextPersist = emptyEdgePersistState()
    bidEdgeCandidate = false
    askEdgeCandidate = false
  } else if (bidEdgeCandidate) {
    nextPersist = { bidTicks: prevPersist.bidTicks + 1, askTicks: 0 }
    if (nextPersist.bidTicks < persistNeeded) {
      bidReason = `bid OFF: edge flicker ${nextPersist.bidTicks}/${persistNeeded}`
      bidEdgeCandidate = false
      bidScenario = 'S5'
    }
  } else if (askEdgeCandidate) {
    nextPersist = { bidTicks: 0, askTicks: prevPersist.askTicks + 1 }
    if (nextPersist.askTicks < persistNeeded) {
      askReason = `ask OFF: edge flicker ${nextPersist.askTicks}/${persistNeeded}`
      askEdgeCandidate = false
      askScenario = 'S5'
    }
  } else if (!unwindActive) {
    nextPersist = emptyEdgePersistState()
  }

  // Promote persisted edge candidates (S1 / S2) — close scenarios already set
  if (bidEdgeCandidate && !bidActive) {
    bidActive = true
    const edge = input.edgeCents ?? 0
    bidReason = formatOpenOn('bid', 'S1', edge)
    bidScenario = 'S1'
  }
  if (askEdgeCandidate && !askActive) {
    askActive = true
    const edge = input.edgeCents ?? 0
    askReason = formatOpenOn('ask', 'S2', edge)
    askScenario = 'S2'
  }

    // ========== 4. ONE-SIDED DISCIPLINE ==========
  // Never quote both sides when |edge| ≥ minEdge (favored side only).
  // Allow both only when |edge| < twoSidedEdgeBand AND inventory flat (and not unwind).
  const flatInv = input.inventory === 0
  const twoSidedBand = Math.max(0, cfg.twoSidedEdgeBandCents || 0)
  const edgeForSide = input.edgeCents
  if (bidActive && askActive && !unwindActive) {
    const allowTwoSided =
      flatInv &&
      edgeForSide != null &&
      Math.abs(edgeForSide) < twoSidedBand &&
      twoSidedBand > 0
    if (!allowTwoSided) {
      if (edgeForSide != null && edgeForSide >= openMin) {
        askActive = false
        askReason = 'ask OFF: one-sided (bid edge)'
      } else if (edgeForSide != null && -edgeForSide >= openMin) {
        bidActive = false
        bidReason = 'bid OFF: one-sided (ask edge)'
      } else if (edgeForSide != null && edgeForSide > 0) {
        askActive = false
        askReason = 'ask OFF: one-sided (bid edge)'
      } else if (edgeForSide != null && edgeForSide < 0) {
        bidActive = false
        bidReason = 'bid OFF: one-sided (ask edge)'
      } else {
        bidActive = false
        askActive = false
        bidReason = 'both OFF: one-sided discipline'
        askReason = 'both OFF: one-sided discipline'
      }
    }
  }
  // When |edge| ≥ minEdge, hard-ensure the wrong side is off (except unwind)
  if (cfg.fvQuoting && edgeForSide != null && Math.abs(edgeForSide) >= cfg.minEdgeCents) {
    if (edgeForSide > 0 && askActive && !unwindActive) {
      askActive = false
      askReason = 'ask OFF: one-sided (bid edge)'
    }
    if (edgeForSide < 0 && bidActive && !unwindActive) {
      bidActive = false
      bidReason = 'bid OFF: one-sided (ask edge)'
    }
  }

  // Maker-only: clamp any live quote to never cross BBO
  if (bidActive || askActive) {
    const clamped = clampQuotesMakerOnly(bid, ask, input.bookBestBid, input.bookBestAsk)
    bid = clamped.bid
    ask = clamped.ask
    if (!(ask > bid)) {
      return parkBoth(
        'incoherent quote after maker clamp',
        {
          yesBid: 0.01,
          yesAsk: 0.99,
          size,
          skewCents,
          halfSpreadCents: half,
          centerMode,
        },
        nextPersist,
      )
    }
  }

  // ========== 5. MAKER CAPTURE CHECK (opening sides only; unwind exempt) ==========
  const minCap = Number.isFinite(cfg.minCaptureCents) ? Math.max(0, cfg.minCaptureCents) : 1
  if (cfg.fvQuoting && input.fairValue != null) {
    if (bidActive && bidScenario === 'S1') {
      const cap = makerCaptureCents('bid', bid, input.fairValue)
      if (cap == null || cap < minCap) {
        bidActive = false
        bidReason = 'bid OFF: clamp killed edge'
        bidScenario = 'S5'
      }
    }
    if (askActive && askScenario === 'S2') {
      const cap = makerCaptureCents('ask', ask, input.fairValue)
      if (cap == null || cap < minCap) {
        askActive = false
        askReason = 'ask OFF: clamp killed edge'
        askScenario = 'S5'
      }
    }
  }

  // Park inactive sides away from the touch
  const yesBid = bidActive ? bid : 0.01
  const yesAsk = askActive ? ask : 0.99

  let bothOffReason: string | null = null
  if (!bidActive && !askActive) {
    if (sanityBroken) {
      bothOffReason = 'edge sanity'
    } else if (/flicker/i.test(bidReason) || /flicker/i.test(askReason)) {
      bothOffReason = 'edge flicker'
      bidReason = 'both OFF: edge flicker'
      askReason = 'both OFF: edge flicker'
    } else if (
      cfg.fvQuoting &&
      (input.edgeCents == null || Math.abs(input.edgeCents) < openMin)
    ) {
      bothOffReason = 'no edge'
    } else if (/clamp killed/i.test(bidReason) || /clamp killed/i.test(askReason)) {
      bothOffReason = 'clamp killed edge'
    } else {
      bothOffReason = 'parked'
    }
  }

  if (!bidActive && bidScenario !== 'S5' && !bidReason.includes('CLOSE blocked')) {
    bidScenario = 'S5'
  }
  if (!askActive && askScenario !== 'S5' && !askReason.includes('CLOSE blocked')) {
    askScenario = 'S5'
  }
  const activeScenario = pickActiveScenario({
    bidActive,
    askActive,
    bidScenario,
    askScenario,
  })

  return {
    bidActive,
    askActive,
    bidReason,
    askReason,
    bothOffReason,
    yesBid,
    yesAsk,
    size,
    skewCents,
    halfSpreadCents: half,
    centerMode: unwindActive && !useFv ? 'mid' : centerMode,
    active: bidActive || askActive,
    unwindActive,
    edgePersist: nextPersist,
    stuckUnwind: nextStuck,
    bidScenario,
    askScenario,
    activeScenario,
  }
}
