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
  /**
   * U2.13: which primary L2 book to join for queue fills ('yes' | 'no').
   * Complements = same economic outcome, different queues. Default YES.
   */
  quoteBookSide: 'yes' | 'no'
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
  /**
   * Multi-book: max concurrent paper MM markets (default 5).
   * More markets = more shots at the same edge game — not independent lottery wins.
   */
  maxActiveMarkets: number
  /**
   * When true, portfolio scans all open crypto 15m and quotes up to maxActiveMarkets.
   * When false, classic single-ticker paper MM.
   */
  multiBook: boolean
  /**
   * Pull both quote sides when minutesRemaining < this (expiry chaos).
   * Default 0.5 minutes (30s).
   */
  expiryPullMinutes: number
  /**
   * After an adverse (toxic) fill, temporarily pull that side for this many ms.
   */
  toxicFillPullMs: number
  /**
   * Absolute |inventory| at/above which unwind quotes beat the edge gate.
   * Default 1 — any stuck long/short must be able to reduce risk.
   */
  unwindThreshold: number
  /**
   * Park edge mode (except unwind) when |FV−mid| cents exceeds this.
   * Gates absurd edges from near-zero mid vs FV≈1.
   */
  maxSaneEdgeCents: number
  /**
   * After maker clamp to BBO, resting price must still capture ≥ this many cents
   * vs FV (bid: FV−bid; ask: ask−FV). Default 1¢. Opening sides only.
   */
  minCaptureCents: number
  /**
   * Consecutive quote rebuilds where edge sign+threshold must hold before a side
   * turns ON (~3–5s at default quoteRefreshMs). Drop immediately on flip/insanity.
   * Default 3. Set 1 to activate on first qualifying tick.
   */
  edgePersistTicks: number
  /**
   * When |edge| < this band AND inventory flat, both sides may quote.
   * Default 0 = never two-sided from edge mode (strict one-sided when |edge| ≥ minEdge).
   */
  twoSidedEdgeBandCents: number
  /**
   * Extra cents added to minEdge for *opening* (inventory-adding) quotes only.
   * Unwind unchanged. Default 0.
   */
  openingEdgeExtraCents: number
  /**
   * When true, opening min also requires ≥ minEdge + halfSpreadCents.
   */
  openEdgeAddHalfSpread: boolean
  /**
   * Minimum contracts of depth that must be consumed at our touch price
   * between consecutive book polls to count as a book_depth fill.
   * Strict default is high so mild flicker does not print fills.
   */
  minBookDepthConsumed: number
  /**
   * Consecutive polls our quote must sit at/inside touch before book_depth
   * can fire. Raises queue-time cost of getting filled.
   */
  minTouchPolls: number
  /**
   * When false, mid_walk fills are disabled (strict default).
   * Loose/debug may enable for softer research.
   */
  allowMidWalk: boolean
  /**
   * Max paper fills per ticker in any rolling 15-minute window.
   * Strict default 4. Caps persist across sync/rebuild/restore.
   */
  maxFillsPerMarketPer15m: number
  /**
   * Max paper fills per ticker in any rolling 60-second window.
   * Strict default 1. Caps persist across sync/rebuild/restore.
   */
  maxFillsPerMinute: number
  /**
   * When true, multi-book may fill remaining slots with mid-fallback markets
   * (FV unavailable). Strict default false — prefer empty slots over no-FV books.
   */
  fillMidFallback: boolean
  /**
   * S1/S2 opening bar: |FV−mid| cents required to open (default 4).
   * Prefer this over raw minEdgeCents for inventory-adding quotes.
   */
  openMinEdgeCents: number
  /**
   * No S1/S2 opens when minutesRemaining < this; S4 risk-flat closes allowed.
   * Default 2 minutes.
   */
  hardFlatMinutes: number
  /**
   * S3 CLOSE_PROFIT: reducing fill must capture ≥ this many cents vs avgEntry
   * (signed). Default 1.0¢ — blocks −0.88¢/fill churn unwinds unless S4.
   */
  minCloseProfitCents: number
  /**
   * Legacy alias for minCloseProfitCents (churn filter). Kept for persist compat.
   * Strict default 1.0¢ (raised from 0.5¢).
   */
  minChurnCaptureCents: number
  /**
   * S4.1 STUCK_UNWIND: consecutive quote ticks with S3 reduce blocked by
   * minCloseProfit before allowing break-even (≥0¢) reduce. Default 30
   * (~45s at quoteRefreshMs=1500). Never allows voluntary −¢ closes.
   */
  stuckUnwindTicks: number
  /**
   * S4.2 MARK_BLEED: after stuckUnwindTicks, allow lossy reduce when capture
   * ≤ −markBleedCents. Default 5¢. Never opens; S4.1 still preferred at ≥0¢.
   * Escalation latches until inventory flat/flip so scarce maker quotes can rest.
   */
  markBleedCents: number
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
  quoteBookSide: 'yes',
  fillCooldownMs: 20_000,
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
  minEdgeCents: 4,
  annualVol: 0.7,
  maxActiveMarkets: 5,
  multiBook: true,
  expiryPullMinutes: 0.5,
  toxicFillPullMs: 8000,
  unwindThreshold: 1,
  maxSaneEdgeCents: 25,
  minCaptureCents: 1.5,
  edgePersistTicks: 3,
  twoSidedEdgeBandCents: 0,
  openingEdgeExtraCents: 0,
  openEdgeAddHalfSpread: false,
  minBookDepthConsumed: 8,
  minTouchPolls: 4,
  allowMidWalk: false,
  maxFillsPerMarketPer15m: 4,
  maxFillsPerMinute: 1,
  fillMidFallback: false,
  openMinEdgeCents: 4,
  hardFlatMinutes: 2,
  minCloseProfitCents: 1.0,
  minChurnCaptureCents: 1.0,
  stuckUnwindTicks: 30,
  markBleedCents: 5,
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
  minBookDepthConsumed: 1,
  minTouchPolls: 1,
  allowMidWalk: true,
  maxFillsPerMarketPer15m: 60,
  maxFillsPerMinute: 12,
  fillMidFallback: true,
  minCloseProfitCents: 0,
  minChurnCaptureCents: 0,
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
    fillCooldownMs: src.fillCooldownMs,
    minBookDepthConsumed: src.minBookDepthConsumed,
    minTouchPolls: src.minTouchPolls,
    allowMidWalk: src.allowMidWalk,
    maxFillsPerMarketPer15m: src.maxFillsPerMarketPer15m,
    maxFillsPerMinute: src.maxFillsPerMinute,
    fillMidFallback: src.fillMidFallback,
    minChurnCaptureCents: src.minChurnCaptureCents,
    minCloseProfitCents: src.minCloseProfitCents,
    openMinEdgeCents: src.openMinEdgeCents,
    hardFlatMinutes: src.hardFlatMinutes,
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
    quoteBookSide: c.quoteBookSide === 'no' ? 'no' : 'yes',
    fillCooldownMs: Math.round(clamp(c.fillCooldownMs, 0, 120_000)),
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
    maxActiveMarkets: Math.round(clamp(c.maxActiveMarkets, 1, 12)),
    multiBook: Boolean(c.multiBook),
    expiryPullMinutes: clamp(c.expiryPullMinutes, 0, 5),
    toxicFillPullMs: Math.round(clamp(c.toxicFillPullMs, 0, 120_000)),
    unwindThreshold: Math.round(clamp(c.unwindThreshold, 1, 500)),
    maxSaneEdgeCents: clamp(c.maxSaneEdgeCents, 5, 100),
    minCaptureCents: clamp(c.minCaptureCents, 0, 20),
    edgePersistTicks: Math.round(clamp(c.edgePersistTicks, 1, 30)),
    twoSidedEdgeBandCents: clamp(c.twoSidedEdgeBandCents, 0, 20),
    openingEdgeExtraCents: clamp(c.openingEdgeExtraCents, 0, 20),
    openEdgeAddHalfSpread: Boolean(c.openEdgeAddHalfSpread),
    minBookDepthConsumed: Math.round(clamp(c.minBookDepthConsumed, 1, 500)),
    minTouchPolls: Math.round(clamp(c.minTouchPolls, 1, 30)),
    allowMidWalk: Boolean(c.allowMidWalk),
    maxFillsPerMarketPer15m: Math.round(clamp(c.maxFillsPerMarketPer15m, 1, 500)),
    maxFillsPerMinute: Math.round(clamp(c.maxFillsPerMinute, 1, 120)),
    fillMidFallback: Boolean(c.fillMidFallback),
    openMinEdgeCents: clamp(c.openMinEdgeCents, 0, 20),
    hardFlatMinutes: clamp(c.hardFlatMinutes, 0, 10),
    minCloseProfitCents: clamp(c.minCloseProfitCents, 0, 10),
    minChurnCaptureCents: clamp(
      Math.max(c.minChurnCaptureCents, c.minCloseProfitCents ?? 0),
      0,
      10,
    ),
    stuckUnwindTicks: Math.round(clamp(c.stuckUnwindTicks ?? 30, 1, 600)),
    markBleedCents: clamp(c.markBleedCents ?? 5, 0, 50),
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

