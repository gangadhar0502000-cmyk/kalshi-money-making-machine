/**
 * Per-ticker rolling fill caps for paper MM.
 * Survives sync / rebuild / restore / engine start — keyed by ticker so a
 * 15m window roll to a fresh ticker gets a fresh cap while the old ticker
 * remains capped if revisited.
 * PAPER ONLY — never places live orders.
 */

export const FILL_CAP_WINDOW_MS = 15 * 60_000
export const FILL_CAP_MINUTE_MS = 60_000

/** Migration marker: fills at/after this epoch count toward harsh-policy metrics. */
export const HARSH_FILL_POLICY_MARKER = 'harsh-fill-caps-v2'

export interface FillCapSnapshot {
  byTicker: Record<string, number[]>
  /** Epoch ms — fills before this are legacy and must not inflate harsh fills/hour. */
  harshPolicyEpochMs: number
  marker: typeof HARSH_FILL_POLICY_MARKER
}

export function emptyFillCapSnapshot(now = Date.now()): FillCapSnapshot {
  return {
    byTicker: {},
    harshPolicyEpochMs: now,
    marker: HARSH_FILL_POLICY_MARKER,
  }
}

function pruneList(ts: number[], now: number): number[] {
  const keepFrom = now - FILL_CAP_WINDOW_MS
  return ts.filter((t) => Number.isFinite(t) && t >= keepFrom)
}

export class TickerFillCapStore {
  private byTicker = new Map<string, number[]>()
  private harshPolicyEpochMs: number
  private marker: typeof HARSH_FILL_POLICY_MARKER = HARSH_FILL_POLICY_MARKER

  constructor(harshPolicyEpochMs = Date.now()) {
    this.harshPolicyEpochMs = harshPolicyEpochMs
  }

  getHarshPolicyEpochMs(): number {
    return this.harshPolicyEpochMs
  }

  getMarker(): typeof HARSH_FILL_POLICY_MARKER {
    return this.marker
  }

  /** Reset harsh-era clock (migration / explicit reset). Does not wipe ticker caps. */
  resetHarshPolicyEpoch(now = Date.now()): void {
    this.harshPolicyEpochMs = now
    this.marker = HARSH_FILL_POLICY_MARKER
  }

  private list(ticker: string): number[] {
    return this.byTicker.get(ticker) ?? []
  }

  countInWindow(ticker: string, now: number, windowMs: number): number {
    const keep = pruneList(this.list(ticker), now)
    this.byTicker.set(ticker, keep)
    const cut = now - windowMs
    return keep.filter((t) => t >= cut).length
  }

  canAccept(
    ticker: string | null | undefined,
    now: number,
    maxPerMinute: number,
    maxPer15m: number,
  ): { ok: boolean; reason?: string } {
    if (!ticker) return { ok: true }
    const perMin = this.countInWindow(ticker, now, FILL_CAP_MINUTE_MS)
    if (perMin >= maxPerMinute) {
      return {
        ok: false,
        reason: `rate cap ${perMin}/${maxPerMinute} fills/min (${ticker})`,
      }
    }
    const per15 = this.countInWindow(ticker, now, FILL_CAP_WINDOW_MS)
    if (per15 >= maxPer15m) {
      return {
        ok: false,
        reason: `rate cap ${per15}/${maxPer15m} fills/15m (${ticker})`,
      }
    }
    return { ok: true }
  }

  record(ticker: string | null | undefined, now: number): void {
    if (!ticker) return
    const keep = pruneList(this.list(ticker), now)
    keep.push(now)
    if (keep.length > 500) keep.splice(0, keep.length - 500)
    this.byTicker.set(ticker, keep)
  }

  /** Timestamps for one ticker (pruned). */
  getTimestamps(ticker: string, now = Date.now()): number[] {
    const keep = pruneList(this.list(ticker), now)
    this.byTicker.set(ticker, keep)
    return [...keep]
  }

  exportSnapshot(now = Date.now()): FillCapSnapshot {
    const byTicker: Record<string, number[]> = {}
    for (const [t, ts] of this.byTicker) {
      const keep = pruneList(ts, now)
      if (keep.length > 0) byTicker[t] = keep
    }
    return {
      byTicker,
      harshPolicyEpochMs: this.harshPolicyEpochMs,
      marker: this.marker,
    }
  }

  importSnapshot(raw: unknown, now = Date.now()): void {
    this.byTicker.clear()
    if (!raw || typeof raw !== 'object') {
      this.harshPolicyEpochMs = now
      this.marker = HARSH_FILL_POLICY_MARKER
      return
    }
    const o = raw as Partial<FillCapSnapshot>
    const hasMarker = o.marker === HARSH_FILL_POLICY_MARKER
    // Legacy / unmarked sessions: start a fresh harsh-era clock so old fills
    // do not inflate harsh fills/hour. Cap timestamps still restore if present.
    if (
      hasMarker &&
      typeof o.harshPolicyEpochMs === 'number' &&
      Number.isFinite(o.harshPolicyEpochMs)
    ) {
      this.harshPolicyEpochMs = o.harshPolicyEpochMs
    } else {
      this.harshPolicyEpochMs = now
    }
    this.marker = HARSH_FILL_POLICY_MARKER

    const src = o.byTicker
    if (src && typeof src === 'object') {
      for (const [t, ts] of Object.entries(src)) {
        if (typeof t !== 'string' || !Array.isArray(ts)) continue
        const nums = ts.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
        const keep = pruneList(nums, now)
        if (keep.length > 0) this.byTicker.set(t, keep)
      }
    }
  }

  /** Count harsh-era fills across all tickers (or one) in a window. */
  countHarshInWindow(
    now: number,
    windowMs: number,
    ticker?: string | null,
  ): number {
    const epoch = this.harshPolicyEpochMs
    const cut = Math.max(now - windowMs, epoch)
    if (ticker) {
      return this.getTimestamps(ticker, now).filter((t) => t >= cut).length
    }
    let n = 0
    for (const t of this.byTicker.keys()) {
      n += this.getTimestamps(t, now).filter((x) => x >= cut).length
    }
    return n
  }

  /** Count fills at/after harshPolicyEpochMs (excludes legacy). */
  countHarshEraFills(now = Date.now(), ticker?: string | null): number {
    const epoch = this.harshPolicyEpochMs
    if (ticker) {
      return this.getTimestamps(ticker, now).filter((t) => t >= epoch).length
    }
    let count = 0
    for (const t of this.byTicker.keys()) {
      count += this.getTimestamps(t, now).filter((x) => x >= epoch).length
    }
    return count
  }

  /** Harsh-era fills/hour from epoch (legacy fills before epoch excluded). */
  harshFillsPerHour(now = Date.now(), ticker?: string | null): number {
    const epoch = this.harshPolicyEpochMs
    const hours = Math.max(1 / 3600, (now - epoch) / 3_600_000)
    return this.countHarshEraFills(now, ticker) / hours
  }
}

export function sanitizeFillCapSnapshot(
  raw: unknown,
  now = Date.now(),
): FillCapSnapshot {
  const store = new TickerFillCapStore(now)
  store.importSnapshot(raw, now)
  return store.exportSnapshot(now)
}
