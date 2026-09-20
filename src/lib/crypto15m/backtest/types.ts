import type { RuleId } from '../../../types/crypto15m'
import type { Side } from '../../../types/kalshi'

/** One reconstructed minute snapshot inside a 15m window. */
export interface BacktestSnapshot {
  /** Epoch ms at candle end. */
  t: number
  yesBid: number
  yesAsk: number
  midYes: number
  spreadCents: number
  last: number
  volume: number
  yesBidSize: number
  yesAskSize: number
  minutesElapsed: number
  minutesRemaining: number
  windowMinutes: number
}

export interface HistoricalMarketWindow {
  ticker: string
  eventTicker: string
  seriesTicker: string
  title: string
  /** Settlement: yes | no */
  result: 'yes' | 'no'
  openTime: string
  closeTime: string
  snapshots: BacktestSnapshot[]
  /** live_api | bundled_live_snapshot | demo_synthetic */
  dataKind: 'live_api' | 'bundled_live_snapshot' | 'demo_synthetic'
}

export interface BacktestTrade {
  ticker: string
  title: string
  seriesTicker: string
  ruleId: RuleId
  side: Side
  entry: number
  feeDollars: number
  contracts: number
  minutesRemainingAtEntry: number
  minutesElapsedAtEntry: number
  entryAt: string
  settlement: 'yes' | 'no'
  won: boolean
  netAfterFees: number
  reason: string
  dataKind: HistoricalMarketWindow['dataKind']
}

export interface BacktestRuleAgg {
  ruleId: RuleId
  name: string
  isVeto: boolean
  /** Signal trades taken (n≥0). Vetoes report how often they fired. */
  n: number
  wins: number
  losses: number
  winRate: number | null
  netDollars: number
  maxDrawdown: number
  profitFactor: number | null
  /** Times this veto matched (veto rules only). */
  vetoFires: number
}

export interface BacktestResult {
  ranAt: string
  /** Honest label for UI. */
  dataSourceLabel: string
  dataMode: 'live_history' | 'bundled_live_snapshot' | 'demo_synthetic' | 'hybrid'
  marketsTested: number
  windowsNoTrade: number
  windowsWithTrade: number
  trades: BacktestTrade[]
  perRule: BacktestRuleAgg[]
  notes: string[]
  progressDetail?: string
}

export type BacktestProgress = {
  phase: string
  current: number
  total: number
  detail?: string
}

export type ProgressFn = (p: BacktestProgress) => void
