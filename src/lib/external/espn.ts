/**
 * Free ESPN public scoreboard/odds fair-value (no API key).
 * Matches Kalshi MLB / NFL / NBA / NCAAF (NHL when present) moneylines,
 * spreads, and totals when ESPN embeds sportsbook odds.
 *
 * Feeds can be incomplete — research tool only.
 */

export interface SportsFairEstimate {
  fairProb: number
  detail: string
  bookCount: number
  source: 'espn' | 'demo'
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
  /** Spread line if present (Kalshi YES = team covers) */
  spreadLine?: number
  /** Total line if present */
  totalLine?: number
  /** For totals: YES means over or under */
  totalSide?: 'over' | 'under'
  title: string
  ticker: string
}

function americanToProb(american: number): number {
  if (american > 0) return 100 / (american + 100)
  return -american / (-american + 100)
}

function parseAmerican(raw: string | number | undefined | null): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const s = String(raw).trim().replace(/[^\d+-]/g, '')
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
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

/** Last significant token ("New York Yankees" → "yankees") */
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

const ESPN_PATHS: Partial<Record<SportsLeague, string>> = {
  mlb: 'baseball/mlb',
  ncaaf: 'football/college-football',
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
}

/** Soft-detect sports markets that might map to ESPN feeds. */
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
    ) || category.toLowerCase() === 'sports'

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
      kind = 'moneyline'
    }
  }

  if (!teamHint) {
    const willWin = title.match(/will\s+(.+?)\s+win/i)
    const vs = title.match(/(.+?)\s+(?:vs\.?|@|at)\s+(.+)/i)
    if (willWin) teamHint = teamKey(willWin[1])
    else if (vs) teamHint = teamKey(vs[1])
    else {
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

function parseLineNumber(raw: string | number | undefined): number | undefined {
  if (raw === undefined) return undefined
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  const m = String(raw).match(/([+-]?\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : undefined
}

interface EspnTeamSide {
  name: string
  short: string
  abbr: string
  homeAway: string | undefined
}

interface EspnGameOdds {
  eventName: string
  shortName: string
  teams: EspnTeamSide[]
  moneylineHome?: number
  moneylineAway?: number
  spreadHomeLine?: number
  spreadAwayLine?: number
  spreadHomeOdds?: number
  spreadAwayOdds?: number
  totalOverOdds?: number
  totalUnderOdds?: number
  totalLine?: number
  provider?: string
}

type EspnEventRaw = {
  name?: string
  shortName?: string
  competitions?: Array<{
    competitors?: Array<{
      team?: { displayName?: string; shortDisplayName?: string; abbreviation?: string }
      homeAway?: string
    }>
    odds?: Array<Record<string, unknown>>
  }>
}

function extractGame(ev: EspnEventRaw): EspnGameOdds | null {
  const comp = ev.competitions?.[0]
  if (!comp) return null
  const teams: EspnTeamSide[] = (comp.competitors ?? []).map((c) => ({
    name: c.team?.displayName ?? '',
    short: c.team?.shortDisplayName ?? '',
    abbr: c.team?.abbreviation ?? '',
    homeAway: c.homeAway,
  }))
  const odds = (comp.odds?.[0] ?? null) as Record<string, unknown> | null
  if (!odds) {
    return { eventName: ev.name ?? '', shortName: ev.shortName ?? '', teams }
  }

  const ml = odds.moneyline as
    | { home?: { close?: { odds?: string } }; away?: { close?: { odds?: string } } }
    | undefined
  const ps = odds.pointSpread as
    | {
        home?: { close?: { line?: string; odds?: string } }
        away?: { close?: { line?: string; odds?: string } }
      }
    | undefined
  const tot = odds.total as
    | {
        over?: { close?: { line?: string; odds?: string } }
        under?: { close?: { line?: string; odds?: string } }
      }
    | undefined

  const awayMl =
    parseAmerican(ml?.away?.close?.odds) ??
    parseAmerican((odds.awayTeamOdds as { moneyLine?: number } | undefined)?.moneyLine)
  const homeMl =
    parseAmerican(ml?.home?.close?.odds) ??
    parseAmerican((odds.homeTeamOdds as { moneyLine?: number } | undefined)?.moneyLine)

  const provider =
    ((odds.provider as { displayName?: string; name?: string } | undefined)?.displayName ||
      (odds.provider as { name?: string } | undefined)?.name) ??
    'ESPN book'

  return {
    eventName: ev.name ?? '',
    shortName: ev.shortName ?? '',
    teams,
    moneylineHome: homeMl,
    moneylineAway: awayMl,
    spreadHomeLine: parseLineNumber(ps?.home?.close?.line),
    spreadAwayLine: parseLineNumber(ps?.away?.close?.line),
    spreadHomeOdds: parseAmerican(ps?.home?.close?.odds),
    spreadAwayOdds: parseAmerican(ps?.away?.close?.odds),
    totalOverOdds: parseAmerican(tot?.over?.close?.odds),
    totalUnderOdds: parseAmerican(tot?.under?.close?.odds),
    totalLine:
      parseLineNumber(tot?.over?.close?.line) ??
      (typeof odds.overUnder === 'number' ? odds.overUnder : undefined),
    provider,
  }
}

const espnCache = new Map<string, { at: number; games: EspnGameOdds[]; error?: string }>()
const CACHE_MS = 90_000

async function fetchEspnLeague(
  league: Exclude<SportsLeague, 'unknown'>,
  signal?: AbortSignal,
): Promise<{ games: EspnGameOdds[]; error?: string }> {
  const path = ESPN_PATHS[league]
  if (!path) return { games: [] }

  const cached = espnCache.get(league)
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return { games: cached.games, error: cached.error }
  }

  try {
    const url = `/api/espn/apis/site/v2/sports/${path}/scoreboard`
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    if (!res.ok) {
      const error = `ESPN ${league} HTTP ${res.status}`
      espnCache.set(league, { at: Date.now(), games: [], error })
      return { games: [], error }
    }
    const data = (await res.json()) as { events?: EspnEventRaw[] }
    const games = (data.events ?? [])
      .map((ev) => extractGame(ev))
      .filter((g): g is EspnGameOdds => Boolean(g))
    espnCache.set(league, { at: Date.now(), games })
    return { games }
  } catch (e) {
    const error = e instanceof Error ? e.message : `ESPN ${league} fetch failed`
    espnCache.set(league, { at: Date.now(), games: [], error })
    return { games: [], error }
  }
}

/** Prefetch ESPN scoreboards for leagues present in the universe. */
export async function prefetchEspnUniverse(
  parses: SportsMarketParse[],
  signal?: AbortSignal,
): Promise<{ byLeague: Map<string, EspnGameOdds[]>; errors: string[] }> {
  const byLeague = new Map<string, EspnGameOdds[]>()
  const errors: string[] = []
  const leagues = new Set<Exclude<SportsLeague, 'unknown'>>()

  for (const p of parses) {
    if (p.isSports && p.league !== 'unknown') leagues.add(p.league)
  }
  if (parses.some((p) => p.isSports)) {
    leagues.add('mlb')
    leagues.add('ncaaf')
    leagues.add('nfl')
    leagues.add('nba')
  }

  await Promise.all(
    [...leagues].map(async (league) => {
      const { games, error } = await fetchEspnLeague(league, signal)
      byLeague.set(league, games)
      if (error) errors.push(error)
    }),
  )
  return { byLeague, errors }
}

function findMatchingGame(
  games: EspnGameOdds[],
  parsed: SportsMarketParse,
): EspnGameOdds | null {
  const scored = games.map((g) => {
    let score = 0
    for (const t of g.teams) {
      if (
        teamsMatch(parsed.teamHint, t.name) ||
        teamsMatch(parsed.teamHint, t.short) ||
        (parsed.teamHint && t.abbr.toLowerCase() === parsed.teamHint.toLowerCase())
      ) {
        score += 3
      }
      if (
        teamsMatch(parsed.opponentHint, t.name) ||
        teamsMatch(parsed.opponentHint, t.short) ||
        (parsed.opponentHint && t.abbr.toLowerCase() === parsed.opponentHint.toLowerCase())
      ) {
        score += 2
      }
    }
    const blob = normalizeTeam(`${g.eventName} ${g.shortName}`)
    if (parsed.teamHint && blob.includes(normalizeTeam(parsed.teamHint))) score += 1
    return { g, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0] && scored[0].score >= 2 ? scored[0].g : null
}

function preferAway(game: EspnGameOdds, teamHint?: string): boolean {
  const away = game.teams.find((t) => t.homeAway === 'away')
  const home = game.teams.find((t) => t.homeAway === 'home')
  const awayHit =
    teamsMatch(teamHint, away?.name ?? '') ||
    teamsMatch(teamHint, away?.short ?? '') ||
    (teamHint && away?.abbr.toLowerCase() === teamHint.toLowerCase())
  const homeHit =
    teamsMatch(teamHint, home?.name ?? '') ||
    teamsMatch(teamHint, home?.short ?? '') ||
    (teamHint && home?.abbr.toLowerCase() === teamHint.toLowerCase())
  return Boolean(awayHit && !homeHit)
}

function matchAgainstGames(
  parsed: SportsMarketParse,
  games: EspnGameOdds[],
): SportsFairEstimate | null {
  if (!games.length) return null
  const game = findMatchingGame(games, parsed)
  if (!game) return null

  const away = game.teams.find((t) => t.homeAway === 'away')
  const home = game.teams.find((t) => t.homeAway === 'home')
  const awaySide = preferAway(game, parsed.teamHint)
  const sideName = awaySide ? away?.name ?? 'away' : home?.name ?? 'home'
  const provider = game.provider ?? 'ESPN'

  if (parsed.kind === 'total' && parsed.totalSide) {
    if (
      parsed.totalLine !== undefined &&
      game.totalLine !== undefined &&
      Math.abs(parsed.totalLine - game.totalLine) > 1.5
    ) {
      return null
    }
    const am = parsed.totalSide === 'over' ? game.totalOverOdds : game.totalUnderOdds
    if (typeof am !== 'number') return null
    const fairProb = clamp(americanToProb(am), 0.02, 0.98)
    return {
      fairProb,
      bookCount: 1,
      source: 'espn',
      marketType: 'totals',
      detail: `ESPN ${provider} ${parsed.totalSide} ${game.totalLine ?? parsed.totalLine ?? ''}: ${(fairProb * 100).toFixed(0)}% (${game.shortName || game.eventName})`,
    }
  }

  if (parsed.kind === 'spread') {
    const line = awaySide ? game.spreadAwayLine : game.spreadHomeLine
    const am = awaySide ? game.spreadAwayOdds : game.spreadHomeOdds
    if (
      parsed.spreadLine !== undefined &&
      line !== undefined &&
      Math.abs(parsed.spreadLine - line) > 1.0 &&
      Math.abs(Math.abs(parsed.spreadLine) - Math.abs(line)) > 1.0
    ) {
      return null
    }
    if (typeof am !== 'number') return null
    const fairProb = clamp(americanToProb(am), 0.02, 0.98)
    return {
      fairProb,
      bookCount: 1,
      source: 'espn',
      marketType: 'spreads',
      detail: `ESPN ${provider} spread ${sideName} ${line ?? parsed.spreadLine ?? ''}: ${(fairProb * 100).toFixed(0)}% (${game.shortName || game.eventName})`,
    }
  }

  const am = awaySide ? game.moneylineAway : game.moneylineHome
  if (typeof am !== 'number') return null
  const fairProb = clamp(americanToProb(am), 0.02, 0.98)
  return {
    fairProb,
    bookCount: 1,
    source: 'espn',
    marketType: 'h2h',
    detail: `ESPN ${provider} ML ${sideName}: ${(fairProb * 100).toFixed(0)}% (${game.shortName || game.eventName})`,
  }
}

export function matchEspnFair(
  parsed: SportsMarketParse,
  byLeague: Map<string, EspnGameOdds[]>,
): SportsFairEstimate | null {
  if (!parsed.isSports) return null
  if (parsed.league !== 'unknown') {
    const hit = matchAgainstGames(parsed, byLeague.get(parsed.league) ?? [])
    if (hit) return hit
  }
  for (const games of byLeague.values()) {
    const hit = matchAgainstGames(parsed, games)
    if (hit) return hit
  }
  return null
}
