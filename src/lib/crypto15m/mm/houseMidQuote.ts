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
export type HouseTag = FamilyETag | 'house_mid'

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
