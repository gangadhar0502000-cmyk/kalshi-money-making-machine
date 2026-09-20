import type {
  ConfidenceLevel,
  KalshiMarketRaw,
  OpportunityKind,
  ScoreMeta,
  ScoredOpportunity,
  Side,
} from '../types/kalshi'
import {
  buildUniverse,
  estimateFairValue,
  prefetchExternals,
  type ExternalContext,
} from './fairValue'
import {
  formatCents,
  hoursUntil,
  inferCategory,
  kalshiMarketUrl,
} from './format'
import { assessLiquidity } from './liquidity'
import { oddsApiConfigured } from './external/odds'

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function scoreTime(hours: number): number {
  if (hours <= 0) return 10
  if (hours < 6) return 25
  if (hours < 24) return 55
  if (hours < 24 * 7) return 90
  if (hours < 24 * 30) return 85
  if (hours < 24 * 90) return 65
  if (hours < 24 * 180) return 45
  return 30
}

function scoreVolumeMomentum(volume: number, volume24h: number): number {
  if (volume <= 0) return 20
  const ratio = volume24h / Math.max(volume, 1)
  if (ratio >= 0.15) return 95
  if (ratio >= 0.08) return 80
  if (ratio >= 0.03) return 60
  if (ratio >= 0.01) return 40
  return 25
}

function scoreSpread(spreadCents: number): number {
  if (spreadCents <= 1) return 100
  if (spreadCents <= 2) return 90
  if (spreadCents <= 3) return 75
  if (spreadCents <= 5) return 55
  if (spreadCents <= 8) return 35
  return clamp(20 - (spreadCents - 8) * 2, 0, 20)
}

/** Strict-mode default minimum |edge| in percentage points */
export const STRICT_MIN_EDGE_PP = 5
/** Loose / research minimum */
export const MIN_EDGE_PP = 3

const EXTERNAL_KINDS = new Set(['noaa', 'odds_api', 'odds_fallback', 'demo_external'])

function confidenceFor(
  usedExternal: boolean,
  liquidityOk: boolean,
  absEdgePct: number,
  sources: { kind: string }[],
  opportunityKind: OpportunityKind,
): ConfidenceLevel {
  if (opportunityKind === 'RESEARCH' || !usedExternal) return 'UNRANKED'

  const hasExternal = sources.some((s) => EXTERNAL_KINDS.has(s.kind))
  if (liquidityOk && absEdgePct >= STRICT_MIN_EDGE_PP && (hasExternal || usedExternal)) {
    // ESPN fallback alone stays MEDIUM
    const onlyFallback =
      sources.filter((s) => EXTERNAL_KINDS.has(s.kind)).every((s) => s.kind === 'odds_fallback')
    if (onlyFallback) return 'MEDIUM'
    return 'HIGH'
  }
  if (liquidityOk && absEdgePct >= MIN_EDGE_PP && usedExternal) return 'MEDIUM'
  return 'LOW'
}

function kellyLiteStake(entry: number, fairProb: number, side: Side): number {
  const p = side === 'YES' ? fairProb : 1 - fairProb
  const price = clamp(entry, 0.01, 0.99)
  const b = (1 - price) / price
  const q = 1 - p
  const kelly = Math.max(0, (b * p - q) / b)
  const quarter = kelly * 0.25
  return clamp(Number((quarter * 100).toFixed(2)), 0.25, 5)
}

