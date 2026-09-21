/**
 * Rank open crypto 15m markets by |FV − mid| for multi-book paper MM.
 * Pure helpers — no live orders.
 */

import type { Crypto15mMarket } from '../../../types/crypto15m'
import { asDollarPrice } from './prices'
import { edgeVsMidCents, estimateYesFairValue } from './fairValue'
import { isMarketOpen } from './marketSelect'
import { normalizeSpotAsset } from '../spot'

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
  /** True when FV exists and |edge| ≥ minEdgeCents (at least one side could quote). */
  quoteEligible: boolean
}

/**
 * Score one market given its asset spot. Missing spot/strike → null FV, absEdge 0.
 */
export function scoreMarketEdge(
  market: Crypto15mMarket,
  spot: number | null | undefined,
  annualVol: number,
  minEdgeCents: number,
): RankedMarket {
  const mid = asDollarPrice(market.midYes, 'rank.mid')
  const asset = normalizeSpotAsset(market.asset)
  let fairValue: number | null = null
  let edgeCents: number | null = null

  if (
    spot != null &&
    Number.isFinite(spot) &&
    spot > 0 &&
    market.floorStrike != null &&
    Number.isFinite(market.floorStrike) &&
    market.floorStrike > 0
  ) {
    const est = estimateYesFairValue({
      spot,
      strike: market.floorStrike,
      minutesRemaining: market.minutesRemaining,
      annualVol,
    })
    if (est) {
      fairValue = est.fairProb
      edgeCents = edgeVsMidCents(est.fairProb, mid)
    }
  }

  const absEdgeCents = edgeCents != null ? Math.abs(edgeCents) : 0
  const quoteEligible = edgeCents != null && absEdgeCents >= minEdgeCents

  return {
    market,
    asset,
    ticker: market.ticker,
    mid,
    fairValue,
    edgeCents,
    absEdgeCents,
    spot: spot != null && Number.isFinite(spot) ? spot : null,
    quoteEligible,
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
  const open = markets.filter((m) => isMarketOpen(m, nowMs))
  const scored = open.map((m) => {
    const key = normalizeSpotAsset(m.asset)
    const spot = spotsByAsset[key] ?? spotsByAsset[m.asset.toUpperCase()]
    return scoreMarketEdge(m, spot, annualVol, minEdgeCents)
  })
  scored.sort((a, b) => {
    if (b.absEdgeCents !== a.absEdgeCents) return b.absEdgeCents - a.absEdgeCents
    // Tie-break: sooner close first (more urgent), then ticker
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
  /** Only fill new slots with quoteEligible markets (default true). */
  requireEdge?: boolean
}

/**
 * Pick up to maxActive markets: sticky first (if still present), then highest |edge|.
 * Cap is hard — never returns more than maxActive.
 */
export function pickActiveMarkets(
  ranked: RankedMarket[],
  opts: PickActiveOptions,
): Crypto15mMarket[] {
  const maxActive = Math.max(0, Math.floor(opts.maxActive))
  if (maxActive === 0 || ranked.length === 0) return []

  const onePerAsset = opts.onePerAsset !== false
  const requireEdge = opts.requireEdge !== false
  const sticky = new Set(opts.stickyTickers ?? [])
  const byTicker = new Map(ranked.map((r) => [r.ticker, r]))

  const chosen: Crypto15mMarket[] = []
  const usedAssets = new Set<string>()
  const usedTickers = new Set<string>()

  const tryAdd = (r: RankedMarket, forceSticky: boolean): boolean => {
    if (chosen.length >= maxActive) return false
    if (usedTickers.has(r.ticker)) return false
    if (onePerAsset && usedAssets.has(r.asset)) return false
    if (!forceSticky && requireEdge && !r.quoteEligible) return false
    chosen.push(r.market)
    usedTickers.add(r.ticker)
    usedAssets.add(r.asset)
    return true
  }

  // Sticky: keep currently active tickers that are still in the open ranked set
  for (const t of sticky) {
    const r = byTicker.get(t)
    if (r) tryAdd(r, true)
  }

  // Fill remaining from rank order
  for (const r of ranked) {
    if (chosen.length >= maxActive) break
    tryAdd(r, false)
  }

  return chosen
}
