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
  /** Optional legacy scenario id (journal only; U3.0 does not drive quotes). */
  bidScenario?: string
  /** Optional legacy scenario id (journal only). */
  askScenario?: string
  /** Optional legacy active scenario (unused while quoting paused). */
  activeScenario?: string
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
  /** Market ticker at fill (for per-ticker caps / restore). */
  ticker?: string | null
  /**
   * Realized $ captured on this fill when reducing inventory (0 for opens / adds).
   * Used for last-15m realized-delta / avg ¢/fill diagnostics.
   */
  captureDollars?: number
  /**
   * Plain house tag / legacy digest id at fill time (journal only — never drives quotes).
   */
  scenarioId?: string
  /** Remaining size-ahead queue after fill attribution (book_depth). */
  queueAhead?: number
  /** Explicit fill size for journal/telemetry (same as size). */
  fillSize?: number
  /** U3.2 tape: inventory before this fill. */
  inventoryBefore?: number
  /** U3.2 tape: inventory after this fill. */
  inventoryAfter?: number
  /** U3.2 tape: FV at fill (telemetry). */
  fairValue?: number | null
  /** U3.2 tape: (FV−mid)¢ at fill (telemetry). */
  edgeCents?: number | null
  /** U3.2 tape: quote yesBid at fill. */
  yesBid?: number | null
  /** U3.2 tape: quote yesAsk at fill. */
  yesAsk?: number | null
  /** U3.2 tape: center mode (`mid` under house rules). */
  centerMode?: 'fv' | 'mid' | null
  /** U3.2 tape: cash after fill. */
  cashAfter?: number | null
  /** U3.2 tape: spot at fill. */
  spot?: number | null
  /** U3.2 tape: strike / floorStrike at fill. */
  strike?: number | null
  /** U3.2 tape: minutes remaining at fill. */
  minutesLeft?: number | null
  /** U3.2 tape: asset at fill. */
  asset?: string | null
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
  /** U2.13: primary L2 side currently used for queue fills. */
  quoteBookSide: 'yes' | 'no'
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
  /** @deprecated Prefer harshFillsPerHour — may include legacy session fills. */
  fillsPerHour: number
  /** Fills in the last rolling 60s (this market / ticker cap window). */
  fillsLastMinute: number
  /** Fills in the last rolling 15m (this market / ticker cap window). */
  fillsLast15m: number
  /**
   * Harsh-policy-era fills/hour only (excludes legacy persisted fills before
   * the migration/reset marker). Annualized with a ≥15m clock floor so tiny
   * windows do not inflate into false hundreds/hr.
   */
  harshFillsPerHour: number
  /** Harsh-era fills in the rolling 15m window (this ticker). */
  harshFillsLast15m: number
  /** Epoch ms when harsh fill-cap policy became active for this session. */
  harshPolicyEpochMs: number
  /**
   * True when rolling 15m harsh fills exceed a realistic soft threshold under
   * strictRealism (not short-session extrapolated /hr).
   */
  fillRateUnrealistic: boolean
  /** Sum of captureDollars on fills in the last rolling 15m (this book). */
  realizedDeltaLast15m: number
  /** Average captured cents per fill over last 15m (0 if no fills). */
  avgCaptureCentsPerFillLast15m: number
  /** Hard portfolio 15m fill cap currently applied (null if single-book / unset). */
  portfolioFillCap15m: number | null
  /**
   * Consecutive S3 profit-bar blocks for current inventory sign (stuck counter).
   * 0 when flat or sign flipped. Measurement only — not a trading knob.
   * (Distinct from config.stuckUnwindTicks, which is the escalation threshold.)
   */
  stuckTicks: number
}

export interface MmEngineState {
  snapshot: MmSnapshot
  fills: MmFill[]
  cancels: MmCancelEvent[]
}
