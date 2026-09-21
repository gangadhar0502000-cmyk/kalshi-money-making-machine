/**
 * Binary YES prices MUST stay in dollars on [0, 1].
 * Classic bug: treating cents (e.g. 43) as dollars → ~100× P&L spikes.
 */

let warnedCents = false

/** Normalize a probability/price to dollars in [0, 1]. If |p| > 1.5, treat as cents/100. */
export function asDollarPrice(p: number, label = 'price'): number {
  if (!Number.isFinite(p)) return 0.5
  let x = p
  if (Math.abs(x) > 1.5) {
    if (!warnedCents) {
      warnedCents = true
      console.warn(
        `[paper-mm] ${label}=${p} looks like cents — normalizing /100 (prices must be dollars 0–1)`,
      )
    }
    x = x / 100
  }
  // Soft clamp; allow exact 0/1 for settlement
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

/** Assert helpers for engine — throws in strict audit paths. */
export function assertDollarPrice(p: number, label = 'price'): number {
  const n = asDollarPrice(p, label)
  if (Math.abs(p) > 1.5) {
    // already warned + normalized
  }
  return n
}

export function roundPx(p: number): number {
  return Math.round(asDollarPrice(p) * 100) / 100
}

export function clampPx(p: number): number {
  return Math.min(0.99, Math.max(0.01, roundPx(p)))
}

/** Format dollar P&L with both $ and ¢ so 50× jumps are obvious. */
export function formatPnlDual(dollars: number): { dollars: string; centsLabel: string } {
  const d = Number.isFinite(dollars) ? dollars : 0
  const dollarsStr = d.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const cents = d * 100
  const centsLabel = `${cents >= 0 ? '+' : ''}${cents.toFixed(1)}¢`
  return { dollars: dollarsStr, centsLabel }
}

/**
 * True when mid is usable for FV−mid edge / quoting.
 * Rejects null/NaN, exact 0 or 1 (empty/missing book sentinels), and non-finite.
 * Window-boundary books often parse as mid=0 → absurd EDGE vs FV≈0.99.
 */
export function isValidQuoteMid(mid: number | null | undefined): boolean {
  if (mid == null || !Number.isFinite(mid)) return false
  const m = asDollarPrice(mid, 'valid.mid')
  return m > 0 && m < 1
}
