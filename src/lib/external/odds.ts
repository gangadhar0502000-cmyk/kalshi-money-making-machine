/**
 * Sports fair-value from The Odds API (preferred) + optional keyless ESPN fallback.
 *
 * Setup: free key at https://the-odds-api.com → VITE_ODDS_API_KEY in .env
 * Without a key, live sports edges are blocked in Strict Mode (demo fixtures still work).
 */

export interface OddsFairEstimate {
  fairProb: number
  detail: string
  bookCount: number
  source: 'odds_api' | 'espn_fallback' | 'demo'
  marketType: 'h2h' | 'spreads' | 'totals' | 'unknown'
}

export type SportsLeague = 'mlb' | 'ncaaf' | 'nfl' | 'nba' | 'nhl' | 'unknown'

export type SportsContractKind = 'moneyline' | 'spread' | 'total' | 'props' | 'unknown'

export interface SportsMarketParse {
  isSports: boolean
  league: SportsLeague
  kind: SportsContractKind
  /** Team / side the YES contract refers to (normalized) */
  teamHint?: string
  /** Opponent hint when detectable */
  opponentHint?: string
  /** Absolute spread line if present (Kalshi YES = team covers) */
  spreadLine?: number
  /** Total line if present */
  totalLine?: number
  /** For totals: YES means over or under */
  totalSide?: 'over' | 'under'
  /** Raw title used for matching */
  title: string
  ticker: string
}

