/**
 * Persist paper MM session across full page reloads / Vite remounts.
 * PAPER ONLY — never touches live Kalshi orders.
 */

import {
  clampConfig,
  DEFAULT_PAPER_MM_CONFIG,
  migratePersistedScarcityConfig,
  type PaperMmConfig,
} from './config'
import {
  emptyFillCapSnapshot,
  HARSH_FILL_POLICY_MARKER,
  sanitizeFillCapSnapshot,
  type FillCapSnapshot,
} from './fillCaps'
import type { MmCancelEvent, MmFill } from './types'

export const PAPER_MM_SESSION_KEY = 'kalshi-paper-mm-session-v1'

export interface SessionLedgerPersisted {
  realizedSpreadPnl: number
  feesPaid: number
  fillCount: number
  cancelCount: number
  fills: MmFill[]
  cancels: MmCancelEvent[]
}

export interface PersistedPaperMmSession {
  /** v2 adds fillCaps + harsh-policy migration marker. v1 still deserializes. */
  v: 1 | 2
  running: boolean
  config: PaperMmConfig
  sessionLedger: SessionLedgerPersisted
  sessionStartedAt: number | null
  /** Tickers that held slots at save time (hint for restore). */
  activeTickers: string[]
  savedAt: number
  /** Per-ticker fill timestamps + harsh-policy epoch (v2). */
  fillCaps: FillCapSnapshot
}

export function emptySessionLedger(): SessionLedgerPersisted {
  return {
    realizedSpreadPnl: 0,
    feesPaid: 0,
    fillCount: 0,
    cancelCount: 0,
    fills: [],
    cancels: [],
  }
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function isFill(x: unknown): x is MmFill {
  if (!x || typeof x !== 'object') return false
  const f = x as MmFill
  return (
    typeof f.id === 'string' &&
    typeof f.t === 'number' &&
    (f.side === 'buy_yes' || f.side === 'sell_yes') &&
    typeof f.price === 'number' &&
    typeof f.size === 'number'
  )
}

function isCancel(x: unknown): x is MmCancelEvent {
  if (!x || typeof x !== 'object') return false
  const c = x as MmCancelEvent
  return typeof c.id === 'string' && typeof c.t === 'number' && typeof c.reason === 'string'
}

function sanitizeLedger(raw: unknown): SessionLedgerPersisted {
  const base = emptySessionLedger()
  if (!raw || typeof raw !== 'object') return base
  const L = raw as Partial<SessionLedgerPersisted>
  const fills = Array.isArray(L.fills) ? L.fills.filter(isFill).slice(-1000) : []
  const cancels = Array.isArray(L.cancels) ? L.cancels.filter(isCancel).slice(-500) : []
  return {
    realizedSpreadPnl:
      typeof L.realizedSpreadPnl === 'number' && Number.isFinite(L.realizedSpreadPnl)
        ? L.realizedSpreadPnl
        : 0,
    feesPaid: typeof L.feesPaid === 'number' && Number.isFinite(L.feesPaid) ? L.feesPaid : 0,
    fillCount:
      typeof L.fillCount === 'number' && Number.isFinite(L.fillCount)
        ? Math.max(0, Math.floor(L.fillCount))
        : fills.length,
    cancelCount:
      typeof L.cancelCount === 'number' && Number.isFinite(L.cancelCount)
        ? Math.max(0, Math.floor(L.cancelCount))
        : cancels.length,
    fills,
    cancels,
  }
}

/**
 * Build fill-cap snapshot for persist. Legacy (v1 / unmarked) sessions get a
 * fresh harshPolicyEpochMs so old fills do not inflate harsh fills/hour.
 */
function resolveFillCaps(raw: unknown, now: number): FillCapSnapshot {
  if (raw == null) {
    // Migration: no prior caps → new harsh era marker now.
    return emptyFillCapSnapshot(now)
  }
  return sanitizeFillCapSnapshot(raw, now)
}

/** Pure serialize — used by portfolio + unit tests. */
export function serializePaperMmSession(input: {
  running: boolean
  config: PaperMmConfig
  sessionLedger: SessionLedgerPersisted
  sessionStartedAt: number | null
  activeTickers?: string[]
  savedAt?: number
  fillCaps?: FillCapSnapshot
}): PersistedPaperMmSession {
  const now = input.savedAt ?? Date.now()
  const fillCaps = input.fillCaps
    ? sanitizeFillCapSnapshot(input.fillCaps, now)
    : emptyFillCapSnapshot(now)
  return {
    v: 2,
    running: Boolean(input.running),
    config: clampConfig(input.config),
    sessionLedger: sanitizeLedger(input.sessionLedger),
    sessionStartedAt:
      input.sessionStartedAt != null && Number.isFinite(input.sessionStartedAt)
        ? input.sessionStartedAt
        : null,
    activeTickers: (input.activeTickers ?? []).filter((t) => typeof t === 'string').slice(0, 24),
    savedAt: now,
    fillCaps,
  }
}

/** Pure restore — returns null if missing/corrupt. Migrates v1 → v2. */
export function deserializePaperMmSession(raw: unknown): PersistedPaperMmSession | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<PersistedPaperMmSession> & { v?: number }
  if (o.v !== 1 && o.v !== 2) return null
  const now = Date.now()
  const fillCaps = resolveFillCaps(
    o.v === 2 ? (o as PersistedPaperMmSession).fillCaps : null,
    now,
  )
  // Ensure migration marker is always stamped on restore of legacy.
  if (o.v === 1 || fillCaps.marker !== HARSH_FILL_POLICY_MARKER) {
    fillCaps.marker = HARSH_FILL_POLICY_MARKER
    if (o.v === 1) fillCaps.harshPolicyEpochMs = now
  }
  const migratedCfg = migratePersistedScarcityConfig({
    ...DEFAULT_PAPER_MM_CONFIG,
    ...(o.config ?? {}),
  })
  return {
    v: 2,
    running: Boolean(o.running),
    config: clampConfig(migratedCfg),
    sessionLedger: sanitizeLedger(o.sessionLedger),
    sessionStartedAt:
      o.sessionStartedAt != null && Number.isFinite(o.sessionStartedAt) ? o.sessionStartedAt : null,
    activeTickers: Array.isArray(o.activeTickers)
      ? o.activeTickers.filter((t): t is string => typeof t === 'string').slice(0, 24)
      : [],
    savedAt: typeof o.savedAt === 'number' && Number.isFinite(o.savedAt) ? o.savedAt : now,
    fillCaps,
  }
}

export function loadPaperMmSession(): PersistedPaperMmSession | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(PAPER_MM_SESSION_KEY)
    if (!raw) return null
    return deserializePaperMmSession(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function savePaperMmSession(session: PersistedPaperMmSession): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(PAPER_MM_SESSION_KEY, JSON.stringify(session))
  } catch {
    /* quota / private mode */
  }
}

export function clearPaperMmSession(): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(PAPER_MM_SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/** Session Σ fingerprint for tests (realized + fees + fills). */
export function sessionLedgerSigma(ledger: SessionLedgerPersisted): {
  realizedSpreadPnl: number
  feesPaid: number
  fillCount: number
  cancelCount: number
} {
  return {
    realizedSpreadPnl: ledger.realizedSpreadPnl,
    feesPaid: ledger.feesPaid,
    fillCount: ledger.fillCount,
    cancelCount: ledger.cancelCount,
  }
}