/**
 * Migrate persisted / older sessions onto current STRICT scarcity defaults.
 * When strictRealism: clamp maxFillsPerMarketPer15m ≤ 4 and maxFillsPerMinute ≤ 1,
 * and ensure minChurnCaptureCents ≥ STRICT default when missing/zero from older saves.
 * Loose mode is left alone.
 */
export function migratePersistedScarcityConfig(
  partial: Partial<PaperMmConfig>,
): Partial<PaperMmConfig> {
  const strict =
    partial.strictRealism !== undefined
      ? Boolean(partial.strictRealism)
      : STRICT_PAPER_MM_CONFIG.strictRealism
  if (!strict) return { ...partial }
  const out: Partial<PaperMmConfig> = { ...partial, strictRealism: true }
  const per15 =
    typeof partial.maxFillsPerMarketPer15m === 'number' &&
    Number.isFinite(partial.maxFillsPerMarketPer15m)
      ? partial.maxFillsPerMarketPer15m
      : STRICT_PAPER_MM_CONFIG.maxFillsPerMarketPer15m
  const perMin =
    typeof partial.maxFillsPerMinute === 'number' && Number.isFinite(partial.maxFillsPerMinute)
      ? partial.maxFillsPerMinute
      : STRICT_PAPER_MM_CONFIG.maxFillsPerMinute
  out.maxFillsPerMarketPer15m = Math.min(
    per15,
    STRICT_PAPER_MM_CONFIG.maxFillsPerMarketPer15m,
  )
  out.maxFillsPerMinute = Math.min(perMin, STRICT_PAPER_MM_CONFIG.maxFillsPerMinute)
  const churnRaw =
    typeof partial.minCloseProfitCents === 'number' &&
    Number.isFinite(partial.minCloseProfitCents)
      ? partial.minCloseProfitCents
      : typeof partial.minChurnCaptureCents === 'number' &&
          Number.isFinite(partial.minChurnCaptureCents)
        ? partial.minChurnCaptureCents
        : STRICT_PAPER_MM_CONFIG.minCloseProfitCents
  // Lift older 0 / 0.5¢ bars up to STRICT 1.0¢ close-profit floor.
  const churn = Math.max(
    churnRaw > 0 ? churnRaw : STRICT_PAPER_MM_CONFIG.minCloseProfitCents,
    STRICT_PAPER_MM_CONFIG.minCloseProfitCents,
  )
  out.minCloseProfitCents = churn
  out.minChurnCaptureCents = churn
  if (partial.openMinEdgeCents == null || !Number.isFinite(partial.openMinEdgeCents)) {
    out.openMinEdgeCents = STRICT_PAPER_MM_CONFIG.openMinEdgeCents
  } else {
    out.openMinEdgeCents = Math.max(
      partial.openMinEdgeCents,
      STRICT_PAPER_MM_CONFIG.openMinEdgeCents,
    )
  }
  if (partial.hardFlatMinutes == null || !Number.isFinite(partial.hardFlatMinutes)) {
    out.hardFlatMinutes = STRICT_PAPER_MM_CONFIG.hardFlatMinutes
  }
  // Lift maker capture floor for older 1¢ saves.
  const cap =
    typeof partial.minCaptureCents === 'number' && Number.isFinite(partial.minCaptureCents)
      ? partial.minCaptureCents
      : STRICT_PAPER_MM_CONFIG.minCaptureCents
  out.minCaptureCents = Math.max(cap, STRICT_PAPER_MM_CONFIG.minCaptureCents)
  // Lift opening edge bar for older saves that still carry 2.5¢.
  const minEdge =
    typeof partial.minEdgeCents === 'number' && Number.isFinite(partial.minEdgeCents)
      ? partial.minEdgeCents
      : STRICT_PAPER_MM_CONFIG.minEdgeCents
  out.minEdgeCents = Math.max(
    minEdge,
    STRICT_PAPER_MM_CONFIG.minEdgeCents,
    out.openMinEdgeCents ?? STRICT_PAPER_MM_CONFIG.openMinEdgeCents,
  )
  // Ensure new decision knobs exist on older sessions.
  if (partial.minCaptureCents == null || !Number.isFinite(partial.minCaptureCents)) {
    out.minCaptureCents = STRICT_PAPER_MM_CONFIG.minCaptureCents
  }
  if (partial.edgePersistTicks == null || !Number.isFinite(partial.edgePersistTicks)) {
    out.edgePersistTicks = STRICT_PAPER_MM_CONFIG.edgePersistTicks
  }
  if (partial.twoSidedEdgeBandCents == null || !Number.isFinite(partial.twoSidedEdgeBandCents)) {
    out.twoSidedEdgeBandCents = STRICT_PAPER_MM_CONFIG.twoSidedEdgeBandCents
  }
  if (partial.openingEdgeExtraCents == null || !Number.isFinite(partial.openingEdgeExtraCents)) {
    out.openingEdgeExtraCents = STRICT_PAPER_MM_CONFIG.openingEdgeExtraCents
  }
  if (partial.openEdgeAddHalfSpread == null) {
    out.openEdgeAddHalfSpread = STRICT_PAPER_MM_CONFIG.openEdgeAddHalfSpread
  }
  if (partial.stuckUnwindTicks == null || !Number.isFinite(partial.stuckUnwindTicks)) {
    out.stuckUnwindTicks = STRICT_PAPER_MM_CONFIG.stuckUnwindTicks
  }
  if (partial.markBleedCents == null || !Number.isFinite(partial.markBleedCents)) {
    out.markBleedCents = STRICT_PAPER_MM_CONFIG.markBleedCents
  }
  return out
}
