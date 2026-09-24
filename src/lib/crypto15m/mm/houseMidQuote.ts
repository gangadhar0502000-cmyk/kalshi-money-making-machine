/**
 * U3.2 House rules v1 — mid-centered maker quotes (not Family E FV opens).
 *
 * Reservation r = mid − skew(q,τ); posts mid ± halfSpread with inventory skew.
 * FV may still be computed elsewhere for UI/telemetry — must not center quotes.
 * Paper-only — never places live orders. Not S1–S5 / not complete-set.
 */

import { clampPx } from './prices'
import {
  clampProbEps,
  familyESkewCents,
  type FamilyESkewConfig,
  type FamilyETag,
} from './digitalFvQuote'

/** Fail-loud when mid unusable for house quotes. */
export const U32_NO_MID = 'U3.2: no mid — needs two-sided book'
/** Strip when mid-centered maker arms. */
export const U32_HOUSE_MID = 'U3.2: house mid quotes'
/** Ranking change — fail-loud for digests / comments. */
export const U32_RANK_LIQUIDITY =
  'U3.2: rank by L2 / mid quality — not |FV−mid|'

/** Plain tags — not S1–S5. `house_mid` = mid-centered open. */
export type HouseTag =
  | FamilyETag
  | 'house_mid'
  | 'house_cover'
  | 'house_close'
  | 'house_soft_exit'

/** @deprecated U3.2.4 parks flat via U324_NO_LATE_OPENS (τ ≤ noOpenMinutes). Kept for digests. */
export const U323_NO_LATE_OPENS = 'U3.2.3: no new opens — hardFlat τ'
/** U3.2.4: flat inventory + τ ≤ noOpenMinutes — no new opens (default 4m). */
export const U324_NO_LATE_OPENS = 'U3.2.4: no new opens — τ≤4m'
/** U3.2.3: refuse NEW long opens when mid is in the bleed band. */
export const U323_LONG_OPEN_CURB = 'U3.2.5: long open curb — mid ≤50¢'
/** U3.2.6: exit held longs when mid ≤ longOpenMinMid (would not open here). */
export const U326_HOUSE_SOFT_EXIT = 'U3.2.6: soft-exit long — mid ≤50¢'
/** Default floor mid for NEW long YES opens (U3.2.5: 0.50; was 0.40). */
export const DEFAULT_LONG_OPEN_MIN_MID = 0.5
/** Default minutes: park flat / reduce-only opens (U3.2.4). */
export const DEFAULT_NO_OPEN_MINUTES = 4

/**
 * Map legacy evaluateClose / leftover S* ids → house tags for NEW fill stamps.
 * Historical journals may still contain S1–S5; digests keep reading them.
 */
export function toHouseFillTag(scenario: string | null | undefined): string | undefined {
  if (scenario == null || scenario === '') return undefined
  if (scenario === 'S3') return 'house_cover'
  if (scenario === 'S4' || scenario === 'S4.1' || scenario === 'S4.2') return 'house_close'
  if (scenario === 'S1' || scenario === 'S2') return 'house_mid'
  if (scenario === 'S5' || scenario === 'S5.1') return 'house_close'
  if (/^S[1-5]/.test(scenario)) return 'house_close'
  return scenario
}

export type HouseSkewConfig = FamilyESkewConfig

/** AS-style skew (cents) — same helper as Family E inventory path. */
export function houseSkewCents(
  inventory: number,
  minutesRemaining: number,
  cfg: HouseSkewConfig,
): number {
  return familyESkewCents(inventory, minutesRemaining, cfg)
}

/** Reservation r = mid − skew(q,τ) in dollars. */
export function houseReservation(
  mid: number,
  inventory: number,
  minutesRemaining: number,
  cfg: HouseSkewConfig,
): { reservation: number; skewCents: number } {
  const skewCents = houseSkewCents(inventory, minutesRemaining, cfg)
  return {
    reservation: mid - skewCents / 100,
    skewCents,
  }
}

