/**
 * Spot/strike fair value for crypto 15m YES (paper MM research).
 *
 * Assumptions (document for research — not a live edge claim):
 * - YES pays $1 iff spot at expiry ≥ floorStrike (Kalshi crypto 15m up/down).
 * - Spot ~ GBM with **zero drift** over the remaining window (short horizon).
 * - Constant annualized vol σ (`annualVol`, default 0.70). No jumps in FV.
 * - P(YES) = Φ( ln(S/K) / (σ √T) ), T in years from minutes remaining.
 * - Clamp to [0.01, 0.99]. T→0: S≥K → 0.99 else 0.01.
 * - Missing/invalid spot or strike → null (engine falls back to mid center).
 *
 * Free public spot only — no paid APIs.
 */

const MINUTES_PER_YEAR = 365.25 * 24 * 60

export interface FairValueInput {
  spot: number
  strike: number
  /** Minutes until market close / settlement. */
  minutesRemaining: number
  /** Annualized log-vol (e.g. 0.70 = 70%). */
  annualVol: number
}

export interface FairValueEstimate {
  /** P(YES) in dollars [0.01, 0.99]. */
  fairProb: number
  /** ln(S/K) / (σ√T); ±Infinity when T≈0. */
  d: number
  /** Time in years used. */
  tYears: number
  formula: string
}

/** Standard normal CDF via Abramowitz & Stegun 26.2.17. */
export function normCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.2316419 * ax)
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2)
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - p : p
}

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0.5
  return Math.min(0.99, Math.max(0.01, p))
}

/**
 * Estimate P(YES) from spot vs strike + time remaining.
 * Pure function — unit-test friendly.
 */
export function estimateYesFairValue(input: FairValueInput): FairValueEstimate | null {
  const { spot, strike, minutesRemaining, annualVol } = input
  if (!(spot > 0) || !(strike > 0) || !(annualVol > 0)) return null
  if (!Number.isFinite(spot) || !Number.isFinite(strike) || !Number.isFinite(annualVol)) {
    return null
  }

  const mins = Math.max(0, Number.isFinite(minutesRemaining) ? minutesRemaining : 0)
  const tYears = mins / MINUTES_PER_YEAR
  const logMoneyness = Math.log(spot / strike)

  // Degenerate time → step function at the strike
  if (tYears < 1e-12 || annualVol * Math.sqrt(tYears) < 1e-12) {
    const fairProb = clamp01(spot >= strike ? 0.99 : 0.01)
    return {
      fairProb,
      d: spot >= strike ? Infinity : -Infinity,
      tYears,
      formula: `T≈0 step: S=${spot.toFixed(2)} ${spot >= strike ? '≥' : '<'} K=${strike.toFixed(2)} → Φ= ${fairProb}`,
    }
  }

  const denom = annualVol * Math.sqrt(tYears)
  const d = logMoneyness / denom
  const fairProb = clamp01(normCdf(d))
  return {
    fairProb,
    d,
    tYears,
    formula: `Φ(ln(S/K)/(σ√T)) S=${spot.toFixed(2)} K=${strike.toFixed(2)} σ=${annualVol} T=${(tYears * 525960).toFixed(2)}m d=${d.toFixed(3)}`,
  }
}

/** Edge of FV vs market mid, in cents (positive = FV above mid). */
export function edgeVsMidCents(fairProb: number, mid: number): number {
  return (fairProb - mid) * 100
}
