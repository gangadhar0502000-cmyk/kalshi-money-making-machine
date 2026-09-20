/**
 * =============================================================================
 * CRYPTO 15m RULE EXPERIMENT CONFIG — single file of knobs
 * =============================================================================
 * These are HYPOTHESES for paper testing, not trading advice.
 * Default stance: most situations → NO TRADE.
 * Promote a rule only after it survives a large paper sample (see README).
 * =============================================================================
 */

/** Late-window fade: in the last N minutes, if mid moved sharply, fade. */
export const LATE_FADE = {
  enabled: true,
  /** Only consider when minutes remaining ≤ this. */
  lastMinutes: 4,
  /** |Δ mid| in probability points over lookback required to trigger. */
  minMovePp: 12,
  /** Mid history lookback window (ms). */
  lookbackMs: 90_000,
  /**
   * Fade direction: if mid rose ≥ minMovePp → PAPER_NO; if fell → PAPER_YES.
   * Hypothesis: late sharp moves overshoot into settlement noise.
   */
} as const

/** Early momentum: first N minutes, continue the move. */
export const EARLY_MOMENTUM = {
  enabled: true,
  /** Only when minutes elapsed ≤ this (from open). */
  firstMinutes: 3,
  minMovePp: 8,
  lookbackMs: 60_000,
} as const

/** Hard veto: no trade if YES spread wider than X cents. */
export const WIDE_SPREAD_BLOCK = {
  enabled: true,
  maxSpreadCents: 4,
} as const

/** Hard veto: no trade if little time left and mid already extreme. */
export const EXTREME_LATE_BLOCK = {
  enabled: true,
  minutesRemainingMax: 2,
  /** Mid outside [extremeLow, extremeHigh] → NO TRADE. */
  extremeLow: 0.12,
  extremeHigh: 0.88,
} as const

/** Hard veto: thin book (size or locked mid). */
export const THIN_BOOK_BLOCK = {
  enabled: true,
  minBidSize: 50,
  minAskSize: 50,
  lockedLow: 0.02,
  lockedHigh: 0.98,
} as const

/** Paper journal defaults. */
export const PAPER = {
  defaultContracts: 10,
  /** Min resolved trades before even considering "promote" language in UI. */
  minSampleToDiscuss: 50,
} as const

/** Polling / history. */
export const LAB = {
  pollIntervalMs: 8_000,
  midHistoryMaxSamples: 90,
  thinSpreadWarnCents: 6,
} as const
