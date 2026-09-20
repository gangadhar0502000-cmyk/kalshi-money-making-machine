import type { FairSource, FairSourceKind, KalshiMarketRaw } from '../types/kalshi'
import {
  demoClimatologyFair,
  detectWeatherMarket,
  fetchNoaaFair,
  type NoaaFairEstimate,
} from './external/noaa'
import {
  detectSportsMarket,
  fetchEspnFallbackFair,
  matchOddsFair,
  oddsApiConfigured,
  parseSportsMarket,
  prefetchOddsUniverse,
  type OddsFairEstimate,
  type SportsMarketParse,
} from './external/odds'
import { assessLiquidity } from './liquidity'

export interface FairValueResult {
  fairProb: number
  sources: FairSource[]
  usedExternal: boolean
  /** Structure-only (no NOAA/odds/demo external) */
  structureOnly: boolean
}

interface MidInfo {
  ticker: string
  eventTicker: string
  title: string
  midYes: number
  category: string
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function midOf(raw: KalshiMarketRaw): number {
  const a = assessLiquidity(raw)
  return a.midYes
}

/**
 * Cross-market / structure heuristics (honest when labeled weak).
 * Never presented as a TRADE signal in Strict Mode.
 */
export function structureFair(
  market: KalshiMarketRaw,
  universe: MidInfo[],
): { fair: number; sources: FairSource[] } {
  const sources: FairSource[] = []
  const selfMid = midOf(market)
  const peers = universe.filter(
    (u) => u.eventTicker === market.event_ticker && u.ticker !== market.ticker,
  )

  let fair = selfMid
  let weightSum = 0
  let acc = 0

  const push = (value: number, weight: number, kind: FairSourceKind, label: string, detail: string) => {
    if (weight <= 0 || !Number.isFinite(value)) return
    acc += value * weight
    weightSum += weight
    sources.push({ kind, label, detail, weight })
  }

  push(0.5, 0.15, 'weak_prior', 'Weak 50¢ prior', 'Shrink toward coin-flip when signals are thin (weak)')

  if (peers.length > 0) {
    const peerMean = peers.reduce((s, p) => s + p.midYes, 0) / peers.length
    push(
      clamp(selfMid * 0.7 + peerMean * 0.3, 0.02, 0.98),
      0.35,
      'cross_market',
      'Event peer blend',
      `Blended with ${peers.length} same-event mid(s); mean peer ${(peerMean * 100).toFixed(0)}¢ (structure)`,
    )
  }

  const selfThresh = extractThreshold(market.title || market.yes_sub_title || '')
  if (selfThresh !== null && peers.length > 0) {
    const nested = peers
      .map((p) => ({ ...p, thr: extractThreshold(p.title) }))
      .filter((p) => p.thr !== null) as Array<MidInfo & { thr: number }>

    if (nested.length > 0) {
      for (const p of nested) {
        if (p.thr > selfThresh && p.midYes > selfMid + 0.02) {
          const adjusted = clamp((selfMid + p.midYes) / 2 + 0.02, 0.02, 0.98)
          push(
            adjusted,
            0.4,
            'structure',
            'Ladder monotone fix',
            `Higher threshold ${p.thr} mid ${(p.midYes * 100).toFixed(0)}¢ > this ${selfThresh} mid ${(selfMid * 100).toFixed(0)}¢ — structure adjust (weak)`,
          )
        } else if (p.thr < selfThresh && p.midYes < selfMid - 0.02) {
          const adjusted = clamp((selfMid + p.midYes) / 2 - 0.02, 0.02, 0.98)
          push(
            adjusted,
            0.4,
            'structure',
            'Ladder monotone fix',
            `Lower threshold ${p.thr} mid ${(p.midYes * 100).toFixed(0)}¢ < this ${selfThresh} — structure adjust (weak)`,
          )
        }
      }
    }
  }

  const complement = peers.find((p) => looksComplementary(market.title || '', p.title))
  if (complement) {
    const implied = clamp(1 - complement.midYes, 0.02, 0.98)
    push(
      implied,
      0.45,
      'cross_market',
      'Complement mid',
      `1 − peer "${complement.ticker}" mid ${(complement.midYes * 100).toFixed(0)}¢ → ${(implied * 100).toFixed(0)}¢`,
    )
  }

  // Heavy anchor to own mid so structure alone cannot invent large fake edges
  push(selfMid, 0.55, 'structure', 'Kalshi mid anchor', `Own mid ${(selfMid * 100).toFixed(0)}¢ as structure anchor (not external fair)`)

  fair = weightSum > 0 ? clamp(acc / weightSum, 0.02, 0.98) : selfMid
  return { fair, sources }
}

function extractThreshold(title: string): number | null {
  const m =
    title.match(/(?:above|over|≥|>=|below|under|≤|<=|at\s+least)\s*\$?(\d+(?:\.\d+)?)/i) ||
    title.match(/(\d+(?:\.\d+)?)\s*%/) ||
    title.match(/\$(\d+(?:\.\d+)?)/)
  if (!m) return null
  return Number(m[1])
}

function looksComplementary(a: string, b: string): boolean {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  const pairs: Array<[RegExp, RegExp]> = [
    [/democrat|dem\b/, /republican|gop|gop\b/],
    [/\byes\b/, /\bno\b/],
    [/afc/, /nfc/],
    [/above|over/, /below|under/],
  ]
  return pairs.some(
    ([p, q]) => (p.test(x) && q.test(y)) || (q.test(x) && p.test(y)),
  )
}

export interface ExternalContext {
  noaaByTicker: Record<string, NoaaFairEstimate>
  oddsByTicker: Record<string, OddsFairEstimate>
  sportsParses: Record<string, SportsMarketParse>
  oddsApiConfigured: boolean
}

/**
 * Prefetch free external signals for a market universe.
 * NOAA works without keys; Odds API via VITE_ODDS_API_KEY; ESPN keyless fallback.
 */
export async function prefetchExternals(
  markets: KalshiMarketRaw[],
  signal?: AbortSignal,
): Promise<ExternalContext> {
  const noaaByTicker: ExternalContext['noaaByTicker'] = {}
  const oddsByTicker: ExternalContext['oddsByTicker'] = {}
  const sportsParses: ExternalContext['sportsParses'] = {}

  const weatherJobs: Promise<void>[] = []
  const sportsParsesList: SportsMarketParse[] = []

  for (const m of markets) {
    const title = m.title || m.yes_sub_title || m.ticker
    const hint = detectWeatherMarket(title, m.ticker)
    if (hint) {
      weatherJobs.push(
        (async () => {
          const live = await fetchNoaaFair(hint, signal)
          const est =
            live ??
            (m.demo_fair_prob !== undefined
              ? {
                  fairProb: m.demo_fair_prob,
                  cityKey: hint.cityKey,
                  detail: m.demo_fair_source || 'Demo external fair (fixture)',
                }
              : demoClimatologyFair(hint))
          if (est) noaaByTicker[m.ticker] = est
        })(),
      )
    }

    if (detectSportsMarket(title, m.ticker, m.category || '')) {
      const parsed = parseSportsMarket(title, m.ticker, m.category || '')
      sportsParses[m.ticker] = parsed
      sportsParsesList.push(parsed)
    }
  }

  // Batch Odds API by league (one request per sport, not per market)
  let bySport = new Map()
  if (sportsParsesList.length > 0 && oddsApiConfigured()) {
    try {
      bySport = await prefetchOddsUniverse(sportsParsesList, signal)
    } catch {
      bySport = new Map()
    }
  }

  const oddsJobs: Promise<void>[] = []
  for (const m of markets) {
    const parsed = sportsParses[m.ticker]
    if (!parsed) continue

    oddsJobs.push(
      (async () => {
        let odds: OddsFairEstimate | null = matchOddsFair(parsed, bySport)

        if (!odds) {
          odds = await fetchEspnFallbackFair(parsed, signal)
        }

        if (odds) {
          oddsByTicker[m.ticker] = odds
        } else if (m.demo_fair_prob !== undefined && m.demo_fair_source) {
          oddsByTicker[m.ticker] = {
            fairProb: m.demo_fair_prob,
            detail: m.demo_fair_source,
            bookCount: 0,
            source: 'demo',
            marketType: 'unknown',
          }
        }
      })(),
    )
  }

  await Promise.allSettled([...weatherJobs, ...oddsJobs])
  return {
    noaaByTicker,
    oddsByTicker,
    sportsParses,
    oddsApiConfigured: oddsApiConfigured(),
  }
}

/**
 * Blend structure + external sources into a single fair P(YES).
 * External sources dominate when present; structure alone stays tightly mid-anchored.
 */
export function estimateFairValue(
  market: KalshiMarketRaw,
  universe: MidInfo[],
  externals: ExternalContext,
): FairValueResult {
  const { fair: structFair, sources: structSources } = structureFair(market, universe)
  const sources: FairSource[] = [...structSources]
  let usedExternal = false

  let acc = 0
  let w = 0

  const noaa = externals.noaaByTicker[market.ticker]
  if (noaa) {
    const isLive = noaa.detail.startsWith('NWS')
    const weight = isLive ? 0.85 : 0.7
    acc += noaa.fairProb * weight
    w += weight
    usedExternal = true
    sources.push({
      kind: isLive ? 'noaa' : 'demo_external',
      label: isLive ? 'NOAA/NWS forecast' : 'Weather prior (demo/climatology)',
      detail: noaa.detail,
      weight,
    })
  }

  const odds = externals.oddsByTicker[market.ticker]
  if (odds) {
    const isDemo = odds.source === 'demo'
    const isFallback = odds.source === 'espn_fallback'
    const weight = isDemo ? 0.75 : isFallback ? 0.55 : 0.9
    acc += odds.fairProb * weight
    w += weight
    usedExternal = true
    sources.push({
      kind: isDemo ? 'demo_external' : isFallback ? 'odds_fallback' : 'odds_api',
      label: isDemo
        ? 'Demo sports fair'
        : isFallback
          ? 'ESPN keyless fallback'
          : 'Odds API consensus',
      detail: odds.detail,
      weight,
    })
  }

  // Explicit fixture override for non-weather / non-sports demo edge examples
  if (
    market.demo_fair_prob !== undefined &&
    !noaa &&
    !odds &&
    market.demo_fair_source
  ) {
    const weight = 0.85
    acc += market.demo_fair_prob * weight
    w += weight
    usedExternal = true
    sources.push({
      kind: 'demo_external',
      label: 'Demo external fair',
      detail: market.demo_fair_source,
      weight,
    })
  }

  // When we have external fair, lightly blend structure; when not, structure-only
  if (usedExternal) {
    acc += structFair * 0.15
    w += 0.15
  } else {
    acc = structFair
    w = 1
  }

  const fairProb = clamp(acc / Math.max(w, 1e-9), 0.02, 0.98)
  return {
    fairProb,
    sources,
    usedExternal,
    structureOnly: !usedExternal,
  }
}

export function buildUniverse(markets: KalshiMarketRaw[]): MidInfo[] {
  return markets.map((m) => ({
    ticker: m.ticker,
    eventTicker: m.event_ticker,
    title: m.title || m.yes_sub_title || m.ticker,
    midYes: midOf(m),
    category: m.category || 'Other',
  }))
}
