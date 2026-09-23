/**
 * U3.2.2 — Browser UI → mm-proxy disk journal (paper only).
 * Keeps localStorage persist; also fire-and-forget POSTs fills to
 * POST /local-api/paper-mm/journal so the tape survives without Safari/Chrome.
 * Never places live Kalshi orders.
 */

import { localApiUrl } from './localApiBase'
import { buildFillEvent, type JournalEvent } from './headlessJournal'
import type { MmFill, MmSnapshot } from './types'
import type { PaperMmPortfolio, PortfolioState } from './portfolio'

/** Consecutive POST failures before fail-loud strip. */
export const UI_JOURNAL_FAIL_LOUD_AFTER = 3

export type UiDiskJournalStatus = {
  fillsOnDisk: number
  consecutiveFailures: number
  lastError: string | null
  /** True when failures ≥ UI_JOURNAL_FAIL_LOUD_AFTER */
  failLoud: boolean
}

type Listener = () => void

const listeners = new Set<Listener>()
let status: UiDiskJournalStatus = {
  fillsOnDisk: 0,
  consecutiveFailures: 0,
  lastError: null,
  failLoud: false,
}

const seenFillIds = new Set<string>()
let attached = false
let unsub: (() => void) | null = null
let runMetaPostedForStart: number | null = null
let lastSnapshotFillCount = -1

function notify(): void {
  for (const l of listeners) l()
}

function setStatus(patch: Partial<UiDiskJournalStatus>): void {
  status = {
    ...status,
    ...patch,
    failLoud:
      (patch.consecutiveFailures ?? status.consecutiveFailures) >=
      UI_JOURNAL_FAIL_LOUD_AFTER,
  }
  notify()
}

export function getUiDiskJournalStatus(): UiDiskJournalStatus {
  return status
}

