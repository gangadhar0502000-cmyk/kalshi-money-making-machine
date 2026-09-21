/** Default knobs for the paper 15m market maker. Paper only — no live orders. */

export interface PaperMmConfig {
  /** Half-spread around mid, in cents (e.g. 2 → bid mid-2¢, ask mid+2¢). */
  halfSpreadCents: number
  /** Contracts per quote side. */
  quoteSize: number
  /** Max |inventory| in YES contracts before that side is suppressed. */
  maxInventory: number
  /** Spot move % threshold within the lookback window (e.g. 0.15 = 0.15%). */
  spotMovePct: number
  /** Spot move $ threshold within the lookback window. */
  spotMoveDollars: number
  /** Lookback window Z for spot guard (seconds). */
  spotWindowSec: number
  /** How often to re-quote when idle (ms). */
  quoteRefreshMs: number
  /** How often to poll free public spot (ms). */
  spotPollMs: number
  /** How often to poll read-only L2 orderbook via local proxy (ms). */
  bookPollMs: number
  /** Prefer real L2 book fills when proxy is up (default ON). */
  useLiveBook: boolean
  /** Minimum ms between any two paper fills (kills money-printer round-trips). */
  fillCooldownMs: number
  /** Mid move (cents) that forces an immediate requote. */
  midMoveRequoteCents: number
  /** Avellaneda-lite: cents to skew quotes per unit of inventory. */
  inventorySkewCentsPerUnit: number
  /** Extra half-spread cents while spot guard is in "widen" mode. */
  guardWidenCents: number
  /** After a hard cancel, pause quoting this many ms. */
  guardCancelMs: number
  /** Base random fill probability per tick (before toxicity). Soft-sim fallback only. */
  baseFillProb: number
  /** Extra fill bias when spot moved against your resting quote. */
  toxicityBias: number
  /**
   * Probability of filling when mid crosses your quote (void/reject otherwise).
   * Soft-sim fallback only — live book uses depth/mid-walk instead.
   */
  midCrossFillProb: number
  /** Subtract fees on fills (maker $0 on 15m; taker uses Kalshi formula). */
  applyFees: boolean
  /** Realize inventory at 0/1 when the market closes / settles. */
  settleOnClose: boolean
  /**
   * Strict realism (default ON): harsh fill rates, fees, settlement risk.
   * Loose mode is for debugging only — not a live edge claim.
   */
  strictRealism: boolean
  /** Starting paper cash ($). */
  startingCash: number
  /**
   * Pull YES bid / refuse buy_yes when mid is below this (dollars 0–1).
   * Stops toxic accumulation when YES is nearly worthless.
   */
  toxicMidLow: number
  /**
   * Pull YES ask / refuse sell_yes when mid is above this (dollars 0–1).
   */
  toxicMidHigh: number
  /** Auto-roll to next open 15m for same underlying after close/settle. */
  autoRoll: boolean
  /**
   * Center quotes on spot/strike fair value (default ON) instead of raw mid.
   * Mid-centered quoting is structurally −EV after fees/toxicity — research toggle.
   */
  fvQuoting: boolean
  /**
   * Minimum edge vs mid (cents) to activate a side when fvQuoting.
   * Bid ON only if (FV − mid) ≥ minEdge; ask ON only if (mid − FV) ≥ minEdge.
   * When |FV − mid| < minEdge both sides OFF.
   */
  minEdgeCents: number
  /**
   * Annualized log-vol for the normal distance-to-strike FV model (e.g. 0.70 = 70%).
   * Free research prior — not implied vol from a paid feed.
   */
  annualVol: number
}