export interface HouseMidQuotePricesInput {
  mid: number
  inventory: number
  minutesRemaining: number
  halfSpreadCents: number
  inventorySkewCentsPerUnit: number
  hardFlatMinutes: number
  tauSkewAccel: number
  quoteClampEpsilon: number
  bookBestBid: number | null
  bookBestAsk: number | null
  makerOnly?: boolean
  clampQuotesMakerOnly?: (
    bid: number,
    ask: number,
    bookBestBid: number | null,
    bookBestAsk: number | null,
  ) => { bid: number; ask: number }
}

export interface HouseMidQuotePrices {
  yesBid: number
  yesAsk: number
  reservation: number
  skewCents: number
  halfSpreadCents: number
}

/** Posted bid/ask around book mid with half-spread + inventory skew (+ optional maker). */
export function houseMidQuotePrices(input: HouseMidQuotePricesInput): HouseMidQuotePrices {
  const half = Math.max(0, input.halfSpreadCents)
  const { reservation, skewCents } = houseReservation(
    input.mid,
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

/** U3.2.1: long flatten but book has no YES bid to hit. */
export const U321_STUCK_NO_BID = 'U3.2.1: stuck inventory, no bid'
/** U3.2.1: short flatten but book has no YES ask to lift. */
export const U321_STUCK_NO_ASK = 'U3.2.1: stuck inventory, no ask'

/** True for hard-τ / blackout / soft-exit inventory exit tags. */
export function isFlattenHouseTag(tag: string | null | undefined): boolean {
  return (
    tag === 'flatten' ||
    tag === 'blackout_flatten' ||
    tag === 'house_soft_exit'
  )
}

/**
 * U3.2.1 — price the exit side through the touch so L2 can fill.
 * Long → sell at best bid (taker); short → buy at best ask.
 * Maker-only join cannot exit a collapsing 1¢ book; this must not re-apply maker clamp.
 */
export function aggressiveFlattenPrices(input: {
  inventory: number
  yesBid: number
  yesAsk: number
  bookBestBid: number | null
  bookBestAsk: number | null
  quoteClampEpsilon: number
}): { yesBid: number; yesAsk: number; stuckReason: string | null } {
  const eps =
    Number.isFinite(input.quoteClampEpsilon) && input.quoteClampEpsilon > 0
      ? input.quoteClampEpsilon
      : 0.01
  let yesBid = input.yesBid
  let yesAsk = input.yesAsk
  const bidOk =
    input.bookBestBid != null &&
    Number.isFinite(input.bookBestBid) &&
    input.bookBestBid > 0
  const askOk =
    input.bookBestAsk != null &&
    Number.isFinite(input.bookBestAsk) &&
    input.bookBestAsk > 0 &&
    input.bookBestAsk < 1

  if (input.inventory > 0) {
    if (bidOk) {
      yesAsk = clampProbEps(input.bookBestBid as number, eps)
      yesBid = clampProbEps(Math.min(yesBid, yesAsk - 0.01), eps)
      if (!(yesAsk > yesBid)) yesBid = clampProbEps(yesAsk - 0.01, eps)
      return { yesBid, yesAsk, stuckReason: null }
    }
    return { yesBid, yesAsk, stuckReason: U321_STUCK_NO_BID }
  }
  if (input.inventory < 0) {
    if (askOk) {
      yesBid = clampProbEps(input.bookBestAsk as number, eps)
      yesAsk = clampProbEps(Math.max(yesAsk, yesBid + 0.01), eps)
      if (!(yesAsk > yesBid)) yesAsk = clampProbEps(yesBid + 0.01, eps)
      return { yesBid, yesAsk, stuckReason: null }
    }
    return { yesBid, yesAsk, stuckReason: U321_STUCK_NO_ASK }
  }
  return { yesBid, yesAsk, stuckReason: null }
}

/**
 * Mid-quality score for ranking (higher = better): room from toxic extremes.
 * Not |FV−mid|.
 */
export function midQualityScore(
  mid: number,
  toxicMidLow = 0.05,
  toxicMidHigh = 0.95,
): number {
  if (!Number.isFinite(mid)) return -1
  return Math.min(mid - toxicMidLow, toxicMidHigh - mid)
}
