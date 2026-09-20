import type { KalshiMarketRaw, Side } from './kalshi'

/** Normalized crypto 15-minute market for the research lab. */
export interface Crypto15mMarket {
  ticker: string
  eventTicker: string
  seriesTicker: string
  asset: string
  title: string
  status: string
  openTime: string | null
  closeTime: string
  yesBid: number
  yesAsk: number
  noBid: number
  noAsk: number
  midYes: number
  spreadCents: number
  last: number
  volume: number
  volume24h: number
  openInterest: number
  yesBidSize: number
  yesAskSize: number
  floorStrike: number | null
  rulesPrimary: string
  kalshiUrl: string
  /** Window length inferred from open→close (minutes). */
  windowMinutes: number
  minutesElapsed: number
  minutesRemaining: number
  /** Estimated fee $ for 1 contract at mid (Kalshi-style ceil formula). */
  feeEstimate1: number
  thinBook: boolean
  raw: KalshiMarketRaw
}

export type RuleId =
  | 'late_fade'
  | 'early_momentum'
  | 'wide_spread_block'
  | 'extreme_late_block'
  | 'thin_book_block'

export type ExperimentAction = 'NO_TRADE' | 'PAPER_YES' | 'PAPER_NO'

export interface RuleHypothesis {
  id: RuleId
  name: string
  /** Explicit hypothesis — not advice. */
  hypothesis: string
  /** True when this rule only vetoes (never suggests a side). */
  isVeto: boolean
}

export interface RuleEvalResult {
  ruleId: RuleId
  action: ExperimentAction
  matched: boolean
  reason: string
}

export interface ExperimentSuggestion {
  marketTicker: string
  ruleId: RuleId
  action: ExperimentAction
  side: Side | null
  entry: number
  midYes: number
  spreadCents: number
  minutesRemaining: number
  reason: string
  hypothesis: string
  feeEstimate1: number
  suggestedAt: string
}

export type JournalOutcome = 'pending' | 'yes' | 'no' | 'void' | 'manual_win' | 'manual_loss'

export interface PaperJournalEntry {
  id: string
  ruleId: RuleId
  marketTicker: string
  title: string
  side: Side
  entry: number
  feeEstimate: number
  minutesRemainingAtEntry: number
  suggestedAt: string
  takenAt: string
  /** When market close_time was expected. */
  closeTime: string
  outcome: JournalOutcome
  resolvedAt?: string
  /** Net P&L after estimated fees (per 1 contract scale × contracts). */
  netAfterFees?: number
  contracts: number
  note?: string
}

export interface RuleStats {
  ruleId: RuleId
  n: number
  wins: number
  losses: number
  pending: number
  winRate: number | null
  netAfterFees: number
}

export interface MidSample {
  t: number
  mid: number
}

export interface FetchCrypto15mResult {
  markets: Crypto15mMarket[]
  source: 'live' | 'demo'
  fetchedAt: string
  error?: string
  seriesTried: string[]
}