/** Harsh defaults — live book fills preferred; soft random fills rare as fallback. */
export const STRICT_PAPER_MM_CONFIG: PaperMmConfig = {
  halfSpreadCents: 2,
  quoteSize: 1,
  maxInventory: 10,
  spotMovePct: 0.12,
  spotMoveDollars: 40,
  spotWindowSec: 8,
  quoteRefreshMs: 1500,
  spotPollMs: 1000,
  bookPollMs: 750,
  useLiveBook: true,
  fillCooldownMs: 5000,
  midMoveRequoteCents: 1,
  inventorySkewCentsPerUnit: 0.15,
  guardWidenCents: 4,
  guardCancelMs: 4000,
  baseFillProb: 0.004,
  toxicityBias: 0.18,
  midCrossFillProb: 0.2,
  applyFees: true,
  settleOnClose: true,
  strictRealism: true,
  startingCash: 100,
  toxicMidLow: 0.05,
  toxicMidHigh: 0.95,
  autoRoll: true,
  fvQuoting: true,
  minEdgeCents: 2,
  annualVol: 0.7,
}

/** Soft debug presets — easier fills; do not treat green P&L as live edge. */
export const LOOSE_PAPER_MM_CONFIG: PaperMmConfig = {
  ...STRICT_PAPER_MM_CONFIG,
  baseFillProb: 0.04,
  midCrossFillProb: 1,
  applyFees: false,
  settleOnClose: false,
  strictRealism: false,
  toxicityBias: 0.1,
  useLiveBook: true,
  fillCooldownMs: 5000,
}

/** @deprecated Prefer STRICT_PAPER_MM_CONFIG — kept as alias for imports. */
export const DEFAULT_PAPER_MM_CONFIG: PaperMmConfig = { ...STRICT_PAPER_MM_CONFIG }

export function presetsForMode(strict: boolean): Partial<PaperMmConfig> {
  const src = strict ? STRICT_PAPER_MM_CONFIG : LOOSE_PAPER_MM_CONFIG
  return {
    strictRealism: strict,
    baseFillProb: src.baseFillProb,
    midCrossFillProb: src.midCrossFillProb,
    applyFees: src.applyFees,
    settleOnClose: src.settleOnClose,
    toxicityBias: src.toxicityBias,
  }
}

export function clampConfig(partial: Partial<PaperMmConfig>): PaperMmConfig {
  const c = { ...DEFAULT_PAPER_MM_CONFIG, ...partial }
  return {
    halfSpreadCents: clamp(c.halfSpreadCents, 0.5, 20),
    quoteSize: Math.round(clamp(c.quoteSize, 1, 100)),
    maxInventory: Math.round(clamp(c.maxInventory, 1, 500)),
    spotMovePct: clamp(c.spotMovePct, 0.01, 5),
    spotMoveDollars: clamp(c.spotMoveDollars, 1, 5000),
    spotWindowSec: clamp(c.spotWindowSec, 1, 120),
    quoteRefreshMs: Math.round(clamp(c.quoteRefreshMs, 200, 30_000)),
    spotPollMs: Math.round(clamp(c.spotPollMs, 500, 10_000)),
    bookPollMs: Math.round(clamp(c.bookPollMs, 300, 10_000)),
    useLiveBook: Boolean(c.useLiveBook),
    fillCooldownMs: Math.round(clamp(c.fillCooldownMs, 0, 60_000)),
    midMoveRequoteCents: clamp(c.midMoveRequoteCents, 0.25, 10),
    inventorySkewCentsPerUnit: clamp(c.inventorySkewCentsPerUnit, 0, 2),
    guardWidenCents: clamp(c.guardWidenCents, 0, 30),
    guardCancelMs: Math.round(clamp(c.guardCancelMs, 0, 60_000)),
    baseFillProb: clamp(c.baseFillProb, 0, 0.5),
    toxicityBias: clamp(c.toxicityBias, 0, 0.8),
    midCrossFillProb: clamp(c.midCrossFillProb, 0, 1),
    applyFees: Boolean(c.applyFees),
    settleOnClose: Boolean(c.settleOnClose),
    strictRealism: Boolean(c.strictRealism),
    startingCash: clamp(c.startingCash, 10, 10_000),
    toxicMidLow: clamp(c.toxicMidLow, 0.01, 0.45),
    toxicMidHigh: clamp(c.toxicMidHigh, 0.55, 0.99),
    autoRoll: Boolean(c.autoRoll),
    fvQuoting: Boolean(c.fvQuoting),
    minEdgeCents: clamp(c.minEdgeCents, 0, 20),
    annualVol: clamp(c.annualVol, 0.05, 3),
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}
