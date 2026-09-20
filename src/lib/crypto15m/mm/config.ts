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
  /** Mid move (cents) that forces an immediate requote. */
  midMoveRequoteCents: number
  /** Avellaneda-lite: cents to skew quotes per unit of inventory. */
  inventorySkewCentsPerUnit: number
  /** Extra half-spread cents while spot guard is in "widen" mode. */
  guardWidenCents: number
  /** After a hard cancel, pause quoting this many ms. */
  guardCancelMs: number
  /** Base random fill probability per tick (before toxicity). */
  baseFillProb: number
  /** Extra fill bias when spot moved against your resting quote. */
  toxicityBias: number
  /** Starting paper cash ($). */
  startingCash: number
}

export const DEFAULT_PAPER_MM_CONFIG: PaperMmConfig = {
  halfSpreadCents: 2,
  quoteSize: 5,
  maxInventory: 25,
  spotMovePct: 0.12,
  spotMoveDollars: 40,
  spotWindowSec: 8,
  quoteRefreshMs: 1500,
  spotPollMs: 1000,
  midMoveRequoteCents: 1,
  inventorySkewCentsPerUnit: 0.15,
  guardWidenCents: 4,
  guardCancelMs: 4000,
  baseFillProb: 0.04,
  toxicityBias: 0.18,
  startingCash: 100,
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
    midMoveRequoteCents: clamp(c.midMoveRequoteCents, 0.25, 10),
    inventorySkewCentsPerUnit: clamp(c.inventorySkewCentsPerUnit, 0, 2),
    guardWidenCents: clamp(c.guardWidenCents, 0, 30),
    guardCancelMs: Math.round(clamp(c.guardCancelMs, 0, 60_000)),
    baseFillProb: clamp(c.baseFillProb, 0, 0.5),
    toxicityBias: clamp(c.toxicityBias, 0, 0.8),
    startingCash: clamp(c.startingCash, 10, 10_000),
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}
