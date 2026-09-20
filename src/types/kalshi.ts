/** Raw fields we care about from Kalshi GET /markets (dollar strings). */
export interface KalshiMarketRaw {
  ticker: string
  event_ticker: string
  title?: string
  subtitle?: string
  yes_sub_title?: string
  no_sub_title?: string
  status: string
  category?: string
  close_time: string
  open_time?: string
  expected_expiration_time?: string | null
  latest_expiration_time?: string
  yes_bid_dollars?: string
  yes_ask_dollars?: string
  no_bid_dollars?: string
  no_ask_dollars?: string
  last_price_dollars?: string
  volume_fp?: string
  volume_24h_fp?: string
  open_interest_fp?: string
  yes_bid_size_fp?: string
  yes_ask_size_fp?: string
  floor_strike?: number
  result?: string
  rules_primary?: string
  /** Legacy / demo-friendly aliases */
  volume?: number
  yes_bid?: number
  yes_ask?: number
  last_price?: number
  /** Optional demo-only fair override used when external APIs are offline */
  demo_fair_prob?: number
  demo_fair_source?: string
}

export interface KalshiMarketsResponse {
  markets: KalshiMarketRaw[]
  cursor?: string
}

export type Side = 'YES' | 'NO'

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRANKED'

export type FairSourceKind =
  | 'noaa'
  | 'espn'
  | 'polymarket'
  | 'cross_market'
  | 'structure'
  | 'demo_external'
  | 'weak_prior'

export interface FairSource {
  kind: FairSourceKind
  label: string
  detail: string
  /** Weight 0–1 used when blending sources */
  weight: number
}

/** TRADE = external fair + liquidity; RESEARCH = structure-only / weak */
export type OpportunityKind = 'TRADE' | 'RESEARCH'

export interface ScoredOpportunity {
  ticker: string
  eventTicker: string
  title: string
  category: string
  status: string
  yesBid: number
  yesAsk: number
  noBid: number
  noAsk: number
  midYes: number
  spreadCents: number
  volume: number
  volume24h: number
  openInterest: number
  closeTime: string
  hoursToExpiry: number
  /** Liquidity score 0–100 (tradeability) */
  liquidityScore: number
  /** Estimated fair P(YES) from external + structure signals */
  fairProb: number
  /** fairProb − midYes, in percentage points (e.g. 5.2 = +5.2pp) */
  edgePct: number
  /** Absolute edge used for ranking / filters */
  absEdgePct: number
  /**
   * Rank score for sorting only — NOT edge.
   * Never display as the hero "edge" metric.
   */
  rankScore: number
  /** @deprecated alias of rankScore for older UI bits */
  edgeScore: number
  confidence: ConfidenceLevel
  fairSources: FairSource[]
  suggestedSide: Side
  suggestedStakePct: number
  rationale: string[]
  kalshiUrl: string
  passedLiquidityGate: boolean
  liquidityFailReasons: string[]
  /** True when NOAA / ESPN / Polymarket / demo external contributed to fair */
  hasExternalFair: boolean
  /** TRADE only when liquid + external fair; else RESEARCH (structure-only) */
  opportunityKind: OpportunityKind
  /** True when sports/climate market lacked external fair (blocked in strict) */
  blockedMissingExternal: boolean
  scoreBreakdown: {
    liquidity: number
    spread: number
    fairConfidence: number
    time: number
    volumeMomentum: number
  }
}

export type DataSource = 'live' | 'demo'

export interface FetchMarketsResult {
  markets: KalshiMarketRaw[]
  source: DataSource
  fetchedAt: string
  error?: string
}

export interface PaperTrade {
  id: string
  ticker: string
  title: string
  side: Side
  contracts: number
  entryPrice: number
  stakeDollars: number
  openedAt: string
  closedAt?: string
  exitPrice?: number
  status: 'open' | 'closed'
  note?: string
}

export interface PaperPortfolio {
  startingCash: number
  cash: number
  trades: PaperTrade[]
  kellyFraction: number
  flatStakePct: number
  stakeMode: 'kelly' | 'flat'
  updatedAt: string
}

export interface FilterState {
  category: string
  minLiquidity: number
  minEdgePct: number
  midMin: number
  midMax: number
  search: string
  /** When true (default), hide markets that fail the hard liquidity gate */
  hideIlliquid: boolean
  /**
   * Strict mode (default ON): only show TRADE opportunities —
   * passed liquidity + external fair value + |edge| ≥ threshold.
   * Structure-only vibes are hidden.
   */
  strictMode: boolean
}

export interface ScoreMeta {
  /** True when free ESPN/Polymarket/NOAA fetches hit hard failures (e.g. rate limit) */
  freeFetchFailed: boolean
  freeFetchErrors: string[]
  sportsMarketsSeen: number
  sportsBlockedNoExternal: number
  structureOnlyCount: number
  tradeableCount: number
  espnMatchCount: number
  polymarketMatchCount: number
}
