/**
 * Persist paper MM session across full page reloads / Vite remounts.
 * PAPER ONLY — never touches live Kalshi orders.
 */

import { clampConfig, DEFAULT_PAPER_MM_CONFIG, type PaperMmConfig } from './config'
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
  v: 1
  running: boolean
  config: PaperMmConfig
  sessionLedger: SessionLedgerPersisted
  sessionStartedAt: number | null
  /** Tickers that held slots at save time (hint for restore). */
  activeTickers: string[]
  savedAt: number
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

/** Pure serialize — used by portfolio + unit tests. */
export function serializePaperMmSession(input: {
  running: boolean
  config: PaperMmConfig
  sessionLedger: SessionLedgerPersisted
  sessionStartedAt: number | null
  activeTickers?: string[]
  savedAt?: number
}): PersistedPaperMmSession {
  return {
    v: 1,
    running: Boolean(input.running),
    config: clampConfig(input.config),
    sessionLedger: sanitizeLedger(input.sessionLedger),
    sessionStartedAt:
      input.sessionStartedAt != null && Number.isFinite(input.sessionStartedAt)
        ? input.sessionStartedAt
        : null,
    activeTickers: (input.activeTickers ?? []).filter((t) => typeof t === 'string').slice(0, 24),
    savedAt: input.savedAt ?? Date.now(),
  }
}

/** Pure restore — returns null if missing/corrupt. */
export function deserializePaperMmSession(raw: unknown): PersistedPaperMmSession | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<PersistedPaperMmSession>
  if (o.v !== 1) return null
  return {
    v: 1,
    running: Boolean(o.running),
    config: clampConfig({ ...DEFAULT_PAPER_MM_CONFIG, ...(o.config ?? {}) }),
    sessionLedger: sanitizeLedger(o.sessionLedger),
    sessionStartedAt:
      o.sessionStartedAt != null && Number.isFinite(o.sessionStartedAt) ? o.sessionStartedAt : null,
    activeTickers: Array.isArray(o.activeTickers)
      ? o.activeTickers.filter((t): t is string => typeof t === 'string').slice(0, 24)
      : [],
    savedAt: typeof o.savedAt === 'number' && Number.isFinite(o.savedAt) ? o.savedAt : Date.now(),
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
