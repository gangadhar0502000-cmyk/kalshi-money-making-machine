/**
 * Rank open crypto 15m markets for multi-book paper MM.
 * U3.2: prefer L2 / mid quality — NOT |FV−mid| (Family E mismatch ranking retired).
 * FV / edgeCents remain on RankedMarket for UI/telemetry only.
 * Pure helpers — no live orders.
 */

import type { Crypto15mMarket } from '../../../types/crypto15m'
import { asDollarPrice, isValidQuoteMid } from './prices'
import { edgeVsMidCents, estimateYesFairValue, resolveStrike } from './fairValue'
import { isMarketOpen } from './marketSelect'
import { canonicalMmAsset, normalizeSpotAsset } from '../spot'
import { midQualityScore, U32_RANK_LIQUIDITY } from './houseMidQuote'

/** Fail-loud constant — ranking no longer prefers |FV−mid|. */
export { U32_RANK_LIQUIDITY }

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
  /** (FV − mid) in cents; null if no FV. Telemetry only under U3.2. */
  edgeCents: number | null
  absEdgeCents: number
  spot: number | null
  /** Effective strike used (API or spot-derived). */
  strike: number | null
  strikeSource: 'floor_strike' | 'spot_reference' | 'none'
  /** Why FV is blank when inputs incomplete. */
  fvMissingReason: FvMissingReason
  /**
   * U3.2: mid tradeable + coherent L2 — not |FV−mid| ≥ minEdge.
   */
  quoteEligible: boolean
  /**
   * True when FV is genuinely unavailable and mid is non-toxic.
   * Legacy mid-fallback fill path; U3.2 prefers quoteEligible (L2+mid).
   */
  midFallbackEligible: boolean
  /**
   * True when FV exists and |edge| exceeds maxSaneEdgeCents.
   * Telemetry / UI only under U3.2 — does NOT drive ranking or slot eviction.
   */
  sanityPark: boolean
  /** True when market has a coherent top-of-book bid/ask. */
  hasL2: boolean
  /** Touch spread in cents when hasL2; else +Infinity. */
  spreadCents: number
  /** Room from toxic extremes — higher is better. */
  midQuality: number
}

/**
 * Score one market given its asset spot. Missing spot/strike → null FV (telemetry).
 * U3.2 quoteEligible = mid tradeable + L2 (ignores |FV−mid|).
 */
export function scoreMarketEdge(
  market: Crypto15mMarket,
  spot: number | null | undefined,
  annualVol: number,
  minEdgeCents: number,
  toxicMidLow = 0.05,
  toxicMidHigh = 0.95,
  maxSaneEdgeCents = 25,
): RankedMarket {
  void minEdgeCents // retained for call-site compat; U3.2 does not gate on |edge|
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
  const sanityPark =
    fairValue != null && edgeCents != null && absEdgeCents > maxSaneEdgeCents

  const yesBid = market.yesBid
  const yesAsk = market.yesAsk
  const hasL2 =
    yesBid != null &&
    yesAsk != null &&
    Number.isFinite(yesBid) &&
    Number.isFinite(yesAsk) &&
    yesAsk > yesBid &&
    yesBid > 0 &&
    yesAsk < 1

  const spreadCents = hasL2 ? (yesAsk! - yesBid!) * 100 : Number.POSITIVE_INFINITY
  const midQuality = midOk ? midQualityScore(mid, toxicMidLow, toxicMidHigh) : -1

  // U3.2: eligible when mid is tradeable and L2 is coherent — NOT by |FV−mid|.
  const quoteEligible = midTradeable && hasL2
  // Mid fallback ONLY when FV genuinely unavailable (not when FV exists but insane).
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
    sanityPark,
    hasL2,
    spreadCents,
    midQuality,
  }
}

/**
 * Rank open markets for slotting.
 * U3.2: L2 → mid quality → tighter spread → sooner close — NOT |FV−mid|.
 * (Function name kept for call-site compat; behavior changed fail-loud via U32_RANK_LIQUIDITY.)
 */
