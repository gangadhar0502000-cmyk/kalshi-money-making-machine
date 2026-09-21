/**
 * Explicit, testable decision policy for paper MM quoting.
 * Default = NO TRADE. Engine must call this before activating any side.
 * Paper research only — never places live orders; positive P&L not guaranteed.
 *
 * Priority (hard → smart):
 * 1. Hard parks (money printer / not running / settled / feed / guard / expiry / bad mid)
 * 2. Inventory unwind (ALWAYS beats edge gate — stuck longs must be able to sell)
 * 3. Edge sanity cap (absurd |FV−mid| or near-0/1 mid vs conflicting FV → park, except unwind)
 * 4. Edge mode only adds inventory when flat-ish and |edge| ≥ minEdge
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
}

export const DEFAULT_DECISION_POLICY: Pick<
  DecisionPolicyConfig,
  | 'expiryPullMinutes'
  | 'sizeDownEdgeMult'
  | 'sizeUpEdgeMult'
  | 'unwindThreshold'
  | 'maxSaneEdgeCents'
> = {
  expiryPullMinutes: 0.5,
  sizeDownEdgeMult: 1.5,
  sizeUpEdgeMult: 3,
  unwindThreshold: 1,
  maxSaneEdgeCents: 25,
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
): DecisionPolicyResult {
  return {
    bidActive: false,
    askActive: false,
    bidReason: `both OFF: ${reason}`,
    askReason: `both OFF: ${reason}`,
    bothOffReason: reason,
    active: false,
    unwindActive: false,
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

  const blank = {
    yesBid: 0.01,
    yesAsk: 0.99,
    size: Math.max(1, cfg.quoteSize),
    skewCents,
    halfSpreadCents: half,
    centerMode: 'mid' as const,
  }

  if (input.moneyPrinterBug) {
    return parkBoth('money printer freeze', blank)
  }
  if (!input.running) {
    return parkBoth('not running', blank)
  }
  if (input.settled) {
    return parkBoth('settled', blank)
  }
  if (input.feedDownReason) {
    return parkBoth(input.feedDownReason, blank)
  }
  if (input.spotGuardCancel) {
    return parkBoth('spot guard cancel', blank)
  }

  const mins = input.minutesRemaining
  if (mins != null && Number.isFinite(mins) && mins < cfg.expiryPullMinutes) {
    return parkBoth('expiry pull', blank)
  }

  const midValid = isValidQuoteMid(input.mid)
  if (!midValid) {
    return parkBoth('invalid mid', blank)
  }

  if (
    input.bookBestBid != null &&
    input.bookBestAsk != null &&
    Number.isFinite(input.bookBestBid) &&
    Number.isFinite(input.bookBestAsk) &&
    !(input.bookBestAsk > input.bookBestBid)
  ) {
    return parkBoth('incoherent book spread', blank)
  }

  const useFv = cfg.fvQuoting && input.fairValue != null && midValid
  // FV mode: require FV for *edge* quoting — but inventory unwind may proceed on mid
  if (cfg.fvQuoting && !useFv && !needAskUnwind && !needBidUnwind) {
    return parkBoth('no FV', { ...blank, centerMode: 'mid' })
  }

  const center = useFv ? input.fairValue! : input.mid
  const centerMode: 'fv' | 'mid' = useFv ? 'fv' : 'mid'

  let bid = clampPx(center - half / 100 - skew)
  let ask = clampPx(center + half / 100 - skew)
  if (!(ask > bid)) {
    ask = clampPx(bid + 0.01)
  }
  if (!(ask > bid)) {
    return parkBoth('incoherent quote spread', {
      yesBid: 0.01,
      yesAsk: 0.99,
      size: Math.max(1, cfg.quoteSize),
      skewCents,
      halfSpreadCents: half,
      centerMode,
    })
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
    return parkBoth('edge sanity', {
      yesBid: 0.01,
      yesAsk: 0.99,
      size,
      skewCents,
      halfSpreadCents: half,
      centerMode,
    })
  }

  let bidActive = false
  let askActive = false
  let bidReason = 'bid OFF: parked'
  let askReason = 'ask OFF: parked'
  let unwindActive = false

  // ========== 1. INVENTORY UNWIND (priority over edge gate) ==========
  if (needAskUnwind) {
    if (!midOkAsk) {
      askActive = false
      askReason = 'ask OFF: toxic mid'
    } else if (toxicAskPull) {
      // After toxic sell we pull ask briefly; still prefer unwind — only block if still toxic mid
      askActive = false
      askReason = 'ask OFF: toxic fill pull'
    } else {
      askActive = true
      askReason = 'ask ON: inventory unwind'
      unwindActive = true
      ask = priceUnwindAsk(input.mid, half, input.bookBestBid, input.bookBestAsk)
      // Re-price bid placeholder so spread stays coherent if bid also on
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
  // Bid for edge: only if not in long-unwind-only, under max, edge ≥ min
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
        if (edge == null || edge < cfg.minEdgeCents) {
          if (!bidActive) {
            bidActive = false
            bidReason = 'bid OFF: no edge'
          }
        } else {
          const longPenalty =
            input.inventory > 0 ? input.inventory * cfg.inventorySkewCentsPerUnit : 0
          if (edge < cfg.minEdgeCents + longPenalty) {
            if (!bidActive) {
              bidActive = false
              bidReason = 'bid OFF: inventory skew'
            }
          } else {
            bidActive = true
            bidReason = `bid ON: ${fmtEdge(edge)}`
          }
        }
      }
    } else if (!bidActive) {
      bidActive = true
      bidReason = 'bid ON: mid mode'
    }
  } else if (atMaxLong || needAskUnwind) {
    // Never bid into max long / while unwinding a long
    if (!bidActive) {
      bidActive = false
      bidReason = atMaxLong ? 'bid OFF: max inventory' : 'bid OFF: unwind-only (long)'
    }
  }

  // Ask for edge: only if not in short-unwind-only, above -max, edge ≤ −min
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
        if (edge == null || -edge < cfg.minEdgeCents) {
          if (!askActive) {
            askActive = false
            askReason = 'ask OFF: no edge'
          }
        } else {
          const shortPenalty =
            input.inventory < 0 ? Math.abs(input.inventory) * cfg.inventorySkewCentsPerUnit : 0
          if (-edge < cfg.minEdgeCents + shortPenalty) {
            if (!askActive) {
              askActive = false
              askReason = 'ask OFF: inventory skew'
            }
          } else {
            askActive = true
            askReason = `ask ON: ${fmtEdge(edge)}`
          }
        }
      }
    } else if (!askActive) {
      askActive = true
      askReason = 'ask ON: mid mode'
    }
  } else if (atMaxShort || needBidUnwind) {
    if (!askActive) {
      askActive = false
      askReason = atMaxShort ? 'ask OFF: max inventory' : 'ask OFF: unwind-only (short)'
    }
  }

  // After toxic buy: inventory may be long — unwind ask already forced above.
  // Ensure toxic bid pull does not also kill the unwind ask (it doesn't).

  // Maker-only: clamp any live quote to never cross BBO (FV/unwind safe)
  if (bidActive || askActive) {
    const clamped = clampQuotesMakerOnly(bid, ask, input.bookBestBid, input.bookBestAsk)
    bid = clamped.bid
    ask = clamped.ask
    if (!(ask > bid)) {
      return parkBoth('incoherent quote after maker clamp', {
        yesBid: 0.01,
        yesAsk: 0.99,
        size,
        skewCents,
        halfSpreadCents: half,
        centerMode,
      })
    }
  }

  // Park inactive sides away from the touch
  const yesBid = bidActive ? bid : 0.01
  const yesAsk = askActive ? ask : 0.99

  let bothOffReason: string | null = null
  if (!bidActive && !askActive) {
    if (sanityBroken) {
      bothOffReason = 'edge sanity'
    } else if (
      cfg.fvQuoting &&
      (input.edgeCents == null || Math.abs(input.edgeCents) < cfg.minEdgeCents)
    ) {
      bothOffReason = 'no edge'
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
  }
}
