/**
 * Free Polymarket Gamma API fair-value (no API key).
 * Matches overlapping event-style Kalshi markets by title similarity.
 * Coverage is incomplete — research tool only.
 */

export interface PolymarketFairEstimate {
  fairProb: number
  detail: string
  source: 'polymarket' | 'demo'
  polymarketSlug?: string
}

interface PolyMarket {
  id?: string
  question?: string
  slug?: string
  outcomePrices?: string
  outcomes?: string
  volume?: string | number
  volume24hr?: number
  liquidity?: string | number
  active?: boolean
  closed?: boolean
}

const cache: { at: number; markets: PolyMarket[]; error?: string } = {
  at: 0,
  markets: [],
}

const CACHE_MS = 120_000

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .filter(
      (w) =>
        !['will', 'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'been', 'into'].includes(
          w,
        ),
    )
}

function titleSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter += 1
  const union = ta.size + tb.size - inter
  return union > 0 ? inter / union : 0
}

function parseYesProb(m: PolyMarket): number | null {
  try {
    const pricesRaw = m.outcomePrices
    const outcomesRaw = m.outcomes
    if (!pricesRaw) return null
    const prices = (
      typeof pricesRaw === 'string' ? (JSON.parse(pricesRaw) as string[]) : (pricesRaw as unknown as string[])
    ).map((p) => Number(p))
    const outcomes: string[] =
      typeof outcomesRaw === 'string'
        ? (JSON.parse(outcomesRaw) as string[])
        : Array.isArray(outcomesRaw)
          ? (outcomesRaw as string[])
          : []

    if (!prices.length || prices.some((p) => !Number.isFinite(p))) return null

    let yesIdx = outcomes.findIndex((o) => /^yes$/i.test(String(o)))
    if (yesIdx < 0) yesIdx = 0
    return clamp(prices[yesIdx] ?? prices[0], 0.02, 0.98)
  } catch {
    return null
  }
}

/** Prefetch a volume-ranked slice of active Polymarket markets. */
export async function prefetchPolymarket(
  signal?: AbortSignal,
): Promise<{ markets: PolyMarket[]; error?: string }> {
  if (Date.now() - cache.at < CACHE_MS && (cache.markets.length || cache.error)) {
    return { markets: cache.markets, error: cache.error }
  }

  try {
    const url =
      '/api/polymarket/markets?closed=false&active=true&limit=100&order=volume24hr&ascending=false'
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    if (!res.ok) {
      const error = `Polymarket HTTP ${res.status}`
      cache.at = Date.now()
      cache.markets = []
      cache.error = error
      return { markets: [], error }
    }
    const data = (await res.json()) as PolyMarket[]
    const markets = Array.isArray(data) ? data.filter((m) => !m.closed) : []
    cache.at = Date.now()
    cache.markets = markets
    cache.error = undefined
    return { markets }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Polymarket fetch failed'
    cache.at = Date.now()
    cache.markets = []
    cache.error = error
    return { markets: [], error }
  }
}

/**
 * Match a Kalshi title to a Polymarket market when titles overlap strongly.
 * Skips single-game sports tickets (those use ESPN).
 */
export function matchPolymarketFair(
  title: string,
  ticker: string,
  category: string,
  markets: PolyMarket[],
): PolymarketFairEstimate | null {
  if (!markets.length) return null

  const blob = `${title} ${ticker} ${category}`.toLowerCase()
  const looksLikeSingleGame =
    /will the .+ beat|vs\.? | @ |moneyline|over \d|under \d|spread/i.test(title) &&
    /sports|mlb|nfl|nba|nhl|ncaaf/i.test(blob)
  if (looksLikeSingleGame) return null

  let best: { m: PolyMarket; score: number } | null = null
  for (const m of markets) {
    const q = m.question ?? ''
    if (!q) continue
    const score = titleSimilarity(title, q)
    if (!best || score > best.score) best = { m, score }
  }

  if (!best || best.score < 0.45) return null

  const fairProb = parseYesProb(best.m)
  if (fairProb === null) return null

  return {
    fairProb,
    source: 'polymarket',
    polymarketSlug: best.m.slug,
    detail: `Polymarket "${best.m.question}" YES ~${(fairProb * 100).toFixed(0)}% (title match ${(best.score * 100).toFixed(0)}%)`,
  }
}