export function scoreMarket(
  raw: KalshiMarketRaw,
  universeMids: ReturnType<typeof buildUniverse>,
  externals: ExternalContext,
): ScoredOpportunity {
  const liq = assessLiquidity(raw)
  const closeTime =
    raw.close_time ||
    raw.expected_expiration_time ||
    raw.latest_expiration_time ||
    new Date(Date.now() + 30 * 86400000).toISOString()
  const hours = hoursUntil(closeTime)

  const fair = estimateFairValue(raw, universeMids, externals)
  const edgeFrac = fair.fairProb - liq.midYes
  const edgePct = edgeFrac * 100
  const absEdgePct = Math.abs(edgePct)

  const hasExternalFair = fair.usedExternal
  const opportunityKind: OpportunityKind =
    liq.passed && hasExternalFair ? 'TRADE' : 'RESEARCH'

  const blockedMissingExternal =
    liq.isSports && liq.passed && !hasExternalFair

  let suggestedSide: Side = edgePct >= 0 ? 'YES' : 'NO'
  if (absEdgePct < 1.5) {
    suggestedSide = liq.midYes <= 0.5 ? 'YES' : 'NO'
  }

  const entry =
    suggestedSide === 'YES'
      ? liq.yesAsk > 0
        ? liq.yesAsk
        : liq.midYes
      : liq.noAsk > 0
        ? liq.noAsk
        : 1 - liq.midYes

  const suggestedStakePct =
    opportunityKind === 'TRADE' ? kellyLiteStake(entry, fair.fairProb, suggestedSide) : 0

  const conf = confidenceFor(
    fair.usedExternal,
    liq.passed,
    absEdgePct,
    fair.sources,
    opportunityKind,
  )

  const spread = scoreSpread(liq.spreadCents)
  const time = scoreTime(hours)
  const volumeMomentum = scoreVolumeMomentum(liq.volume, liq.volume24h)
  const fairConfidence =
    conf === 'HIGH' ? 90 : conf === 'MEDIUM' ? 60 : conf === 'LOW' ? 30 : 10

  // Rank score for sorting ONLY — never the hero "edge" metric in UI
  const rankScore = Math.round(
    clamp(
      (opportunityKind === 'TRADE' ? 1 : 0.15) *
        (absEdgePct * 6 + liq.liquidityScore * 0.35 + fairConfidence * 0.25 + spread * 0.15),
      0,
      100,
    ),
  )

  const title = raw.title?.trim() || raw.yes_sub_title?.trim() || raw.ticker
  const category = liq.category || inferCategory(raw)
  const rationale: string[] = []

  if (opportunityKind === 'RESEARCH') {
    if (!liq.passed) {
      rationale.push(`Illiquid / failed gate: ${liq.failReasons[0] ?? 'failed gate'}`)
    }
    if (!hasExternalFair) {
      rationale.push(
        'UNRANKED / research-only: no external fair value (structure heuristics only). Not a trade suggestion.',
      )
    }
  } else {
    rationale.push(
      `Liquidity OK (score ${liq.liquidityScore}, vol ${Math.round(liq.volume).toLocaleString()}, spread ${liq.spreadCents.toFixed(1)}¢)`,
    )
  }

  rationale.push(
    `Fair YES ${(fair.fairProb * 100).toFixed(1)}% vs Kalshi mid ${(liq.midYes * 100).toFixed(1)}% → edge ${edgePct >= 0 ? '+' : ''}${edgePct.toFixed(1)} pp`,
  )

  const sourceLabels = fair.sources
    .filter((s) => EXTERNAL_KINDS.has(s.kind))
    .slice(0, 3)
    .map((s) => s.label)
  if (sourceLabels.length) {
    rationale.push(`External sources: ${sourceLabels.join(', ')}`)
  } else {
    rationale.push('Sources: structure / weak prior only — hidden in Strict Mode')
  }

  if (opportunityKind === 'TRADE') {
    rationale.push(
      `Trade lean: ${suggestedSide} @ ~${formatCents(entry)} · Kelly-lite ~${suggestedStakePct}% · confidence ${conf}`,
    )
  } else {
    rationale.push('No trade CTA — turn off Strict Mode only to inspect research cards.')
  }
  rationale.push('Research signal only — not guaranteed profit or financial advice.')

  return {
    ticker: raw.ticker,
    eventTicker: raw.event_ticker,
    title,
    category,
    status: raw.status,
    yesBid: liq.yesBid,
    yesAsk: liq.yesAsk,
    noBid: liq.noBid,
    noAsk: liq.noAsk,
    midYes: liq.midYes,
    spreadCents: liq.spreadCents,
    volume: liq.volume,
    volume24h: liq.volume24h,
    openInterest: liq.openInterest,
    closeTime,
    hoursToExpiry: hours,
    liquidityScore: liq.liquidityScore,
    fairProb: fair.fairProb,
    edgePct,
    absEdgePct,
    rankScore,
    edgeScore: rankScore,
    confidence: conf,
    fairSources: fair.sources,
    suggestedSide,
    suggestedStakePct,
    rationale,
    kalshiUrl: kalshiMarketUrl(raw.ticker, raw.event_ticker),
    passedLiquidityGate: liq.passed,
    liquidityFailReasons: liq.failReasons,
    hasExternalFair,
    opportunityKind,
    blockedMissingExternal,
    scoreBreakdown: {
      liquidity: liq.liquidityScore,
      spread: Math.round(spread),
      fairConfidence: Math.round(fairConfidence),
      time: Math.round(time),
      volumeMomentum: Math.round(volumeMomentum),
    },
  }
}

export function scoreAndRank(
  markets: KalshiMarketRaw[],
  externals: ExternalContext = {
    noaaByTicker: {},
    oddsByTicker: {},
    sportsParses: {},
    oddsApiConfigured: oddsApiConfigured(),
  },
): ScoredOpportunity[] {
  const universe = buildUniverse(markets)
  return markets
    .filter((m) => {
      const s = (m.status || '').toLowerCase()
      return !s || s === 'open' || s === 'active'
    })
    .map((m) => scoreMarket(m, universe, externals))
    .sort((a, b) => {
      // TRADE edges first, then by |edge|
      if (a.opportunityKind !== b.opportunityKind) {
        return a.opportunityKind === 'TRADE' ? -1 : 1
      }
      if (a.passedLiquidityGate !== b.passedLiquidityGate) {
        return a.passedLiquidityGate ? -1 : 1
      }
      return b.absEdgePct - a.absEdgePct || b.rankScore - a.rankScore
    })
}

export function buildScoreMeta(
  opportunities: ScoredOpportunity[],
  oddsConfigured: boolean,
): ScoreMeta {
  const sports = opportunities.filter((o) => o.category === 'Sports' || o.blockedMissingExternal)
  return {
    oddsApiConfigured: oddsConfigured,
    sportsMarketsSeen: sports.length,
    sportsBlockedNoExternal: opportunities.filter((o) => o.blockedMissingExternal).length,
    structureOnlyCount: opportunities.filter((o) => !o.hasExternalFair).length,
    tradeableCount: opportunities.filter((o) => o.opportunityKind === 'TRADE').length,
  }
}

/** Async path: prefetch externals then score. */
export async function scoreAndRankAsync(
  markets: KalshiMarketRaw[],
  signal?: AbortSignal,
): Promise<{ opportunities: ScoredOpportunity[]; meta: ScoreMeta }> {
  const externals = await prefetchExternals(markets, signal)
  const opportunities = scoreAndRank(markets, externals)
  return {
    opportunities,
    meta: buildScoreMeta(opportunities, externals.oddsApiConfigured),
  }
}