function americanToProb(american: number): number {
  if (american > 0) return 100 / (american + 100)
  return -american / (-american + 100)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function normalizeTeam(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|at|vs|versus)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Last significant token of a team name ("New York Yankees" → "yankees") */
function teamKey(s: string): string {
  const n = normalizeTeam(s)
  const parts = n.split(' ').filter(Boolean)
  return parts[parts.length - 1] ?? n
}

const LEAGUE_PATTERNS: Array<{ league: SportsLeague; re: RegExp }> = [
  { league: 'mlb', re: /\bMLB\b|BASEBALL|KXMLB|YANKEES|DODGERS|CUBS|METS|RED\s*SOX/i },
  { league: 'ncaaf', re: /\bNCAAF\b|COLLEGE\s*FOOTBALL|KXNCAAF|CFB/i },
  { league: 'nfl', re: /\bNFL\b|SUPER\s*BOWL|\bAFC\b|\bNFC\b|KXNFL/i },
  { league: 'nba', re: /\bNBA\b|KXNBA/i },
  { league: 'nhl', re: /\bNHL\b|KXNHL|HOCKEY/i },
]

const ODDS_SPORT_KEYS: Record<Exclude<SportsLeague, 'unknown'>, string> = {
  mlb: 'baseball_mlb',
  ncaaf: 'americanfootball_ncaaf',
  nfl: 'americanfootball_nfl',
  nba: 'basketball_nba',
  nhl: 'icehockey_nhl',
}

const ESPN_PATHS: Partial<Record<SportsLeague, string>> = {
  mlb: 'baseball/mlb',
  ncaaf: 'football/college-football',
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
}

/** Soft-detect sports markets that might map to odds feeds. */
export function detectSportsMarket(title: string, ticker: string, category: string): boolean {
  return parseSportsMarket(title, ticker, category).isSports
}

export function parseSportsMarket(
  title: string,
  ticker: string,
  category: string = '',
): SportsMarketParse {
  const blob = `${title} ${ticker} ${category}`
  const upper = blob.toUpperCase()
  const isSports =
    /NFL|NBA|MLB|NHL|NCAAF|NCAAB|SOCCER|UFC|SPORT|SUPER.?BOWL|AFC|NFC|MARCH.?MADNESS|KX(MLB|NFL|NBA|NHL|NCAAF|GAME)/.test(
      upper,
    ) ||
    category.toLowerCase() === 'sports'

  let league: SportsLeague = 'unknown'
  for (const { league: L, re } of LEAGUE_PATTERNS) {
    if (re.test(blob)) {
      league = L
      break
    }
  }

  let kind: SportsContractKind = 'unknown'
  let totalLine: number | undefined
  let totalSide: 'over' | 'under' | undefined
  let spreadLine: number | undefined
  let teamHint: string | undefined

  const totalMatch =
    title.match(/\b(over|under)\s+(\d+(?:\.\d+)?)\b/i) ||
    title.match(/\b(o|u)\s*\/?\s*(\d+(?:\.\d+)?)\b/i) ||
    ticker.match(/(?:OVER|UNDER|O|U)[-_]?(\d+(?:\.\d+)?)/i)
  if (totalMatch) {
    kind = 'total'
    const sideRaw = (totalMatch[1] || '').toLowerCase()
    totalSide = sideRaw.startsWith('u') ? 'under' : 'over'
    totalLine = Number(totalMatch[2] ?? totalMatch[1])
    if (!Number.isFinite(totalLine)) totalLine = undefined
  }

  const spreadMatch =
    title.match(/\b([A-Za-z .']+?)\s+([+-]\d+(?:\.\d+)?)\b/) ||
    ticker.match(/(?:SPREAD|ATS)[-_]?([+-]?\d+(?:\.\d+)?)/i)
  if (kind === 'unknown' && spreadMatch) {
    const maybeTeam = spreadMatch[1]?.trim()
    const line = Number(spreadMatch[2] ?? spreadMatch[1])
    if (Number.isFinite(line) && Math.abs(line) <= 50) {
      kind = 'spread'
      spreadLine = line
      if (maybeTeam && /[a-zA-Z]/.test(maybeTeam) && maybeTeam.length > 2) {
        teamHint = teamKey(maybeTeam)
      }
    }
  }

  if (kind === 'unknown') {
    if (/moneyline|to win|wins?\b|ml\b/i.test(title) || /[-_](ML|WIN)\b/i.test(ticker)) {
      kind = 'moneyline'
    } else if (/spread|cover|ats/i.test(blob)) {
      kind = 'spread'
    } else if (/total|over|under|o\/u/i.test(blob)) {
      kind = 'total'
    } else {
      kind = 'moneyline' // default game markets
    }
  }

  // Team from yes_sub style endings or "Will X win"
  if (!teamHint) {
    const willWin = title.match(/will\s+(.+?)\s+win/i)
    const vs = title.match(/(.+?)\s+(?:vs\.?|@|at)\s+(.+)/i)
    if (willWin) teamHint = teamKey(willWin[1])
    else if (vs) {
      teamHint = teamKey(vs[1])
    } else {
      // ticker suffix often encodes team abbrev
      const parts = ticker.split('-')
      const last = parts[parts.length - 1]
      if (last && /^[A-Z]{2,4}$/.test(last)) teamHint = last.toLowerCase()
    }
  }

  let opponentHint: string | undefined
  const vs2 = title.match(/(.+?)\s+(?:vs\.?|@|at)\s+(.+?)(?:\?|$)/i)
  if (vs2) {
    opponentHint = teamKey(vs2[2])
    if (!teamHint) teamHint = teamKey(vs2[1])
  }

  return {
    isSports,
    league,
    kind,
    teamHint,
    opponentHint,
    spreadLine,
    totalLine,
    totalSide,
    title,
    ticker,
  }
}

export function oddsApiConfigured(): boolean {
  const key = import.meta.env.VITE_ODDS_API_KEY as string | undefined
  return Boolean(key && key.trim())
}

export function getOddsApiKey(): string | undefined {
  const key = import.meta.env.VITE_ODDS_API_KEY as string | undefined
  return key && key.trim() ? key.trim() : undefined
}

interface OddsEvent {
  id?: string
  sport_key?: string
  home_team?: string
  away_team?: string
  commence_time?: string
  bookmakers?: Array<{
    key?: string
    title?: string
    markets?: Array<{
      key?: string
      outcomes?: Array<{
        name?: string
        description?: string
        price?: number
        point?: number
      }>
    }>
  }>
}

/** In-memory cache for Odds API sport snapshots (per page load). */
const oddsCache = new Map<string, { at: number; events: OddsEvent[] }>()
const CACHE_MS = 90_000

async function fetchOddsSport(sportKey: string, signal?: AbortSignal): Promise<OddsEvent[]> {
  const key = getOddsApiKey()
  if (!key) return []

  const cached = oddsCache.get(sportKey)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.events

  const url =
    `/api/odds/v4/sports/${sportKey}/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=american&apiKey=${encodeURIComponent(key)}`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`odds HTTP ${res.status}`)
  const data = (await res.json()) as OddsEvent[]
  const events = Array.isArray(data) ? data : []
  oddsCache.set(sportKey, { at: Date.now(), events })
  return events
}

function teamsMatch(hint: string | undefined, teamName: string): boolean {
  if (!hint) return false
  const h = normalizeTeam(hint)
  const t = normalizeTeam(teamName)
  if (!h || !t) return false
  if (t.includes(h) || h.includes(t)) return true
  const hk = teamKey(h)
  const tk = teamKey(t)
  return hk.length >= 3 && (hk === tk || t.includes(hk) || h.includes(tk))
}

function findMatchingEvent(events: OddsEvent[], parsed: SportsMarketParse): OddsEvent | null {
  const scored = events.map((g) => {
    const home = g.home_team ?? ''
    const away = g.away_team ?? ''
    let score = 0
    if (teamsMatch(parsed.teamHint, home) || teamsMatch(parsed.teamHint, away)) score += 3
    if (teamsMatch(parsed.opponentHint, home) || teamsMatch(parsed.opponentHint, away)) score += 2
    const titleN = normalizeTeam(parsed.title)
    if (home && titleN.includes(teamKey(home))) score += 2
    if (away && titleN.includes(teamKey(away))) score += 2
    return { g, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0] && scored[0].score >= 2 ? scored[0].g : null
}

function consensusMoneyline(
  event: OddsEvent,
  teamHint: string | undefined,
): { fairProb: number; books: number; side: string } | null {
  const home = event.home_team ?? ''
  const away = event.away_team ?? ''
  const preferHome = teamsMatch(teamHint, home)
  const preferAway = teamsMatch(teamHint, away)
  const targetName = preferAway && !preferHome ? away : preferHome ? home : home

  const probs: number[] = []
  for (const book of event.bookmakers ?? []) {
    const m = (book.markets ?? []).find((x) => x.key === 'h2h')
    if (!m) continue
    const outcome = (m.outcomes ?? []).find((o) => teamsMatch(targetName, o.name ?? ''))
    if (outcome && typeof outcome.price === 'number') {
      probs.push(americanToProb(outcome.price))
    }
  }
  if (probs.length === 0) return null
  // De-vig roughly: average raw implied (research — not full vig strip)
  const fairProb = clamp(probs.reduce((a, b) => a + b, 0) / probs.length, 0.02, 0.98)
  return { fairProb, books: probs.length, side: targetName }
}

function consensusSpread(
  event: OddsEvent,
  teamHint: string | undefined,
  line?: number,
): { fairProb: number; books: number; detail: string } | null {
  const home = event.home_team ?? ''
  const away = event.away_team ?? ''
  const preferAway = teamsMatch(teamHint, away) && !teamsMatch(teamHint, home)
  const targetName = preferAway ? away : teamsMatch(teamHint, home) ? home : home

  const probs: number[] = []
  let usedPoint: number | undefined
  for (const book of event.bookmakers ?? []) {
    const m = (book.markets ?? []).find((x) => x.key === 'spreads')
    if (!m) continue
    const outcomes = m.outcomes ?? []
    let outcome = outcomes.find((o) => teamsMatch(targetName, o.name ?? ''))
    if (line !== undefined && outcome) {
      const close = outcomes.find(
        (o) =>
          teamsMatch(targetName, o.name ?? '') &&
          typeof o.point === 'number' &&
          Math.abs((o.point as number) - line) <= 0.6,
      )
      if (close) outcome = close
    }
    if (outcome && typeof outcome.price === 'number') {
      probs.push(americanToProb(outcome.price))
      if (typeof outcome.point === 'number') usedPoint = outcome.point
    }
  }
  if (probs.length === 0) return null
  const fairProb = clamp(probs.reduce((a, b) => a + b, 0) / probs.length, 0.02, 0.98)
  return {
    fairProb,
    books: probs.length,
    detail: `${targetName} ${usedPoint !== undefined ? usedPoint : line ?? ''}`.trim(),
  }
}

function consensusTotal(
  event: OddsEvent,
  side: 'over' | 'under',
  line?: number,
): { fairProb: number; books: number; detail: string } | null {
  const probs: number[] = []
  let usedPoint: number | undefined
  for (const book of event.bookmakers ?? []) {
    const m = (book.markets ?? []).find((x) => x.key === 'totals')
    if (!m) continue
    let outcomes = m.outcomes ?? []
    if (line !== undefined) {
      const near = outcomes.filter(
        (o) => typeof o.point === 'number' && Math.abs((o.point as number) - line) <= 0.6,
      )
      if (near.length) outcomes = near
    }
    const outcome = outcomes.find((o) => (o.name ?? '').toLowerCase() === side)
    if (outcome && typeof outcome.price === 'number') {
      probs.push(americanToProb(outcome.price))
      if (typeof outcome.point === 'number') usedPoint = outcome.point
    }
  }
  if (probs.length === 0) return null
  const fairProb = clamp(probs.reduce((a, b) => a + b, 0) / probs.length, 0.02, 0.98)
  return {
    fairProb,
    books: probs.length,
    detail: `${side} ${usedPoint ?? line ?? ''}`.trim(),
  }
}

/**
 * Prefetch Odds API snapshots for leagues present in the universe.
 * Call once per refresh; then matchMarketsToOdds per market.
 */
export async function prefetchOddsUniverse(
  parses: SportsMarketParse[],
  signal?: AbortSignal,
): Promise<Map<string, OddsEvent[]>> {
  const bySport = new Map<string, OddsEvent[]>()
  if (!oddsApiConfigured()) return bySport

  const leagues = new Set<Exclude<SportsLeague, 'unknown'>>()
  for (const p of parses) {
    if (p.isSports && p.league !== 'unknown') leagues.add(p.league)
  }
  // Always try MLB + NCAAF when any sports present (core ask)
  if (parses.some((p) => p.isSports)) {
    leagues.add('mlb')
    leagues.add('ncaaf')
    leagues.add('nfl')
  }

  await Promise.all(
    [...leagues].map(async (league) => {
      const sportKey = ODDS_SPORT_KEYS[league]
      try {
        const events = await fetchOddsSport(sportKey, signal)
        bySport.set(sportKey, events)
      } catch {
        bySport.set(sportKey, [])
      }
    }),
  )
  return bySport
}

export function matchOddsFair(
  parsed: SportsMarketParse,
  bySport: Map<string, OddsEvent[]>,
): OddsFairEstimate | null {
  if (!parsed.isSports || parsed.league === 'unknown') {
    // Try all cached sports if league unknown
    for (const events of bySport.values()) {
      const hit = matchAgainstEvents(parsed, events)
      if (hit) return hit
    }
    return null
  }
  const sportKey = ODDS_SPORT_KEYS[parsed.league]
  const events = bySport.get(sportKey) ?? []
  return matchAgainstEvents(parsed, events)
}

function matchAgainstEvents(
  parsed: SportsMarketParse,
  events: OddsEvent[],
): OddsFairEstimate | null {
  if (!events.length) return null
  const event = findMatchingEvent(events, parsed)
  if (!event) return null

  if (parsed.kind === 'total' && parsed.totalSide) {
    const c = consensusTotal(event, parsed.totalSide, parsed.totalLine)
    if (!c) return null
    return {
      fairProb: c.fairProb,
      bookCount: c.books,
      source: 'odds_api',
      marketType: 'totals',
      detail: `Odds API ${c.detail}: consensus ${(c.fairProb * 100).toFixed(0)}% across ${c.books} books (${event.away_team} @ ${event.home_team})`,
    }
  }

  if (parsed.kind === 'spread') {
    const c = consensusSpread(event, parsed.teamHint, parsed.spreadLine)
    if (!c) return null
    return {
      fairProb: c.fairProb,
      bookCount: c.books,
      source: 'odds_api',
      marketType: 'spreads',
      detail: `Odds API spread ${c.detail}: consensus ${(c.fairProb * 100).toFixed(0)}% across ${c.books} books`,
    }
  }

  const c = consensusMoneyline(event, parsed.teamHint)
  if (!c) return null
  return {
    fairProb: c.fairProb,
    bookCount: c.books,
    source: 'odds_api',
    marketType: 'h2h',
    detail: `Odds API ML ${c.side}: consensus ${(c.fairProb * 100).toFixed(0)}% across ${c.books} books (${event.away_team} @ ${event.home_team})`,
  }
}

/**
 * Keyless fallback: ESPN public scoreboard sometimes embeds spread / total.
 * Weaker than Odds API — marked odds_fallback; Strict Mode still prefers Odds API.
 */
export async function fetchEspnFallbackFair(
  parsed: SportsMarketParse,
  signal?: AbortSignal,
): Promise<OddsFairEstimate | null> {
  if (!parsed.isSports || parsed.league === 'unknown') return null
  const path = ESPN_PATHS[parsed.league]
  if (!path) return null

  try {
    // Direct ESPN (often CORS-ok from browsers; if blocked, returns null)
    const url = `/api/espn/apis/site/v2/sports/${path}/scoreboard`
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data = (await res.json()) as {
      events?: Array<{
        name?: string
        shortName?: string
        competitions?: Array<{
          competitors?: Array<{ team?: { displayName?: string; shortDisplayName?: string; abbreviation?: string }; homeAway?: string }>
          odds?: Array<{
            details?: string
            overUnder?: number
            spread?: number
            awayTeamOdds?: { moneyLine?: number }
            homeTeamOdds?: { moneyLine?: number }
          }>
        }>
      }>
    }

    const events = data.events ?? []
    for (const ev of events) {
      const comp = ev.competitions?.[0]
      if (!comp) continue
      const teams = (comp.competitors ?? []).map((c) => ({
        name: c.team?.displayName ?? '',
        short: c.team?.shortDisplayName ?? '',
        abbr: c.team?.abbreviation ?? '',
        homeAway: c.homeAway,
      }))
      const hit = teams.some(
        (t) =>
          teamsMatch(parsed.teamHint, t.name) ||
          teamsMatch(parsed.teamHint, t.short) ||
          (parsed.teamHint && t.abbr.toLowerCase() === parsed.teamHint.toLowerCase()),
      )
      if (!hit && parsed.teamHint) {
        const blob = `${ev.name ?? ''} ${ev.shortName ?? ''}`.toLowerCase()
        if (!blob.includes(parsed.teamHint.toLowerCase())) continue
      } else if (!hit && !parsed.teamHint) {
        continue
      }

      const odds = comp.odds?.[0]
      if (!odds) continue

      if (parsed.kind === 'total' && typeof odds.overUnder === 'number' && parsed.totalSide) {
        // Without prices, use distance-from-line heuristic only when Kalshi line ≈ ESPN O/U
        if (
          parsed.totalLine !== undefined &&
          Math.abs(parsed.totalLine - odds.overUnder) > 1.5
        ) {
          continue
        }
        // Neutral 50% when we only have the number — not useful as edge; skip
        // Prefer moneyline if present
      }

      const home = teams.find((t) => t.homeAway === 'home')
      const away = teams.find((t) => t.homeAway === 'away')
      const preferAway =
        teamsMatch(parsed.teamHint, away?.name ?? '') ||
        teamsMatch(parsed.teamHint, away?.short ?? '')
      const ml = preferAway ? odds.awayTeamOdds?.moneyLine : odds.homeTeamOdds?.moneyLine
      if (typeof ml === 'number') {
        const fairProb = clamp(americanToProb(ml), 0.02, 0.98)
        return {
          fairProb,
          bookCount: 1,
          source: 'espn_fallback',
          marketType: 'h2h',
          detail: `ESPN keyless ML fallback (${preferAway ? away?.name : home?.name}): ${(fairProb * 100).toFixed(0)}% — weaker than Odds API; research only`,
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Per-market fetch (legacy single-call). Prefer prefetchOddsUniverse + matchOddsFair.
 */
export async function fetchOddsFair(
  title: string,
  signal?: AbortSignal,
  ticker: string = '',
  category: string = '',
): Promise<OddsFairEstimate | null> {
  const parsed = parseSportsMarket(title, ticker, category)
  if (!parsed.isSports) return null

  if (oddsApiConfigured()) {
    const bySport = await prefetchOddsUniverse([parsed], signal)
    const hit = matchOddsFair(parsed, bySport)
    if (hit) return hit
  }

  return fetchEspnFallbackFair(parsed, signal)
}
