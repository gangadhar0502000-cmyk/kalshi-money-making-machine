/**
 * Explicit, testable decision policy for paper MM quoting.
 * Default = NO TRADE. Engine must call this before activating any side.
 * Paper research only — never places live orders; positive P&L not guaranteed.
 *
 * Priority (hard → smart):
 * 1. Hard parks (money printer / not running / settled / feed / guard / expiry / bad mid)
 * 2. Inventory unwind (ALWAYS beats edge gate — stuck longs must be able to sell)
 * 3. Edge sanity cap (absurd |FV−mid| or near-0/1 mid vs conflicting FV → park, except unwind)
 * 4. Edge mode only adds inventory when flat-ish, |edge| ≥ opening min, edge persisted,
 *    and maker-clamped resting price still captures ≥ minCaptureCents vs FV
 * 5. One-sided discipline: never both sides when |edge| ≥ minEdge (unless unwind)
 */

import { clampPx, isValidQuoteMid } from './prices'
import { allowAskAtMid, allowBidAtMid } from './toxicity'

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
> = {
  expiryPullMinutes: 0.5,
  sizeDownEdgeMult: 1.5,
  sizeUpEdgeMult: 3,
  unwindThreshold: 1,
  maxSaneEdgeCents: 25,
  minCaptureCents: 1,
  edgePersistTicks: 3,
  twoSidedEdgeBandCents: 0,
  openingEdgeExtraCents: 0,
  openEdgeAddHalfSpread: false,
}

/** Mutable edge-persistence counters carried across quote rebuilds. */
export interface EdgePersistState {
  bidTicks: number
  askTicks: number
}

export function emptyEdgePersistState(): EdgePersistState {
  return { bidTicks: 0, askTicks: 0 }
}

