/**
 * Append-only paper MM journal + hourly digests.
 * PAPER ONLY — never places live Kalshi orders.
 */

export type JournalEventType = 'fill' | 'blocked_close' | 's51_evict' | 'info'

export interface JournalEvent {
  type: JournalEventType
  /** Epoch ms */
  t: number
  iso: string
  /** U3.2.2: 'ui' for browser disk journal; omit/headless for node runner. */
  source?: 'ui' | 'headless' | string
  /** Plain house tags (house_mid / flatten / blackout / …) or legacy digest ids — never drives quotes. */
  scenarioId?: string
  ticker?: string
  asset?: string
  side?: string
  /** YES price dollars 0–1 */
  price?: number
  /** Book mid (midYes) at fill — dollars 0–1. */
  mid?: number | null
  /** Digital FV at fill (telemetry only under U3.2). */
  fairValue?: number | null
  /** (FV − mid) ¢ at fill — telemetry only; does not center quotes. */
  edgeCents?: number | null
  /** Resting / book yes bid at fill. */
  yesBid?: number | null
  /** Resting / book yes ask at fill. */
  yesAsk?: number | null
  /** Quote center mode at fill (`mid` under U3.2 house rules). */
  centerMode?: 'fv' | 'mid' | null
  /** Inventory before this fill applied. */
  inventoryBefore?: number
  /** Inventory after this fill applied. */
  inventory?: number
  minutesLeft?: number | null
  captureCents?: number | null
  reason?: string
  /** Realized $ delta on closes (fills that reduce inventory). */
  realizedDelta?: number
  /** Cash after fill (dollars), when available. */
  cashAfter?: number | null
  /** Spot used for FV telemetry at fill. */
  spot?: number | null
  /** Strike / floorStrike at fill. */
  strike?: number | null
  /**
   * stuckUnwind counter at blocked_close time (consecutive S3 profit-bar blocks).
   * Measurement: detect S3 flicker resetting stuck before S4.1/S4.2.
   */
  stuckTicks?: number
  /**
   * How far capture is below minCloseProfitCents (¢). Positive ⇒ short of the S3 bar.
   * captureGapCents = minCloseProfitCents − captureCents when both known.
   */
  captureGapCents?: number | null
  /** Remaining size-ahead queue after book_depth fill attribution. */
  queueAhead?: number
  /** Contracts filled on this event (mirrors size when present). */
  fillSize?: number
}

export interface ScenarioDigestRow {
  fills: number
  /** Fills classified as opens (S1/S2 or ~0 capture). */
  openFills: number
  /** Fills classified as closes (S3/S4/S4.x or non-zero capture). */
  closeFills: number
  totalCaptureCents: number
  /** Blended avg ¢/fill (opens+closes) — backward-compatible. */
  avgCentsPerFill: number
  /** Avg ¢ per completed round-trip ≈ totalCapture / closeFills. */
  avgCentsPerRoundTrip: number
  stuckS41: number
  markBleedS42: number
  s51Evictions: number
  blockedCloses: number
  totalRealizedDelta: number
}

export interface HourlyDigest {
  hourKey: string
  generatedAt: string
  windowStartMs: number
  windowEndMs: number
  byScenario: Record<string, ScenarioDigestRow>
  totals: ScenarioDigestRow & { events: number }
  paperOnly: true
}

const EMPTY_ROW = (): ScenarioDigestRow => ({
  fills: 0,
  openFills: 0,
  closeFills: 0,
  totalCaptureCents: 0,
  avgCentsPerFill: 0,
  avgCentsPerRoundTrip: 0,
  stuckS41: 0,
  markBleedS42: 0,
  s51Evictions: 0,
  blockedCloses: 0,
  totalRealizedDelta: 0,
})

const CLOSE_SCENARIOS = new Set(['S3', 'S4', 'S4.1', 'S4.2', 'flatten', 'blackout_flatten'])
const OPEN_SCENARIOS = new Set(['S1', 'S2', 'house_mid', 'open'])

/** Classify a fill as open vs close for digest split (measurement only). */
export function classifyFillLeg(
  scenarioId: string | undefined,
  captureCents: number,
): 'open' | 'close' {
  const sid = scenarioId ?? ''
  if (CLOSE_SCENARIOS.has(sid) || /^S4(\b|\.)/.test(sid)) return 'close'
  if (OPEN_SCENARIOS.has(sid)) return 'open'
  // Legacy / mis-tagged: non-zero capture ⇒ close leg; else open.
  return Math.abs(captureCents) > 1e-9 ? 'close' : 'open'
}

/** Format a journal line — pure, no I/O. */
export function formatJournalLine(ev: JournalEvent): string {
  return JSON.stringify(ev)
}

/** Parse one JSONL line; returns null if blank/corrupt. */
export function parseJournalLine(line: string): JournalEvent | null {
  const t = line.trim()
  if (!t) return null
  try {
    const o = JSON.parse(t) as Partial<JournalEvent>
    if (!o || typeof o !== 'object') return null
    if (typeof o.t !== 'number' || typeof o.type !== 'string') return null
    return o as JournalEvent
  } catch {
    return null
  }
}

