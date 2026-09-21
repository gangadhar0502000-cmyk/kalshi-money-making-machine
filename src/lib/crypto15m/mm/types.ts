import type { PaperMmConfig } from './config'

export type MmFillSide = 'buy_yes' | 'sell_yes'
export type MmGuardAction = 'cancel' | 'widen' | 'skew'

export interface MmQuote {
  yesBid: number
  yesAsk: number
  size: number
  active: boolean
  /** Bid side enabled (false when max long, extreme-low mid, or no edge). */
  bidActive: boolean
  /** Ask side enabled (false when max short, extreme-high mid, or no edge). */
  askActive: boolean
  /** Inventory skew applied (cents, positive = shift down = favor selling). */
  skewCents: number
  halfSpreadCents: number
  /** Quote center mode for this rebuild. */
  centerMode: 'fv' | 'mid'
  /** Why bid is off (or 'ok'). */
  bidReason: string
  /** Why ask is off (or 'ok'). */
  askReason: string
}

export interface MmFill {
  id: string
  t: number
  side: MmFillSide
  /** YES price in dollars 0–1 (never cents). */
  price: number
  size: number
  /** Mid in dollars 0–1 at fill. */
  midAtFill: number
  toxic: boolean
  reason:
    | 'mid_cross'
    | 'random_toxic'
    | 'random'
    | 'settlement'
    | 'book_depth'
    | 'mid_walk'
    | 'taker_cross'
  /** Kalshi-style fee deducted on this fill ($). Maker 15m = $0; taker uses formula. */
  feeDollars: number
  /** True when sim crossed the spread (taker). */
  taker: boolean
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
  /** ISO close_time of the active market (for UI). */
  marketCloseTime: string | null
  asset: string | null
  config: PaperMmConfig
  quote: MmQuote | null
  /** Net YES inventory (positive = long YES). */
  inventory: number
  cash: number
  /** Mid YES in dollars 0–1. */
  midYes: number
  spotPrice: number | null
  spotSource: string | null
  /** Realized from round-trips / closed legs (spread capture), after fees. Dollars. */
  realizedSpreadPnl: number
  /** Cumulative fees paid this session (dollars). */
  feesPaid: number
  /** Mark-to-mid inventory P&L (unrealized), dollars: inventory * (mid - avgEntry). */
  unrealizedInventoryPnl: number
  /** Avg entry of open inventory (YES price dollars 0–1). */
  avgEntry: number | null
  fillCount: number
  cancelCount: number
  /** Mid-cross attempts that voided / rejected (no fill) — soft-sim only. */
  midCrossRejectCount: number
  guardActiveUntil: number
  guardMode: MmGuardAction | null
  lastTickAt: number | null
  /** Epoch ms when current session started (Start / after Reset). */
  sessionStartedAt: number | null
  /** True after inventory was forced to settle at 0/1. */
  settled: boolean
  message: string
  /** True when local read-only proxy + orderbook polling is healthy. */
  liveBook: boolean
  liveBookAuthenticated: boolean
  bookBestBid: number | null
  bookBestAsk: number | null
  unitsWarning: string | null
  /**
   * True when |Δ Total P&L| > $1 in under 2s — quoting frozen.
   * Indicates a money-printer fill bug; user must Reset.
   */
  moneyPrinterBug: boolean
  /** Spot/strike FV P(YES) dollars 0–1, or null if unavailable. */
  fairValue: number | null
  /** (FV − mid) in cents; null if no FV. */
  edgeVsMidCents: number | null
  /** Active market floorStrike (reference), if any. */
  floorStrike: number | null
  /** Minutes remaining used for FV (from market). */
  minutesRemaining: number | null
  /** Whether this rebuild centered on FV (vs mid fallback). */
  fvCenterActive: boolean
}

export interface MmEngineState {
  snapshot: MmSnapshot
  fills: MmFill[]
  cancels: MmCancelEvent[]
}
