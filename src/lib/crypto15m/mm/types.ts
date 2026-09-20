import type { PaperMmConfig } from './config'

export type MmFillSide = 'buy_yes' | 'sell_yes'
export type MmGuardAction = 'cancel' | 'widen' | 'skew'

export interface MmQuote {
  yesBid: number
  yesAsk: number
  size: number
  active: boolean
  /** Inventory skew applied (cents, positive = shift down = favor selling). */
  skewCents: number
  halfSpreadCents: number
}

export interface MmFill {
  id: string
  t: number
  side: MmFillSide
  price: number
  size: number
  midAtFill: number
  toxic: boolean
  reason: 'mid_cross' | 'random_toxic' | 'random' | 'settlement'
  /** Kalshi-style fee deducted on this fill ($). */
  feeDollars: number
}

export interface MmCancelEvent {
  id: string
  t: number
  action: MmGuardAction
  reason: string
  spotPct: number
  spotDollar: number
  spotPrice: number
}

export interface MmSnapshot {
  running: boolean
  marketTicker: string | null
  asset: string | null
  config: PaperMmConfig
  quote: MmQuote | null
  /** Net YES inventory (positive = long YES). */
  inventory: number
  cash: number
  midYes: number
  spotPrice: number | null
  spotSource: string | null
  /** Realized from round-trips / closed legs (spread capture), after fees. */
  realizedSpreadPnl: number
  /** Cumulative Kalshi-style fees paid this session. */
  feesPaid: number
  /** Mark-to-mid inventory P&L (unrealized). */
  unrealizedInventoryPnl: number
  /** Avg entry of open inventory (YES price). */
  avgEntry: number | null
  fillCount: number
  cancelCount: number
  /** Mid-cross attempts that voided / rejected (no fill). */
  midCrossRejectCount: number
  guardActiveUntil: number
  guardMode: MmGuardAction | null
  lastTickAt: number | null
  /** Epoch ms when current session started (Start / after Reset). */
  sessionStartedAt: number | null
  /** True after inventory was forced to settle at 0/1. */
  settled: boolean
  message: string
}

export interface MmEngineState {
  snapshot: MmSnapshot
  fills: MmFill[]
  cancels: MmCancelEvent[]
}
