import type { KalshiMarketRaw, ScoredOpportunity, Side } from '../types/kalshi'
import {
  formatCents,
  hoursUntil,
  inferCategory,
  kalshiMarketUrl,
  parseCount,
  parseDollars,
} from './format'

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function scoreLiquidity(volume: number, openInterest: number): number {
  // Log-scaled: ~1k contracts ≈ mid, 100k+ ≈ high
  const v = Math.log10(Math.max(volume, 1))
  const oi = Math.log10(Math.max(openInterest, 1))
  const raw = (v / 5) * 55 + (oi / 5) * 45
  return clamp(raw, 0, 100)
}

function scoreSpread(spreadCents: number): number {
  // Tighter spreads score higher (0¢ perfect, 10¢+ poor)
  if (spreadCents <= 1) return 100
  if (spreadCents <= 2) return 90
  if (spreadCents <= 3) return 75
  if (spreadCents <= 5) return 55
  if (spreadCents <= 8) return 35
  return clamp(20 - (spreadCents - 8) * 2, 0, 20)
}

function scoreDistanceFrom50(midYes: number): number {
  // Markets far from 50¢ often have clearer directional lean / less "coin flip" noise
  // for research scanning — NOT a claim of mispricing.
  const dist = Math.abs(midYes - 0.5)
  return clamp(dist * 200, 0, 100) // 0 at 50¢, 100 at 0¢ or 100¢
}

function scoreTime(hours: number): number {
  // Prefer markets that aren't expiring in minutes (illiquid chaos)
  // nor years away (capital lockup). Sweet spot ~1–30 days.
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
  // Healthy recent activity without assuming "pump"
  if (ratio >= 0.15) return 95
  if (ratio >= 0.08) return 80
  if (ratio >= 0.03) return 60
  if (ratio >= 0.01) return 40
  return 25
}

/**
 * Heuristic edge score (0–100). Transparent research signal only —
 * never a guarantee of profit or true mispricing.
 */
export function scoreMarket(raw: KalshiMarketRaw): ScoredOpportunity {
  const yesBid = parseDollars(raw.yes_bid_dollars ?? raw.yes_bid)
  const yesAsk = parseDollars(raw.yes_ask_dollars ?? raw.yes_ask)
  const noBid = parseDollars(raw.no_bid_dollars)
  const noAsk = parseDollars(raw.no_ask_dollars)
  const last = parseDollars(raw.last_price_dollars ?? raw.last_price)

  const midYes =
    yesBid > 0 && yesAsk > 0
      ? (yesBid + yesAsk) / 2
      : last > 0
        ? last
        : 0.5

  const spreadCents =
    yesBid > 0 && yesAsk > 0 ? Math.max(0, (yesAsk - yesBid) * 100) : 5

  const volume = parseCount(raw.volume_fp ?? raw.volume)
  const volume24h = parseCount(raw.volume_24h_fp)
  const openInterest = parseCount(raw.open_interest_fp)
  const closeTime =
    raw.close_time ||
    raw.expected_expiration_time ||
    raw.latest_expiration_time ||
    new Date(Date.now() + 30 * 86400000).toISOString()
  const hours = hoursUntil(closeTime)

  const liquidity = scoreLiquidity(volume, openInterest)
  const spread = scoreSpread(spreadCents)
  const distanceFromFair = scoreDistanceFrom50(midYes)
  const time = scoreTime(hours)
  const volumeMomentum = scoreVolumeMomentum(volume, volume24h)

  // Weighted composite — liquidity & tight spread dominate for tradeability
  const edgeScore = Math.round(
    liquidity * 0.28 +
      spread * 0.27 +
      distanceFromFair * 0.15 +
      time * 0.15 +
      volumeMomentum * 0.15,
  )

  // Suggested side: lean toward the cheaper side when mid is skewed,
  // otherwise YES if mid < 50 (buying "underdog" for research), else NO.
  // This is a scanning heuristic, not an edge claim.
  let suggestedSide: Side
  if (midYes < 0.45) suggestedSide = 'YES'
  else if (midYes > 0.55) suggestedSide = 'NO'
  else suggestedSide = midYes <= 0.5 ? 'YES' : 'NO'

  const entry =
    suggestedSide === 'YES'
      ? yesAsk > 0
        ? yesAsk
        : midYes
      : noAsk > 0
        ? noAsk
        : 1 - midYes

  // Fractional Kelly-ish stake suggestion using a *tiny* assumed edge
  // (1–3¢) so we never suggest huge bets. Caps at 5%.
  const assumedEdge = clamp(0.01 + (edgeScore / 100) * 0.02, 0.01, 0.03)
  const p = clamp(entry + assumedEdge, 0.01, 0.99)
  const b = (1 - entry) / Math.max(entry, 0.01)
  const q = 1 - p
  const kelly = Math.max(0, (b * p - q) / b)
  const fractionalKelly = kelly * 0.25 // quarter-Kelly
  const suggestedStakePct = clamp(
    Number((fractionalKelly * 100).toFixed(2)),
    0.25,
    5,
  )

  const title =
    raw.title?.trim() ||
    raw.yes_sub_title?.trim() ||
    raw.ticker

  const category = inferCategory(raw)
  const rationale: string[] = []

  if (liquidity >= 70) rationale.push(`Solid liquidity (vol ${Math.round(volume).toLocaleString()})`)
  else if (liquidity >= 40) rationale.push('Moderate liquidity — size carefully')
  else rationale.push('Thin book — high slippage risk')

  if (spreadCents <= 2) rationale.push(`Tight spread (${spreadCents.toFixed(1)}¢)`)
  else if (spreadCents <= 5) rationale.push(`Usable spread (${spreadCents.toFixed(1)}¢)`)
  else rationale.push(`Wide spread (${spreadCents.toFixed(1)}¢) eats edge`)

  rationale.push(
    `Mid YES ${formatCents(midYes)} — ${
      Math.abs(midYes - 0.5) < 0.05
        ? 'near coin-flip'
        : midYes < 0.5
          ? 'leans NO in market'
          : 'leans YES in market'
    }`,
  )

  if (hours < 24) rationale.push('Expires within 24h — watch settlement risk')
  else if (hours < 24 * 14) rationale.push('Near-term expiry (good for capital velocity)')
  else rationale.push('Longer-dated — opportunity cost of capital')

  rationale.push(
    `Heuristic suggests ${suggestedSide} @ ~${formatCents(entry)} with ~${suggestedStakePct}% bankroll (¼-Kelly style; not advice)`,
  )

  return {
    ticker: raw.ticker,
    eventTicker: raw.event_ticker,
    title,
    category,
    status: raw.status,
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    midYes,
    spreadCents,
    volume,
    volume24h,
    openInterest,
    closeTime,
    hoursToExpiry: hours,
    edgeScore: clamp(edgeScore, 0, 100),
    suggestedSide,
    suggestedStakePct,
    rationale,
    kalshiUrl: kalshiMarketUrl(raw.ticker, raw.event_ticker),
    scoreBreakdown: {
      liquidity: Math.round(liquidity),
      spread: Math.round(spread),
      distanceFromFair: Math.round(distanceFromFair),
      time: Math.round(time),
      volumeMomentum: Math.round(volumeMomentum),
    },
  }
}

export function scoreAndRank(markets: KalshiMarketRaw[]): ScoredOpportunity[] {
  return markets
    .filter((m) => {
      const s = (m.status || '').toLowerCase()
      return !s || s === 'open' || s === 'active'
    })
    .map(scoreMarket)
    .sort((a, b) => b.edgeScore - a.edgeScore)
}