/** Local (box) hour key YYYY-MM-DD-HH from epoch ms. */
export function hourKeyFromMs(ms: number, timeZone = 'America/Chicago'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}-${hour}`
}

function bump(row: ScenarioDigestRow, patch: Partial<ScenarioDigestRow>): void {
  if (patch.fills) row.fills += patch.fills
  if (patch.openFills) row.openFills += patch.openFills
  if (patch.closeFills) row.closeFills += patch.closeFills
  if (patch.totalCaptureCents) row.totalCaptureCents += patch.totalCaptureCents
  if (patch.stuckS41) row.stuckS41 += patch.stuckS41
  if (patch.markBleedS42) row.markBleedS42 += patch.markBleedS42
  if (patch.s51Evictions) row.s51Evictions += patch.s51Evictions
  if (patch.blockedCloses) row.blockedCloses += patch.blockedCloses
  if (patch.totalRealizedDelta) row.totalRealizedDelta += patch.totalRealizedDelta
}

function finalizeRow(row: ScenarioDigestRow): ScenarioDigestRow {
  return {
    ...row,
    avgCentsPerFill: row.fills > 0 ? row.totalCaptureCents / row.fills : 0,
    avgCentsPerRoundTrip: row.closeFills > 0 ? row.totalCaptureCents / row.closeFills : 0,
  }
}

/**
 * Aggregate journal events into a per-scenario digest for [windowStart, windowEnd).
 */
export function aggregateDigest(
  events: JournalEvent[],
  windowStartMs: number,
  windowEndMs: number,
  timeZone = 'America/Chicago',
): HourlyDigest {
  const byScenario: Record<string, ScenarioDigestRow> = {}
  const totals = EMPTY_ROW()
  let eventsCounted = 0

  const ensure = (id: string) => {
    if (!byScenario[id]) byScenario[id] = EMPTY_ROW()
    return byScenario[id]!
  }

  for (const ev of events) {
    if (ev.t < windowStartMs || ev.t >= windowEndMs) continue
    eventsCounted += 1
    const sid = ev.scenarioId ?? (ev.type === 'info' ? 'info' : 'unknown')
    const row = ensure(sid)

    if (ev.type === 'fill') {
      const cap = ev.captureCents ?? (ev.realizedDelta != null ? ev.realizedDelta * 100 : 0)
      const leg = classifyFillLeg(ev.scenarioId, cap)
      bump(row, {
        fills: 1,
        openFills: leg === 'open' ? 1 : 0,
        closeFills: leg === 'close' ? 1 : 0,
        totalCaptureCents: cap,
        totalRealizedDelta: ev.realizedDelta ?? 0,
      })
      bump(totals, {
        fills: 1,
        openFills: leg === 'open' ? 1 : 0,
        closeFills: leg === 'close' ? 1 : 0,
        totalCaptureCents: cap,
        totalRealizedDelta: ev.realizedDelta ?? 0,
      })
      if (sid === 'S4.1' || /S4\.1|STUCK_UNWIND/i.test(ev.reason ?? '')) {
        bump(row, { stuckS41: 1 })
        bump(totals, { stuckS41: 1 })
      }
      if (sid === 'S4.2' || /S4\.2|MARK_BLEED/i.test(ev.reason ?? '')) {
        bump(row, { markBleedS42: 1 })
        bump(totals, { markBleedS42: 1 })
      }
    } else if (ev.type === 'blocked_close') {
      bump(row, { blockedCloses: 1 })
      bump(totals, { blockedCloses: 1 })
      if (sid === 'S4.1' || /stuck/i.test(ev.reason ?? '')) {
        bump(row, { stuckS41: 1 })
        bump(totals, { stuckS41: 1 })
      }
    } else if (ev.type === 's51_evict') {
      bump(row, { s51Evictions: 1 })
      bump(totals, { s51Evictions: 1 })
    }
  }

  for (const k of Object.keys(byScenario)) {
    byScenario[k] = finalizeRow(byScenario[k]!)
  }

  return {
    hourKey: hourKeyFromMs(windowStartMs, timeZone),
    generatedAt: new Date().toISOString(),
    windowStartMs,
    windowEndMs,
    byScenario,
    totals: { ...finalizeRow(totals), events: eventsCounted },
    paperOnly: true,
  }
}


/** Parse capture ¢ from a CLOSE blocked reason (evaluateClose text). */
export function parseBlockedCloseCaptureCents(reason: string): number | null {
  const m = /CLOSE blocked:\s*capture\s+(-?\d+(?:\.\d+)?)¢/i.exec(reason)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Build a JournalEvent for a paper fill (full tape detail for U3.2+ rule coding). */
export function buildFillEvent(input: {
  t?: number
  scenarioId?: string
  ticker?: string | null
  asset?: string | null
  side: string
  price: number
  mid?: number | null
  fairValue?: number | null
  edgeCents?: number | null
  yesBid?: number | null
  yesAsk?: number | null
  centerMode?: 'fv' | 'mid' | null
  inventoryBefore?: number
  inventory?: number
  minutesLeft?: number | null
  captureCents?: number | null
  reason?: string
  realizedDelta?: number
  cashAfter?: number | null
  spot?: number | null
  strike?: number | null
  queueAhead?: number
  fillSize?: number
}): JournalEvent {
  const t = input.t ?? Date.now()
  return {
    type: 'fill',
    t,
    iso: new Date(t).toISOString(),
    scenarioId: input.scenarioId,
    ticker: input.ticker ?? undefined,
    asset: input.asset ?? undefined,
    side: input.side,
    price: input.price,
    mid: input.mid ?? null,
    fairValue: input.fairValue ?? null,
    edgeCents: input.edgeCents ?? null,
    yesBid: input.yesBid ?? null,
    yesAsk: input.yesAsk ?? null,
    centerMode: input.centerMode ?? null,
    inventoryBefore: input.inventoryBefore,
    inventory: input.inventory,
    minutesLeft: input.minutesLeft ?? null,
    captureCents: input.captureCents ?? null,
    reason: input.reason,
    realizedDelta: input.realizedDelta,
    cashAfter: input.cashAfter ?? null,
    spot: input.spot ?? null,
    strike: input.strike ?? null,
    queueAhead: input.queueAhead,
    fillSize: input.fillSize,
  }
}

/** Build a JournalEvent for a blocked close decision. */
export function buildBlockedCloseEvent(input: {
  t?: number
  scenarioId?: string
  ticker?: string | null
  asset?: string | null
  side?: string
  price?: number
  edgeCents?: number | null
  inventory?: number
  minutesLeft?: number | null
  captureCents?: number | null
  reason: string
  /** stuckUnwind counter at block time */
  stuckTicks?: number
  /** minCloseProfitCents − captureCents (¢ short of S3 bar) */
  captureGapCents?: number | null
}): JournalEvent {
  const t = input.t ?? Date.now()
  return {
    type: 'blocked_close',
    t,
    iso: new Date(t).toISOString(),
    scenarioId: input.scenarioId ?? 'paused',
    ticker: input.ticker ?? undefined,
    asset: input.asset ?? undefined,
    side: input.side,
    price: input.price,
    edgeCents: input.edgeCents ?? null,
    inventory: input.inventory,
    minutesLeft: input.minutesLeft ?? null,
    captureCents: input.captureCents ?? null,
    reason: input.reason,
    stuckTicks: input.stuckTicks,
    captureGapCents: input.captureGapCents ?? null,
  }
}

/** @deprecated Prefer buildSlotEvictEvent — kept for journal type compat. */
export function buildS51EvictEvent(input: {
  t?: number
  ticker?: string | null
  asset?: string | null
  reason?: string
}): JournalEvent {
  return buildSlotEvictEvent(input)
}

/** Slot eviction journal event (sanity+flat / L2-off) — not a quote scenario. */
export function buildSlotEvictEvent(input: {
  t?: number
  ticker?: string | null
  asset?: string | null
  reason?: string
}): JournalEvent {
  const t = input.t ?? Date.now()
  return {
    type: 's51_evict', // internal journal type; scenarioId is SLOT_EVICT (not S5.x)
    t,
    iso: new Date(t).toISOString(),
    scenarioId: 'SLOT_EVICT',
    ticker: input.ticker ?? undefined,
    asset: input.asset ?? undefined,
    reason: input.reason ?? 'SLOT_EVICT sanity+flat',
  }
}

/** Start of the local hour containing `ms` (approx via hourKey round-trip). */
export function hourWindowContaining(
  ms: number,
  timeZone = 'America/Chicago',
): { startMs: number; endMs: number; hourKey: string } {
  const key = hourKeyFromMs(ms, timeZone)
  // Walk back ≤ 25h to find the first ms that shares this hourKey, then +1h.
  // Cheap and timezone-safe without luxon.
  const hourMs = 3_600_000
  let start = ms - (ms % hourMs) - hourMs // pad for TZ offset
  for (let i = 0; i < 30; i++) {
    const cand = start + i * 60_000
    if (hourKeyFromMs(cand, timeZone) === key) {
      // find exact start by scanning minute
      let s = cand
      while (s > cand - hourMs && hourKeyFromMs(s - 60_000, timeZone) === key) s -= 60_000
      // refine end to first ms outside key
      let e = s + hourMs
      while (e > s && hourKeyFromMs(e - 1, timeZone) !== key) e -= 60_000
      while (hourKeyFromMs(e, timeZone) === key) e += 60_000
      return { startMs: s, endMs: e, hourKey: key }
    }
  }
  return { startMs: ms - hourMs, endMs: ms, hourKey: key }
}
