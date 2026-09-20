import type { FairSource, FairSourceKind, KalshiMarketRaw } from '../types/kalshi'
import {
  demoClimatologyFair,
  detectWeatherMarket,
  fetchNoaaFair,
  type NoaaFairEstimate,
} from './external/noaa'
import { detectSportsMarket, fetchOddsFair } from './external/odds'
import { assessLiquidity } from './liquidity'

export interface FairValueResult {
  fairProb: number
  sources: FairSource[]
  usedExternal: boolean
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
 * - Event-peer mean pull for same event_ticker
 * - Nested threshold consistency (higher bar → lower YES)
 * - Complementarity hint when titles look mutually exclusive
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

  // Weak prior: mild shrink toward 50¢ — documents uncertainty, never claimed as edge alone
  push(0.5, 0.15, 'weak_prior', 'Weak 50¢ prior', 'Shrink toward coin-flip when signals are thin (weak)')

  // Peer mean within same event (cross-market)
  if (peers.length > 0) {
    const peerMean = peers.reduce((s, p) => s + p.midYes, 0) / peers.length
    // Only gently pull — peers are related but not identical contracts
    push(
      clamp(selfMid * 0.7 + peerMean * 0.3, 0.02, 0.98),
      0.35,
      'cross_market',
      'Event peer blend',
      `Blended with ${peers.length} same-event mid(s); mean peer ${(peerMean * 100).toFixed(0)}¢ (structure)`,
    )
  }

  // Nested numeric thresholds in same event: "above X" should be monotone
  const selfThresh = extractThreshold(market.title || market.yes_sub_title || '')
  if (selfThresh !== null && peers.length > 0) {
    const nested = peers
      .map((p) => ({ ...p, thr: extractThreshold(p.title) }))
      .filter((p) => p.thr !== null) as Array<MidInfo & { thr: number }>

    if (nested.length > 0) {
      // If a higher threshold trades richer than a lower one, fair-adjust toward monotone
      let adjusted = selfMid
      for (const p of nested) {
        if (p.thr > selfThresh && p.midYes > selfMid + 0.02) {
          // Violation: higher bar priced higher — pull our fair up a bit / theirs would be down
          adjusted = clamp((selfMid + p.midYes) / 2 + 0.02, 0.02, 0.98)
          push(
            adjusted,
            0.4,
            'structure',
            'Ladder monotone fix',
            `Higher threshold ${p.thr} mid ${(p.midYes * 100).toFixed(0)}¢ > this ${selfThresh} mid ${(selfMid * 100).toFixed(0)}¢ — structure adjust (weak)`,
          )
        } else if (p.thr < selfThresh && p.midYes < selfMid - 0.02) {
          adjusted = clamp((selfMid + p.midYes) / 2 - 0.02, 0.02, 0.98)
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

  // Complementarity: title pairs like "Dem control" vs implied opposite in same event
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

  // Anchor to own mid so we don't invent large edges from structure alone
  push(selfMid, 0.4, 'structure', 'Kalshi mid anchor', `Own mid ${(selfMid * 100).toFixed(0)}¢ as structure anchor`)

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
  oddsByTicker: Record<string, { fairProb: number; detail: string }>
}

/**
 * Prefetch free external signals for a market universe.
 * NOAA works without keys; Odds API is optional via VITE_ODDS_API_KEY.
 */
export async function prefetchExternals(
  markets: KalshiMarketRaw[],
  signal?: AbortSignal,
): Promise<ExternalContext> {
  const noaaByTicker: ExternalContext['noaaByTicker'] = {}
  const oddsByTicker: ExternalContext['oddsByTicker'] = {}

  const weatherJobs: Promise<void>[] = []
  const oddsJobs: Promise<void>[] = []

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
      oddsJobs.push(
        (async () => {
          const odds = await fetchOddsFair(title, signal)
          if (odds) {
            oddsByTicker[m.ticker] = { fairProb: odds.fairProb, detail: odds.detail }
          } else if (m.demo_fair_prob !== undefined && m.demo_fair_source) {
            oddsByTicker[m.ticker] = {
              fairProb: m.demo_fair_prob,
              detail: m.demo_fair_source,
            }
          }
        })(),
      )
    }
  }

  await Promise.allSettled([...weatherJobs, ...oddsJobs])
  return { noaaByTicker, oddsByTicker }
}

/**
 * Blend structure + external sources into a single fair P(YES).
 */
export function estimateFairValue(
  market: KalshiMarketRaw,
  universe: MidInfo[],
  externals: ExternalContext,
): FairValueResult {
  const { fair: structFair, sources: structSources } = structureFair(market, universe)
  const sources: FairSource[] = [...structSources]
  let usedExternal = false

  let acc = structFair * 0.35
  let w = 0.35

  const noaa = externals.noaaByTicker[market.ticker]
  if (noaa) {
    const isLive = noaa.detail.startsWith('NWS')
    const weight = isLive ? 0.7 : 0.55
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
    const isDemo = odds.detail.toLowerCase().includes('demo')
    const weight = isDemo ? 0.5 : 0.65
    acc += odds.fairProb * weight
    w += weight
    usedExternal = true
    sources.push({
      kind: isDemo ? 'demo_external' : 'odds_api',
      label: isDemo ? 'Demo sports fair' : 'Odds API',
      detail: odds.detail,
      weight,
    })
  }

  // Explicit fixture override for non-weather demo edge examples
  if (
    market.demo_fair_prob !== undefined &&
    !noaa &&
    !odds &&
    market.demo_fair_source
  ) {
    const weight = 0.6
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

  const fairProb = clamp(acc / w, 0.02, 0.98)
  return { fairProb, sources, usedExternal }
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