export function rankMarketsByAbsEdge(
  markets: Crypto15mMarket[],
  spotsByAsset: Readonly<Record<string, number>>,
  annualVol: number,
  minEdgeCents: number,
  nowMs = Date.now(),
  maxSaneEdgeCents = 25,
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
    return scoreMarketEdge(
      m,
      spot,
      annualVol,
      minEdgeCents,
      0.05,
      0.95,
      maxSaneEdgeCents,
    )
  })
  scored.sort((a, b) => {
    // U3.2: never prefer larger |FV−mid|.
    if (a.hasL2 !== b.hasL2) return a.hasL2 ? -1 : 1
    if (a.quoteEligible !== b.quoteEligible) return a.quoteEligible ? -1 : 1
    if (b.midQuality !== a.midQuality) return b.midQuality - a.midQuality
    if (a.spreadCents !== b.spreadCents) return a.spreadCents - b.spreadCents
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
   * Prefer quoteEligible markets for *new* slots (default true).
   * U3.2: quoteEligible = L2 + tradeable mid (not |edge|).
   */
  requireEdge?: boolean
  /**
   * Fill remaining slots with mid-fallback markets (default false).
   */
  fillMidFallback?: boolean
  /**
   * Inventory by ticker (sticky unwind). U3.2: FV sanity no longer evicts.
   */
  inventoryByTicker?: Readonly<Record<string, number>>
  /**
   * When true (default), apply sanity+flat slot eviction — **no-op under U3.2**
   * (FV−mid sanity is telemetry only; mid-centered house rules).
   */
  evictSanityFlat?: boolean
  /**
   * U2.14: tickers blocked after L2-off flat eviction — not sticky and not
   * newly selected so dead L2 books cannot immediately reoccupy the slot.
   */
  excludeTickers?: readonly string[]
}

/**
 * U3.2: FV sanity+|edge| no longer evicts slots — |FV−mid| is telemetry only.
 * Always false (inventory arg retained for call-site compat).
 */
export function shouldEvictSanityFlat(
  _r: RankedMarket,
  _inventoryByTicker?: Readonly<Record<string, number>>,
): boolean {
  return false
}

/**
 * Pick up to maxActive markets: sticky first (if still present), then rank order
 * (L2 / mid quality). Cap is hard — never returns more than maxActive.
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
  // Default OFF — prefer empty slots over no-L2 mid-fallback books.
  const fillMidFallback = opts.fillMidFallback === true
  const evictSanityFlat = opts.evictSanityFlat !== false
  const invMap = opts.inventoryByTicker
  const sticky = new Set(opts.stickyTickers ?? [])
  const exclude = new Set(opts.excludeTickers ?? [])
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
    if (exclude.has(r.ticker)) return false
    if (onePerAsset && usedAssets.has(r.asset)) return false
    // U3.2: shouldEvictSanityFlat always false — keep branch for API clearness.
    if (evictSanityFlat && shouldEvictSanityFlat(r, invMap)) {
      return false
    }
    if (mode === 'edge' && requireEdge) {
      if (!r.quoteEligible) return false
    }
    if (mode === 'mid_fallback') {
      if (!r.midFallbackEligible || r.fairValue != null) return false
    }
    chosen.push(r.market)
    usedTickers.add(r.ticker)
    usedAssets.add(r.asset)
    return true
  }

  // Sticky: keep currently active tickers that are still in the open ranked set.
  for (const t of sticky) {
    const r = byTicker.get(t)
    if (r) tryAdd(r, 'sticky')
  }

  // Fill remaining from rank order (L2 / mid-quality eligible)
  for (const r of ranked) {
    if (chosen.length >= maxActive) break
    tryAdd(r, 'edge')
  }

  // Mid-fallback only when explicitly enabled (FV unavailable markets only)
  if (fillMidFallback && chosen.length < maxActive) {
    for (const r of ranked) {
      if (chosen.length >= maxActive) break
      tryAdd(r, 'mid_fallback')
    }
  }

  return chosen
}
