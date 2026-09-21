/**
 * Explicit, testable decision policy for paper MM quoting.
 * Default = NO TRADE. Engine must call this before activating any side.
 * Paper research only — never places live orders; positive P&L not guaranteed.
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
}

export const DEFAULT_DECISION_POLICY: Pick<
  DecisionPolicyConfig,
  'expiryPullMinutes' | 'sizeDownEdgeMult' | 'sizeUpEdgeMult'
> = {
  expiryPullMinutes: 0.5,
  sizeDownEdgeMult: 1.5,
  sizeUpEdgeMult: 3,
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
}

function fmtEdge(edgeCents: number): string {
  const sign = edgeCents >= 0 ? '+' : ''
  return `FV−mid=${sign}${edgeCents.toFixed(1)}¢`
}

function parkBoth(
  reason: string,
  partial: Partial<DecisionPolicyResult> &
    Pick<DecisionPolicyResult, 'yesBid' | 'yesAsk' | 'size' | 'skewCents' | 'halfSpreadCents' | 'centerMode'>,
): DecisionPolicyResult {
  return {
    bidActive: false,
    askActive: false,
    bidReason: `both OFF: ${reason}`,
    askReason: `both OFF: ${reason}`,
    bothOffReason: reason,
    active: false,
    ...partial,
  }
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

  // Placeholder prices until we know center
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

  // Book spread coherence when L2 BBO present
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
  // FV mode: require FV — no silent mid-only spam
  if (cfg.fvQuoting && !useFv) {
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

  // Size scaling by |edge| (capped by quoteSize*2 and maxInventory)
  const absEdge = input.edgeCents != null ? Math.abs(input.edgeCents) : 0
  let size = cfg.quoteSize
  if (cfg.fvQuoting && input.edgeCents != null) {
    if (absEdge < cfg.minEdgeCents * cfg.sizeDownEdgeMult) {
      size = Math.max(1, Math.floor(cfg.quoteSize / 2))
    } else if (absEdge >= cfg.minEdgeCents * cfg.sizeUpEdgeMult) {
      size = Math.min(cfg.quoteSize * 2, cfg.maxInventory)
    }
  }
  size = Math.max(1, Math.min(size, cfg.maxInventory))

  const atMaxLong = input.inventory >= cfg.maxInventory
  const atMaxShort = input.inventory <= -cfg.maxInventory
  const midOkBid = allowBidAtMid(input.mid, cfg.toxicMidLow)
  const midOkAsk = allowAskAtMid(input.mid, cfg.toxicMidHigh)
  const toxicBidPull = input.now < input.toxicBidPullUntil
  const toxicAskPull = input.now < input.toxicAskPullUntil

  let bidActive = true
  let askActive = true
  let bidReason = 'ok'
  let askReason = 'ok'

  // --- Bid side ---
  if (atMaxLong) {
    bidActive = false
    bidReason = 'bid OFF: max inventory'
  } else if (!midOkBid) {
    bidActive = false
    bidReason = 'bid OFF: toxic mid'
  } else if (toxicBidPull) {
    bidActive = false
    bidReason = 'bid OFF: toxic fill pull'
  } else if (cfg.fvQuoting) {
    const edge = input.edgeCents
    if (edge == null) {
      bidActive = false
      bidReason = 'bid OFF: no edge'
    } else if (edge < cfg.minEdgeCents) {
      bidActive = false
      bidReason = 'bid OFF: no edge'
    } else {
      // Inventory long → require more edge to keep bidding
      const longPenalty = input.inventory > 0 ? input.inventory * cfg.inventorySkewCentsPerUnit : 0
      if (edge < cfg.minEdgeCents + longPenalty) {
        bidActive = false
        bidReason = 'bid OFF: inventory skew'
      } else {
        bidActive = true
        bidReason = `bid ON: ${fmtEdge(edge)}`
      }
    }
  } else {
    bidReason = 'bid ON: mid mode'
  }

  // --- Ask side ---
  if (atMaxShort) {
    askActive = false
    askReason = 'ask OFF: max inventory'
  } else if (!midOkAsk) {
    askActive = false
    askReason = 'ask OFF: toxic mid'
  } else if (toxicAskPull) {
    askActive = false
    askReason = 'ask OFF: toxic fill pull'
  } else if (cfg.fvQuoting) {
    const edge = input.edgeCents
    if (edge == null) {
      askActive = false
      askReason = 'ask OFF: no edge'
    } else if (-edge < cfg.minEdgeCents) {
      askActive = false
      askReason = 'ask OFF: no edge'
    } else {
      const shortPenalty = input.inventory < 0 ? Math.abs(input.inventory) * cfg.inventorySkewCentsPerUnit : 0
      if (-edge < cfg.minEdgeCents + shortPenalty) {
        askActive = false
        askReason = 'ask OFF: inventory skew'
      } else {
        askActive = true
        askReason = `ask ON: ${fmtEdge(edge)}`
      }
    }
  } else {
    askReason = 'ask ON: mid mode'
  }

  // Park inactive sides away from the touch
  const yesBid = bidActive ? bid : 0.01
  const yesAsk = askActive ? ask : 0.99

  let bothOffReason: string | null = null
  if (!bidActive && !askActive) {
    if (cfg.fvQuoting && (input.edgeCents == null || Math.abs(input.edgeCents) < cfg.minEdgeCents)) {
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
    centerMode,
    active: bidActive || askActive,
  }
}
