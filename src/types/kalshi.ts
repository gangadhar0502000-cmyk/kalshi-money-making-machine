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
  rules_primary?: string
  /** Legacy / demo-friendly aliases */
  volume?: number
  yes_bid?: number
  yes_ask?: number
  last_price?: number
}

export interface KalshiMarketsResponse {
  markets: KalshiMarketRaw[]
  cursor?: string
}

export type Side = 'YES' | 'NO'

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
  edgeScore: number
  suggestedSide: Side
  suggestedStakePct: number
  rationale: string[]
  kalshiUrl: string
  scoreBreakdown: {
    liquidity: number
    spread: number
    distanceFromFair: number
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
  /** Mark-to-market mid at entry for reference */
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
  minVolume: number
  minScore: number
  search: string
}
