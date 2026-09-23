/**
 * U3.1 Family E — Digital FV + inventory skew + hard τ-flatten.
 *
 * Research: docs/research/U3_QUOTE_LOGIC_RESEARCH.md §9 Family E
 * (digital N(d2) + AS-style skew + Guéant hard Q + settlement blackout).
 * Paper-only — never places live orders. Not S1–S5.
 */

import { clampPx } from './prices'

/** Fail-loud messages (strip / bothOffReason). */
export const U31_NO_SPOT = 'U3.1: no spot — needs Binance US/Coinbase'
export const U31_NO_STRIKE = 'U3.1: no strike — needs floor_strike'
export const U31_NO_TAU = 'U3.1: no τ — needs closeTime'
export const U31_NO_FV = 'U3.1: no fair value — needs spot + strike + τ'
export const U31_BLACKOUT = 'U3.1: settlement blackout'

/** Plain tags for journal — not S1–S5. */
export type FamilyETag = 'open' | 'flatten' | 'blackout' | 'max_inv' | 'paused'

export interface FamilyESkewConfig {
  inventorySkewCentsPerUnit: number
  hardFlatMinutes: number
  /** Extra skew multiplier × (hardFlatMinutes / τ). Default 1. */
  tauSkewAccel: number
}

/**
 * AS-style inventory skew (cents), accelerating as τ→0.
 * Positive inventory → positive skew → reservation shifts down (favor selling).
 */
export function familyESkewCents(
  inventory: number,
  minutesRemaining: number,
  cfg: FamilyESkewConfig,
): number {
  const tau = Math.max(
    Number.isFinite(minutesRemaining) ? minutesRemaining : 0,
    1e-3,
  )
  const flat = Math.max(cfg.hardFlatMinutes, 0)
  const accel = 1 + Math.max(0, cfg.tauSkewAccel) * (flat / tau)
  return inventory * cfg.inventorySkewCentsPerUnit * accel
}

/** Reservation mid r = FV − skew(q,τ) in dollars. */
export function familyEReservation(
  fairValue: number,
  inventory: number,
  minutesRemaining: number,
  cfg: FamilyESkewConfig,
): { reservation: number; skewCents: number } {
  const skewCents = familyESkewCents(inventory, minutesRemaining, cfg)
  return {
    reservation: fairValue - skewCents / 100,
    skewCents,
  }
}

/** Clamp probability quotes to (ε, 1−ε) then tick-round (LAS insight). */
export function clampProbEps(p: number, eps: number): number {
  const e = Math.min(0.49, Math.max(0.001, eps))
  if (!Number.isFinite(p)) return 0.5
  // Do not use asDollarPrice/roundPx here — values outside [0,1] must clamp, not /100.
  const clamped = Math.min(1 - e, Math.max(e, p))
  return Math.round(clamped * 100) / 100
}

export interface FamilyEQuotePricesInput {
  fairValue: number
  inventory: number
  minutesRemaining: number
  halfSpreadCents: number
  inventorySkewCentsPerUnit: number
  hardFlatMinutes: number
  tauSkewAccel: number
  quoteClampEpsilon: number
  bookBestBid: number | null
  bookBestAsk: number | null
  /** When true, apply maker-only BBO join (never cross). */
  makerOnly?: boolean
  clampQuotesMakerOnly?: (
    bid: number,
    ask: number,
    bookBestBid: number | null,
    bookBestAsk: number | null,
  ) => { bid: number; ask: number }
}

export interface FamilyEQuotePrices {
  yesBid: number
  yesAsk: number
  reservation: number
  skewCents: number
  halfSpreadCents: number
}

/** Posted bid/ask around reservation with half-spread + ε clamp (+ optional maker). */
export function familyEQuotePrices(input: FamilyEQuotePricesInput): FamilyEQuotePrices {
  const half = Math.max(0, input.halfSpreadCents)
  const { reservation, skewCents } = familyEReservation(
    input.fairValue,
    input.inventory,
    input.minutesRemaining,
    {
      inventorySkewCentsPerUnit: input.inventorySkewCentsPerUnit,
      hardFlatMinutes: input.hardFlatMinutes,
      tauSkewAccel: input.tauSkewAccel,
    },
  )
  const eps = input.quoteClampEpsilon
  let yesBid = clampProbEps(reservation - half / 100, eps)
  let yesAsk = clampProbEps(reservation + half / 100, eps)
  if (!(yesAsk > yesBid)) {
    yesAsk = clampProbEps(yesBid + 0.01, eps)
  }
  if (input.makerOnly && input.clampQuotesMakerOnly) {
    const c = input.clampQuotesMakerOnly(
      yesBid,
      yesAsk,
      input.bookBestBid,
      input.bookBestAsk,
    )
    yesBid = clampProbEps(c.bid, eps)
    yesAsk = clampProbEps(c.ask, eps)
    if (!(yesAsk > yesBid)) {
      yesAsk = clampProbEps(yesBid + 0.01, eps)
    }
  } else {
    yesBid = clampPx(yesBid)
    yesAsk = clampPx(yesAsk)
  }
  return { yesBid, yesAsk, reservation, skewCents, halfSpreadCents: half }
}

/**
 * Side arms under Family E hard rules (blackout handled by caller).
 * Flatten: only inventory-reducing side. Max |q|: withdraw adding side.
 */
export function familyESideArms(input: {
  inventory: number
  maxInventory: number
  minutesRemaining: number
  hardFlatMinutes: number
}): {
  bidActive: boolean
  askActive: boolean
  bidReason: string
  askReason: string
  unwindActive: boolean
  tag: FamilyETag
} {
  const q = input.inventory
  const maxQ = Math.max(1, Math.floor(input.maxInventory))
  const mins = input.minutesRemaining
  const inFlatten =
    Number.isFinite(mins) && mins <= input.hardFlatMinutes && q !== 0

  if (inFlatten) {
    if (q > 0) {
      return {
        bidActive: false,
        askActive: true,
        bidReason: 'flatten: no new longs',
        askReason: 'flatten: reduce long',
        unwindActive: true,
        tag: 'flatten',
      }
    }
    return {
      bidActive: true,
      askActive: false,
      bidReason: 'flatten: reduce short',
      askReason: 'flatten: no new shorts',
      unwindActive: true,
      tag: 'flatten',
    }
  }

  let bidActive = true
  let askActive = true
  let bidReason = 'open'
  let askReason = 'open'
  let tag: FamilyETag = 'open'

  if (q >= maxQ) {
    bidActive = false
    bidReason = 'max inventory: no buy'
    tag = 'max_inv'
  }
  if (q <= -maxQ) {
    askActive = false
    askReason = 'max inventory: no sell'
    tag = 'max_inv'
  }

  return { bidActive, askActive, bidReason, askReason, unwindActive: false, tag }
}
