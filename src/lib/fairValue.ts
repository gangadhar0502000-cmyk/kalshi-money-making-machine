import type { FairSource, FairSourceKind, KalshiMarketRaw } from '../types/kalshi'
import {
  demoClimatologyFair,
  detectWeatherMarket,
  fetchNoaaFair,
  type NoaaFairEstimate,
} from './external/noaa'
import {
  detectSportsMarket,
  matchEspnFair,
  parseSportsMarket,
  prefetchEspnUniverse,
  type SportsFairEstimate,
  type SportsMarketParse,
} from './external/espn'
import {
  matchPolymarketFair,
  prefetchPolymarket,
  type PolymarketFairEstimate,
} from './external/polymarket'
import { assessLiquidity } from './liquidity'

export interface FairValueResult {
  fairProb: number
  sources: FairSource[]
  usedExternal: boolean
  /** Structure-only (no NOAA/ESPN/Polymarket/demo external) */
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
  sportsByTicker: Record<string, SportsFairEstimate>
  polyByTicker: Record<string, PolymarketFairEstimate>
  sportsParses: Record<string, SportsMarketParse>
  freeFetchFailed: boolean
  freeFetchErrors: string[]
  espnMatchCount: number
  polymarketMatchCount: number
}

/**
 * Prefetch free external signals for a market universe.
 * NOAA / ESPN / Polymarket — no API keys required.
 */
export async function prefetchExternals(
  markets: KalshiMarketRaw[],
  signal?: AbortSignal,
): Promise<ExternalContext> {
  const noaaByTicker: ExternalContext['noaaByTicker'] = {}
  const sportsByTicker: ExternalContext['sportsByTicker'] = {}
  const polyByTicker: ExternalContext['polyByTicker'] = {}
  const sportsParses: ExternalContext['sportsParses'] = {}
  const freeFetchErrors: string[] = []

  const weatherJobs: Promise<void>[] = []
  const sportsParsesList: SportsMarketParse[] = []

  for (const m of markets) {
    const title = m.title || m.yes_sub_title || m.ticker
    const hint = detectWeatherMarket(title, m.ticker)
    if (hint) {
      weatherJobs.push(
        (async () => {
          try {
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
          } catch (e) {
            freeFetchErrors.push(
              e instanceof Error ? `NOAA: ${e.message}` : 'NOAA fetch failed',
            )
          }
        })(),
      )
    }

    if (detectSportsMarket(title, m.ticker, m.category || '')) {
      const parsed = parseSportsMarket(title, m.ticker, m.category || '')
      sportsParses[m.ticker] = parsed
      sportsParsesList.push(parsed)
    }
  }

  let espnResult: Awaited<ReturnType<typeof prefetchEspnUniverse>> = {
    byLeague: new Map(),
    errors: [],
  }
  if (sportsParsesList.length > 0) {
    try {
      espnResult = await prefetchEspnUniverse(sportsParsesList, signal)
      freeFetchErrors.push(...espnResult.errors)
    } catch (e) {
      freeFetchErrors.push(e instanceof Error ? e.message : 'ESPN prefetch failed')
    }
  }

  let polyMarkets: Parameters<typeof matchPolymarketFair>[3] = []
  try {
    const poly = await prefetchPolymarket(signal)
    polyMarkets = poly.markets
    if (poly.error) freeFetchErrors.push(poly.error)
  } catch (e) {
    freeFetchErrors.push(e instanceof Error ? e.message : 'Polymarket prefetch failed')
  }

  let espnMatchCount = 0
  let polymarketMatchCount = 0

  const matchJobs: Promise<void>[] = []
  for (const m of markets) {
    const title = m.title || m.yes_sub_title || m.ticker
    const parsed = sportsParses[m.ticker]
    if (parsed) {
      matchJobs.push(
        (async () => {
          const espnHit = matchEspnFair(parsed, espnResult.byLeague)
          if (espnHit) {
            sportsByTicker[m.ticker] = espnHit
            espnMatchCount += 1
          } else if (m.demo_fair_prob !== undefined && m.demo_fair_source) {
            sportsByTicker[m.ticker] = {
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

    matchJobs.push(
      (async () => {
        const polyHit = matchPolymarketFair(title, m.ticker, m.category || '', polyMarkets)
        if (polyHit) {
          polyByTicker[m.ticker] = polyHit
          polymarketMatchCount += 1
        }
      })(),
    )
  }

  await Promise.allSettled([...weatherJobs, ...matchJobs])

  const freeFetchFailed =
    freeFetchErrors.length > 0 &&
    ((sportsParsesList.length > 0 && espnMatchCount === 0 && espnResult.errors.length > 0) ||
      freeFetchErrors.some((e) => /HTTP 429|rate|Polymarket HTTP|ESPN .* HTTP/i.test(e)))

  return {
    noaaByTicker,
    sportsByTicker,
    polyByTicker,
    sportsParses,
    freeFetchFailed,
    freeFetchErrors,
    espnMatchCount,
    polymarketMatchCount,
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

  const sports = externals.sportsByTicker[market.ticker]
  if (sports) {
    const isDemo = sports.source === 'demo'
    const weight = isDemo ? 0.75 : 0.9
    acc += sports.fairProb * weight
    w += weight
    usedExternal = true
    sources.push({
      kind: isDemo ? 'demo_external' : 'espn',
      label: isDemo ? 'Demo sports fair' : 'ESPN public odds',
      detail: sports.detail,
      weight,
    })
  }

  const poly = externals.polyByTicker[market.ticker]
  if (poly) {
    const weight = 0.8
    acc += poly.fairProb * weight
    w += weight
    usedExternal = true
    sources.push({
      kind: 'polymarket',
      label: 'Polymarket public mid',
      detail: poly.detail,
      weight,
    })
  }

  // Explicit fixture override for non-weather / non-sports demo edge examples
  if (
    market.demo_fair_prob !== undefined &&
    !noaa &&
    !sports &&
    !poly &&
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
