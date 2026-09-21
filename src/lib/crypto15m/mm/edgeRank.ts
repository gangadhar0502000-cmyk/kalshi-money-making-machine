/**
 * Rank open crypto 15m markets by |FV − mid| for multi-book paper MM.
 * Pure helpers — no live orders.
 */

import type { Crypto15mMarket } from '../../../types/crypto15m'
import { asDollarPrice, isValidQuoteMid } from './prices'
import { edgeVsMidCents, estimateYesFairValue, resolveStrike } from './fairValue'
import { isMarketOpen } from './marketSelect'
import { canonicalMmAsset, normalizeSpotAsset } from '../spot'

/**
 * Multi-book universe: real KXBTC15M/KXETH15M/… up-down with a usable floorStrike.
 * Excludes CRYPTOLEAD / CRYPTOCOMP (no strike / leads-style) from ranking & slots.
 */
export function isMmQuoteUniverseMarket(market: {
  ticker?: string
  seriesTicker?: string
  floorStrike?: number | null
}): boolean {
  const series = (market.seriesTicker ?? '').toUpperCase()
  const ticker = (market.ticker ?? '').toUpperCase()
  if (series.includes('CRYPTOLEAD') || series.includes('CRYPTOCOMP')) return false
  if (ticker.includes('CRYPTOLEAD') || ticker.includes('CRYPTOCOMP')) return false
  const k = market.floorStrike
  if (k == null || !Number.isFinite(k) || k <= 0) return false
  return true
}

export type FvMissingReason = 'no_spot' | 'no_strike' | 'estimate_failed' | null

export interface RankedMarket {
  market: Crypto15mMarket
  asset: string
  ticker: string
  mid: number
  fairValue: number | null
  /** (FV − mid) in cents; null if no FV. */
  edgeCents: number | null
  absEdgeCents: number
  spot: number | null
  /** Effective strike used (API or spot-derived). */
  strike: number | null
  strikeSource: 'floor_strike' | 'spot_reference' | 'none'
  /** Why FV is blank when inputs incomplete. */
  fvMissingReason: FvMissingReason
  /** True when FV exists and |edge| ≥ minEdgeCents (at least one side could quote). */
  quoteEligible: boolean
  /**
   * True when FV/edge path is unavailable but mid is non-toxic —
   * multi-book may still fill the slot via mid-centered quoting.
   */
  midFallbackEligible: boolean
}

/**
 * Score one market given its asset spot. Missing spot/strike → null FV, absEdge 0.
 * When floorStrike missing but up/down rules + spot exist, derive K≈spot (documented).
 */
export function scoreMarketEdge(
  market: Crypto15mMarket,
  spot: number | null | undefined,
  annualVol: number,
  minEdgeCents: number,
  toxicMidLow = 0.05,
  toxicMidHigh = 0.95,
): RankedMarket {
  const midRaw = market.midYes
  const midOk = isValidQuoteMid(midRaw)
  const mid = midOk ? asDollarPrice(midRaw, 'rank.mid') : 0
  // True series asset for display / one-per-asset — never collapsed to BTC.
  const asset = canonicalMmAsset(market.asset)
  // Spot must be for THIS asset; callers pass null when unsupported / missing.
  const spotOk = spot != null && Number.isFinite(spot) && spot > 0 ? spot : null

  const resolved = resolveStrike(market.floorStrike, spotOk, {
    title: market.title,
    rulesPrimary: market.rulesPrimary,
  })

  let fairValue: number | null = null
  let edgeCents: number | null = null
  let fvMissingReason: FvMissingReason = null

  if (!spotOk) {
    fvMissingReason = 'no_spot'
  } else if (resolved.strike == null) {
    fvMissingReason = 'no_strike'
  } else {
    const est = estimateYesFairValue({
      spot: spotOk,
      strike: resolved.strike,
      minutesRemaining: market.minutesRemaining,
      annualVol,
    })
    if (est) {
      fairValue = est.fairProb
      // Never publish wild EDGE from mid=0/null vs FV≈0.99 (empty book / window boundary).
      if (midOk) {
        edgeCents = edgeVsMidCents(est.fairProb, mid)
      }
    } else {
      fvMissingReason = 'estimate_failed'
    }
  }

  const absEdgeCents = edgeCents != null ? Math.abs(edgeCents) : 0
  const midTradeable = midOk && mid > toxicMidLow && mid < toxicMidHigh
  const quoteEligible =
    midTradeable && edgeCents != null && absEdgeCents >= minEdgeCents
  const midFallbackEligible =
    midOk && fairValue == null && mid > toxicMidLow && mid < toxicMidHigh

  return {
    market,
    asset,
    ticker: market.ticker,
    mid,
    fairValue,
    edgeCents,
    absEdgeCents,
    spot: spotOk,
    strike: resolved.strike,
    strikeSource: resolved.source,
    fvMissingReason,
    quoteEligible,
    midFallbackEligible,
  }
}

