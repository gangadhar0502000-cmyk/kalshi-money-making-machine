/**
 * Optional The Odds API (https://the-odds-api.com) — free tier needs a key.
 * Set VITE_ODDS_API_KEY in .env; if missing, this module is a no-op.
 */

export interface OddsFairEstimate {
  fairProb: number
  detail: string
  bookCount: number
}

function americanToProb(american: number): number {
  if (american > 0) return 100 / (american + 100)
  return -american / (-american + 100)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Soft-detect sports markets that might map to odds feeds. */
export function detectSportsMarket(title: string, ticker: string, category: string): boolean {
  const blob = `${title} ${ticker} ${category}`.toUpperCase()
  return /NFL|NBA|MLB|NHL|SOCCER|UFC|SPORT|SUPER.?BOWL|AFC|NFC|MARCH.?MADNESS/.test(blob)
}

/**
 * Attempt to pull consensus odds. Degrades to null without a key or on error.
 * Uses a broad search; matching is best-effort for research UX only.
 */
export async function fetchOddsFair(
  title: string,
  signal?: AbortSignal,
): Promise<OddsFairEstimate | null> {
  const key = import.meta.env.VITE_ODDS_API_KEY as string | undefined
  if (!key || !key.trim()) return null

  try {
    // Free-tier example: American football odds snapshot
    const url =
      `/api/odds/v4/sports/americanfootball_nfl/odds?regions=us&markets=h2h&oddsFormat=american&apiKey=${encodeURIComponent(key.trim())}`
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`odds HTTP ${res.status}`)
    const data = (await res.json()) as Array<{
      home_team?: string
      away_team?: string
      bookmakers?: Array<{
        markets?: Array<{
          outcomes?: Array<{ name?: string; price?: number }>
        }>
      }>
    }>

    if (!Array.isArray(data) || data.length === 0) return null

    const titleLower = title.toLowerCase()
    const match = data.find((g) => {
      const home = (g.home_team ?? '').toLowerCase()
      const away = (g.away_team ?? '').toLowerCase()
      return (
        (home && titleLower.includes(home.split(' ').pop()!)) ||
        (away && titleLower.includes(away.split(' ').pop()!)) ||
        titleLower.includes('afc') ||
        titleLower.includes('nfc')
      )
    })

    // Conference / Super Bowl style: average home-win implied across books for first match as weak signal
    const target = match ?? data[0]
    const probs: number[] = []
    for (const book of target.bookmakers ?? []) {
      for (const market of book.markets ?? []) {
        for (const o of market.outcomes ?? []) {
          if (typeof o.price === 'number') probs.push(americanToProb(o.price))
        }
      }
    }
    if (probs.length === 0) return null

    // For AFC-wins style markets, use average of first outcomes as rough fair
    const fairProb = clamp(probs.reduce((a, b) => a + b, 0) / probs.length, 0.05, 0.95)
    return {
      fairProb,
      bookCount: target.bookmakers?.length ?? 0,
      detail: `The Odds API consensus (~${probs.length} quotes, ${target.bookmakers?.length ?? 0} books) → P≈${(fairProb * 100).toFixed(0)}% (best-effort match)`,
    }
  } catch {
    return null
  }
}

export function oddsApiConfigured(): boolean {
  const key = import.meta.env.VITE_ODDS_API_KEY as string | undefined
  return Boolean(key && key.trim())
}