/** Effective minimum |edge| to *open* (add inventory). Unwind ignores this. */
export function effectiveOpeningMinEdgeCents(cfg: DecisionPolicyConfig): number {
  let m = cfg.minEdgeCents + (cfg.openingEdgeExtraCents || 0)
  if (cfg.openEdgeAddHalfSpread) {
    m = Math.max(m, cfg.minEdgeCents + cfg.halfSpreadCents)
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
}

function fmtEdge(edgeCents: number): string {
  const sign = edgeCents >= 0 ? '+' : ''
  return `FV−mid=${sign}${edgeCents.toFixed(1)}¢`
}

function parkBoth(
  reason: string,
  partial: Partial<DecisionPolicyResult> &
    Pick<
      DecisionPolicyResult,
      'yesBid' | 'yesAsk' | 'size' | 'skewCents' | 'halfSpreadCents' | 'centerMode'
    >,
  persist: EdgePersistState = emptyEdgePersistState(),
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

function resolveUnwindThreshold(cfg: DecisionPolicyConfig): number {
  const raw = cfg.unwindThreshold
  if (!Number.isFinite(raw) || raw <= 0) return 1
  return Math.max(1, Math.floor(raw))
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
  const unwindThresh = resolveUnwindThreshold(cfg)
  const needAskUnwind = input.inventory >= unwindThresh
  const needBidUnwind = input.inventory <= -unwindThresh
  const openMin = effectiveOpeningMinEdgeCents(cfg)
  const persistNeeded = resolvePersistNeeded(cfg)
  const prevPersist = input.edgePersist ?? emptyEdgePersistState()
  let nextPersist: EdgePersistState = { ...prevPersist }

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
  if (input.spotGuardCancel) {
    return parkBoth('spot guard cancel', blank, resetPersist())
  }

  const mins = input.minutesRemaining
  if (mins != null && Number.isFinite(mins) && mins < cfg.expiryPullMinutes) {
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
  // FV mode: require FV for *edge* quoting — but inventory unwind may proceed on mid
  if (cfg.fvQuoting && !useFv && !needAskUnwind && !needBidUnwind) {
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
  if (cfg.fvQuoting && input.edgeCents != null && !needAskUnwind && !needBidUnwind) {
    if (absEdge < cfg.minEdgeCents * cfg.sizeDownEdgeMult) {
      size = Math.max(1, Math.floor(cfg.quoteSize / 2))
    } else if (absEdge >= cfg.minEdgeCents * cfg.sizeUpEdgeMult) {
      size = Math.min(cfg.quoteSize * 2, cfg.maxInventory)
    }
  }
  // Unwind size = min(quoteSize, |inventory|)
  if (needAskUnwind || needBidUnwind) {
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
  if (sanityBroken && !needAskUnwind && !needBidUnwind) {
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

  // ========== 1. INVENTORY UNWIND (priority over edge gate) ==========
  if (needAskUnwind) {
    if (!midOkAsk) {
      askActive = false
      askReason = 'ask OFF: toxic mid'
    } else if (toxicAskPull) {
      askActive = false
      askReason = 'ask OFF: toxic fill pull'
    } else {
      askActive = true
      askReason = 'ask ON: inventory unwind'
      unwindActive = true
      ask = priceUnwindAsk(input.mid, half, input.bookBestBid, input.bookBestAsk)
      if (!(ask > bid)) bid = clampPx(ask - 0.01)
    }
  }

  if (needBidUnwind) {
    if (!midOkBid) {
      bidActive = false
      bidReason = 'bid OFF: toxic mid'
    } else if (toxicBidPull) {
      bidActive = false
      bidReason = 'bid OFF: toxic fill pull'
    } else {
      bidActive = true
      bidReason = 'bid ON: inventory unwind'
      unwindActive = true
      bid = priceUnwindBid(input.mid, half, input.bookBestBid, input.bookBestAsk)
      if (!(ask > bid)) ask = clampPx(bid + 0.01)
    }
  }

  // ========== 2. EDGE MODE — only add inventory when flat-ish ==========
  if (!needAskUnwind && !atMaxLong) {
    if (!midOkBid) {
      if (!bidActive) {
        bidActive = false
        bidReason = 'bid OFF: toxic mid'
      }
    } else if (toxicBidPull) {
      if (!bidActive) {
        bidActive = false
        bidReason = 'bid OFF: toxic fill pull'
      }
    } else if (cfg.fvQuoting) {
      if (sanityBroken) {
        if (!bidActive) {
          bidActive = false
          bidReason = 'bid OFF: edge sanity'
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
          }
        } else {
          const longPenalty =
            input.inventory > 0 ? input.inventory * cfg.inventorySkewCentsPerUnit : 0
          if (edge < openMin + longPenalty) {
            if (!bidActive) {
              bidActive = false
              bidReason = 'bid OFF: inventory skew'
            }
          } else {
            bidEdgeCandidate = true
          }
        }
      }
    } else if (!bidActive) {
      bidEdgeCandidate = true
    }
  } else if (atMaxLong || needAskUnwind) {
    if (!bidActive) {
      bidActive = false
      bidReason = atMaxLong ? 'bid OFF: max inventory' : 'bid OFF: unwind-only (long)'
    }
  }

  if (!needBidUnwind && !atMaxShort) {
    if (!midOkAsk) {
      if (!askActive) {
        askActive = false
        askReason = 'ask OFF: toxic mid'
      }
    } else if (toxicAskPull && !needAskUnwind) {
      if (!askActive) {
        askActive = false
        askReason = 'ask OFF: toxic fill pull'
      }
    } else if (cfg.fvQuoting) {
      if (sanityBroken && !needAskUnwind) {
        if (!askActive) {
          askActive = false
          askReason = 'ask OFF: edge sanity'
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
            }
          } else {
            askEdgeCandidate = true
          }
        }
      }
    } else if (!askActive) {
      askEdgeCandidate = true
    }
  } else if (atMaxShort || needBidUnwind) {
    if (!askActive) {
      askActive = false
      askReason = atMaxShort ? 'ask OFF: max inventory' : 'ask OFF: unwind-only (short)'
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
    }
  } else if (askEdgeCandidate) {
    nextPersist = { bidTicks: 0, askTicks: prevPersist.askTicks + 1 }
    if (nextPersist.askTicks < persistNeeded) {
      askReason = `ask OFF: edge flicker ${nextPersist.askTicks}/${persistNeeded}`
      askEdgeCandidate = false
    }
  } else {
    nextPersist = emptyEdgePersistState()
  }

  // Promote persisted edge candidates (unwind already set active)
  if (bidEdgeCandidate && !bidActive) {
    bidActive = true
    const edge = input.edgeCents ?? 0
    bidReason =
      persistNeeded > 1
        ? `bid ON: ${fmtEdge(edge)} persist`
        : `bid ON: ${fmtEdge(edge)}`
  }
  if (askEdgeCandidate && !askActive) {
    askActive = true
    const edge = input.edgeCents ?? 0
    askReason =
      persistNeeded > 1
        ? `ask ON: ${fmtEdge(edge)} persist`
        : `ask ON: ${fmtEdge(edge)}`
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
    if (edgeForSide > 0 && askActive && !needAskUnwind) {
      askActive = false
      askReason = 'ask OFF: one-sided (bid edge)'
    }
    if (edgeForSide < 0 && bidActive && !needBidUnwind) {
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
    if (bidActive && !needBidUnwind && !/unwind/i.test(bidReason)) {
      const cap = makerCaptureCents('bid', bid, input.fairValue)
      if (cap == null || cap < minCap) {
        bidActive = false
        bidReason = 'bid OFF: clamp killed edge'
      }
    }
    if (askActive && !needAskUnwind && !/unwind/i.test(askReason)) {
      const cap = makerCaptureCents('ask', ask, input.fairValue)
      if (cap == null || cap < minCap) {
        askActive = false
        askReason = 'ask OFF: clamp killed edge'
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
  }
}