/**
 * Rank open markets by |FV − mid| descending (null/zero edge last).
 * When spots differ by asset, FVs differ — ranking reflects that.
 */
export function rankMarketsByAbsEdge(
  markets: Crypto15mMarket[],
  spotsByAsset: Readonly<Record<string, number>>,
  annualVol: number,
  minEdgeCents: number,
  nowMs = Date.now(),
): RankedMarket[] {
  const open = markets.filter(
    (m) => isMarketOpen(m, nowMs) && isMmQuoteUniverseMarket(m),
  )
  const scored = open.map((m) => {
    const spotKey = normalizeSpotAsset(m.asset)
    const canon = canonicalMmAsset(m.asset)
    // Only use a spot keyed to the true asset — never fall back to BTC for ZEC/etc.
    const spot =
      spotKey != null
        ? (spotsByAsset[spotKey] ?? spotsByAsset[canon])
        : spotsByAsset[canon]
    return scoreMarketEdge(m, spot, annualVol, minEdgeCents)
  })
  scored.sort((a, b) => {
    if (b.absEdgeCents !== a.absEdgeCents) return b.absEdgeCents - a.absEdgeCents
    // Prefer quoteEligible over mid-fallback when abs edge ties at 0
    if (a.quoteEligible !== b.quoteEligible) return a.quoteEligible ? -1 : 1
    const ac = Date.parse(a.market.closeTime)
    const bc = Date.parse(b.market.closeTime)
    if (Number.isFinite(ac) && Number.isFinite(bc) && ac !== bc) return ac - bc
    return a.ticker.localeCompare(b.ticker)
  })
  return scored
}

export interface PickActiveOptions {
  /** Max concurrent books (enforced). */
  maxActive: number
  /** Prefer keeping these tickers if still open / ranked. */
  stickyTickers?: readonly string[]
  /** At most one open market per asset (default true). */
  onePerAsset?: boolean
  /**
   * Prefer quoteEligible (edge) markets for *new* slots (default true).
   * When under-filled, remaining slots fill via midFallbackEligible so we never
   * leave empty slots while open markets remain.
   */
  requireEdge?: boolean
  /** Fill remaining slots with mid-fallback markets (default true). */
  fillMidFallback?: boolean
}

/**
 * Pick up to maxActive markets: sticky first (if still present), then highest |edge|,
 * then mid-fallback fills so target is min(open, maxActive) whenever possible.
 * Cap is hard — never returns more than maxActive.
 */
export function pickActiveMarkets(
  rankedIn: RankedMarket[],
  opts: PickActiveOptions,
): Crypto15mMarket[] {
  const maxActive = Math.max(0, Math.floor(opts.maxActive))
  // Drop any non-universe rows that slipped in (sticky leftovers, etc.)
  const ranked = rankedIn.filter((r) => isMmQuoteUniverseMarket(r.market))
  if (maxActive === 0 || ranked.length === 0) return []

  const onePerAsset = opts.onePerAsset !== false
  const requireEdge = opts.requireEdge !== false
  const fillMidFallback = opts.fillMidFallback !== false
  const sticky = new Set(opts.stickyTickers ?? [])
  const byTicker = new Map(ranked.map((r) => [r.ticker, r]))

  const chosen: Crypto15mMarket[] = []
  const usedAssets = new Set<string>()
  const usedTickers = new Set<string>()

  const tryAdd = (
    r: RankedMarket,
    mode: 'sticky' | 'edge' | 'mid_fallback',
  ): boolean => {
    if (chosen.length >= maxActive) return false
    if (usedTickers.has(r.ticker)) return false
    if (onePerAsset && usedAssets.has(r.asset)) return false
    if (mode === 'edge' && requireEdge && !r.quoteEligible) return false
    if (mode === 'mid_fallback' && !r.midFallbackEligible && !r.quoteEligible) {
      // Still allow any open ranked market as last resort fill (but not mid=0 junk)
      if (!Number.isFinite(r.mid) || r.mid <= 0 || r.mid >= 1) return false
    }
    chosen.push(r.market)
    usedTickers.add(r.ticker)
    usedAssets.add(r.asset)
    return true
  }

  // Sticky: keep currently active tickers that are still in the open ranked set
  for (const t of sticky) {
    const r = byTicker.get(t)
    if (r) tryAdd(r, 'sticky')
  }

  // Fill remaining from rank order (edge-eligible)
  for (const r of ranked) {
    if (chosen.length >= maxActive) break
    tryAdd(r, 'edge')
  }

  // Mid-fallback / open-set fill — never leave empty slots while open markets remain
  if (fillMidFallback && chosen.length < maxActive) {
    for (const r of ranked) {
      if (chosen.length >= maxActive) break
      tryAdd(r, 'mid_fallback')
    }
  }

  return chosen
}