export function subscribeUiDiskJournal(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Browser-only — headless already has journal.jsonl. */
export function shouldAttachUiDiskJournal(): boolean {
  return typeof window !== 'undefined'
}

/** Map an engine fill (+ book snapshot) → journal event (shared schema w/ headless). */
export function mmFillToJournalEvent(
  f: MmFill,
  snap?: Pick<
    MmSnapshot,
    | 'marketTicker'
    | 'asset'
    | 'midYes'
    | 'fairValue'
    | 'edgeVsMidCents'
    | 'inventory'
    | 'minutesRemaining'
    | 'cash'
    | 'spotPrice'
    | 'floorStrike'
    | 'bookBestBid'
    | 'bookBestAsk'
    | 'quote'
  > | null,
): JournalEvent {
  const quoteScenario =
    f.side === 'buy_yes' ? snap?.quote?.bidScenario : snap?.quote?.askScenario
  const ev = buildFillEvent({
    t: f.t,
    scenarioId: f.scenarioId ?? quoteScenario ?? snap?.quote?.activeScenario,
    ticker: f.ticker ?? snap?.marketTicker,
    asset: f.asset ?? snap?.asset,
    side: f.side,
    price: f.price,
    mid: f.midAtFill ?? snap?.midYes,
    fairValue: f.fairValue ?? snap?.fairValue,
    edgeCents: f.edgeCents ?? snap?.edgeVsMidCents,
    yesBid: f.yesBid ?? snap?.quote?.yesBid ?? snap?.bookBestBid,
    yesAsk: f.yesAsk ?? snap?.quote?.yesAsk ?? snap?.bookBestAsk,
    centerMode: f.centerMode ?? snap?.quote?.centerMode ?? 'mid',
    inventoryBefore: f.inventoryBefore,
    inventory: f.inventoryAfter ?? snap?.inventory,
    minutesLeft: f.minutesLeft ?? snap?.minutesRemaining,
    captureCents: f.captureDollars != null ? f.captureDollars * 100 : undefined,
    reason: f.reason,
    realizedDelta: f.captureDollars,
    cashAfter: f.cashAfter ?? snap?.cash,
    spot: f.spot ?? snap?.spotPrice,
    strike: f.strike ?? snap?.floorStrike,
    queueAhead: f.queueAhead,
    fillSize: f.fillSize ?? f.size,
  })
  ev.source = 'ui'
  return ev
}

export async function postUiJournalEvents(
  events: JournalEvent[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; fillsOnDisk?: number; error?: string }> {
  if (!events.length) return { ok: true, fillsOnDisk: status.fillsOnDisk }
  try {
    const res = await fetchImpl(localApiUrl('/local-api/paper-mm/journal'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ events }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      fillsOnDisk?: number
      error?: string
    }
    if (!res.ok || json.ok === false) {
      const err = json.error || `HTTP ${res.status}`
      setStatus({
        consecutiveFailures: status.consecutiveFailures + 1,
        lastError: err,
      })
      return { ok: false, error: err }
    }
    setStatus({
      consecutiveFailures: 0,
      lastError: null,
      fillsOnDisk:
        typeof json.fillsOnDisk === 'number'
          ? json.fillsOnDisk
          : status.fillsOnDisk + events.filter((e) => e.type === 'fill').length,
    })
    return { ok: true, fillsOnDisk: status.fillsOnDisk }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    setStatus({
      consecutiveFailures: status.consecutiveFailures + 1,
      lastError: err,
    })
    return { ok: false, error: err }
  }
}

export async function postUiRunMeta(
  meta: { startedAt: number; sha?: string | null; note?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchImpl(localApiUrl('/local-api/paper-mm/run-meta'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(meta),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      fillsOnDisk?: number
      error?: string
    }
    if (!res.ok || json.ok === false) {
      const err = json.error || `HTTP ${res.status}`
      setStatus({
        consecutiveFailures: status.consecutiveFailures + 1,
        lastError: err,
      })
      return { ok: false, error: err }
    }
    if (typeof json.fillsOnDisk === 'number') {
      setStatus({
        consecutiveFailures: 0,
        lastError: null,
        fillsOnDisk: json.fillsOnDisk,
      })
    } else {
      setStatus({ consecutiveFailures: 0, lastError: null })
    }
    return { ok: true }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    setStatus({
      consecutiveFailures: status.consecutiveFailures + 1,
      lastError: err,
    })
    return { ok: false, error: err }
  }
}

export async function refreshUiJournalStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  try {
    const res = await fetchImpl(localApiUrl('/local-api/paper-mm/journal-status'), {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return status.fillsOnDisk
    const json = (await res.json()) as { fillsOnDisk?: number }
    if (typeof json.fillsOnDisk === 'number') {
      setStatus({ fillsOnDisk: json.fillsOnDisk })
      return json.fillsOnDisk
    }
  } catch {
    /* ignore */
  }
  return status.fillsOnDisk
}

function collectNewFillEvents(st: PortfolioState): JournalEvent[] {
  const out: JournalEvent[] = []
  for (const book of st.books) {
    for (const f of book.fills) {
      if (seenFillIds.has(f.id)) continue
      seenFillIds.add(f.id)
      out.push(mmFillToJournalEvent(f, book.snapshot))
    }
  }
  for (const f of st.sessionFills) {
    if (seenFillIds.has(f.id)) continue
    seenFillIds.add(f.id)
    out.push(mmFillToJournalEvent(f, null))
  }
  return out
}

function maybePostRunMeta(st: PortfolioState): void {
  if (!st.running || st.sessionStartedAt == null) return
  if (runMetaPostedForStart === st.sessionStartedAt) return
  runMetaPostedForStart = st.sessionStartedAt
  const sha =
    typeof (import.meta as { env?: { VITE_GIT_SHA?: string } }).env?.VITE_GIT_SHA ===
    'string'
      ? (import.meta as { env?: { VITE_GIT_SHA?: string } }).env!.VITE_GIT_SHA
      : null
  void postUiRunMeta({
    startedAt: st.sessionStartedAt,
    sha,
    note: 'ui session start',
  })
}

function maybePostSessionSnapshot(st: PortfolioState): void {
  const fills = st.aggregate.fillCount
  if (fills === lastSnapshotFillCount) return
  // Snapshot on first observation and whenever fill count changes (cheap).
  lastSnapshotFillCount = fills
  if (!st.running && fills === 0) return
  const snapEv: JournalEvent = {
    type: 'info',
    t: Date.now(),
    iso: new Date().toISOString(),
    scenarioId: 'ui_session_snapshot',
    reason: `fills=${fills};cash=${st.aggregate.cash.toFixed(2)};realized=${st.aggregate.realizedSpreadPnl.toFixed(4)}`,
    inventory: st.aggregate.inventoryNet,
    cashAfter: st.aggregate.cash,
    realizedDelta: st.aggregate.realizedSpreadPnl,
    source: 'ui',
  }
  void postUiJournalEvents([snapEv])
}

function onPortfolioState(st: PortfolioState): void {
  maybePostRunMeta(st)
  const events = collectNewFillEvents(st)
  if (events.length) {
    void postUiJournalEvents(events)
  }
  maybePostSessionSnapshot(st)
}

/**
 * Attach once to a portfolio — posts fills + run-meta while the browser UI runs.
 * No-op in Node/headless (headless already journals to journal.jsonl).
 */
export function attachUiDiskJournal(
  portfolio: Pick<PaperMmPortfolio, 'subscribe' | 'getState'>,
): () => void {
  if (!shouldAttachUiDiskJournal()) {
    return () => {}
  }
  if (attached) {
    return () => {
      /* already attached — keep singleton */
    }
  }
  attached = true
  // Seed seen ids so restore doesn't re-journal old localStorage fills as new.
  const initial = portfolio.getState()
  for (const book of initial.books) {
    for (const f of book.fills) seenFillIds.add(f.id)
  }
  for (const f of initial.sessionFills) seenFillIds.add(f.id)
  lastSnapshotFillCount = initial.aggregate.fillCount
  void refreshUiJournalStatus()
  unsub = portfolio.subscribe(() => {
    onPortfolioState(portfolio.getState())
  })
  // If already running (auto-resume), stamp meta immediately.
  onPortfolioState(initial)
  return () => {
    unsub?.()
    unsub = null
    attached = false
  }
}

/** Test helper — reset module state. */
export function resetUiDiskJournalForTests(): void {
  seenFillIds.clear()
  attached = false
  unsub?.()
  unsub = null
  runMetaPostedForStart = null
  lastSnapshotFillCount = -1
  status = {
    fillsOnDisk: 0,
    consecutiveFailures: 0,
    lastError: null,
    failLoud: false,
  }
  notify()
}

/** Fail-loud message for strip when disk journal POSTs keep failing. */
export function uiDiskJournalFailLoudMessage(): string | null {
  if (!status.failLoud) return null
  const detail = status.lastError ? ` (${status.lastError})` : ''
  return `disk journal POST failed ×${status.consecutiveFailures}${detail}`
}
