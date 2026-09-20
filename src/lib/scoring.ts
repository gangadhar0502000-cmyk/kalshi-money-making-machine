import type {
  ConfidenceLevel,
  KalshiMarketRaw,
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

/** Minimum |edge| in percentage points to surface as a trade card by default ranking boost */
export const MIN_EDGE_PP = 3

function confidenceFor(
  usedExternal: boolean,
  liquidityOk: boolean,
  absEdgePct: number,
  sources: { kind: string }[],
): ConfidenceLevel {
  const hasExternal = sources.some(
    (s) => s.kind === 'noaa' || s.kind === 'odds_api' || s.kind === 'demo_external',
  )
  // HIGH only when external fair source used + liquidity ok + meaningful edge
  if (liquidityOk && absEdgePct >= MIN_EDGE_PP && (hasExternal || usedExternal)) return 'HIGH'
  if (liquidityOk && absEdgePct >= 2) return 'MEDIUM'
  return 'LOW'
}

function kellyLiteStake(entry: number, fairProb: number, side: Side): number {
  // fair for the side we buy
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

  let suggestedSide: Side = edgePct >= 0 ? 'YES' : 'NO'
  // Require minimum edge to lean; otherwise cheaper-side scan cue only
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

  const suggestedStakePct = kellyLiteStake(entry, fair.fairProb, suggestedSide)

  const conf = confidenceFor(
    fair.usedExternal,
    liq.passed,
    absEdgePct,
    fair.sources,
  )

  const spread = scoreSpread(liq.spreadCents)
  const time = scoreTime(hours)
  const volumeMomentum = scoreVolumeMomentum(liq.volume, liq.volume24h)
  const fairConfidence =
    conf === 'HIGH' ? 90 : conf === 'MEDIUM' ? 60 : 30

  // Rank score: tradeable |edge| dominates, gated by liquidity
  const edgeScore = Math.round(
    clamp(
      (liq.passed ? 1 : 0.25) *
        (absEdgePct * 6 + liq.liquidityScore * 0.35 + fairConfidence * 0.25 + spread * 0.15),
      0,
      100,
    ),
  )

  const title = raw.title?.trim() || raw.yes_sub_title?.trim() || raw.ticker
  const category = inferCategory(raw)
  const rationale: string[] = []

  if (!liq.passed) {
    rationale.push(`Filtered / weak liquidity: ${liq.failReasons[0] ?? 'failed gate'}`)
  } else {
    rationale.push(
      `Liquidity OK (score ${liq.liquidityScore}, vol ${Math.round(liq.volume).toLocaleString()}, spread ${liq.spreadCents.toFixed(1)}¢)`,
    )
  }

  rationale.push(
    `Fair YES ${(fair.fairProb * 100).toFixed(1)}% vs Kalshi mid ${formatCents(liq.midYes)} → edge ${edgePct >= 0 ? '+' : ''}${edgePct.toFixed(1)} pp`,
  )

  const sourceLabels = fair.sources
    .filter((s) => s.kind !== 'weak_prior' && s.kind !== 'structure')
    .slice(0, 3)
    .map((s) => s.label)
  if (sourceLabels.length) {
    rationale.push(`Sources: ${sourceLabels.join(', ')}`)
  } else {
    rationale.push('Sources: structure / weak prior only (not HIGH confidence)')
  }

  rationale.push(
    `Suggest ${suggestedSide} @ ~${formatCents(entry)} · Kelly-lite ~${suggestedStakePct}% bankroll · confidence ${conf}`,
  )
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
    edgeScore,
    confidence: conf,
    fairSources: fair.sources,
    suggestedSide,
    suggestedStakePct,
    rationale,
    kalshiUrl: kalshiMarketUrl(raw.ticker, raw.event_ticker),
    passedLiquidityGate: liq.passed,
    liquidityFailReasons: liq.failReasons,
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
  externals: ExternalContext = { noaaByTicker: {}, oddsByTicker: {} },
): ScoredOpportunity[] {
  const universe = buildUniverse(markets)
  return markets
    .filter((m) => {
      const s = (m.status || '').toLowerCase()
      return !s || s === 'open' || s === 'active'
    })
    .map((m) => scoreMarket(m, universe, externals))
    .sort((a, b) => {
      // Tradeable edges first
      if (a.passedLiquidityGate !== b.passedLiquidityGate) {
        return a.passedLiquidityGate ? -1 : 1
      }
      return b.absEdgePct - a.absEdgePct || b.edgeScore - a.edgeScore
    })
}

/** Async path: prefetch externals then score. */
export async function scoreAndRankAsync(
  markets: KalshiMarketRaw[],
  signal?: AbortSignal,
): Promise<ScoredOpportunity[]> {
  const externals = await prefetchExternals(markets, signal)
  return scoreAndRank(markets, externals)
}
