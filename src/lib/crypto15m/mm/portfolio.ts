/**
 * Multi-book / portfolio paper MM controller.
 * Spawns up to maxActiveMarkets PaperMmEngine instances, ranks by |FV−mid|,
 * auto-rolls same-asset, frees slots when a book dies with no same-asset roll.
 * PAPER ONLY — never places live Kalshi orders.
 */

import type { Crypto15mMarket } from '../../../types/crypto15m'
import {
  canonicalMmAsset,
  fetchPublicSpot,
  normalizeSpotAsset,
} from '../spot'
import {
  DEFAULT_PAPER_MM_CONFIG,
  clampConfig,
  migratePersistedScarcityConfig,
  presetsForMode,
  type PaperMmConfig,
} from './config'
import { QUOTING_PAUSED_REASON } from './decisionPolicy'
import { PaperMmEngine } from './engine'
import {
  pickActiveMarkets,
  rankMarketsByAbsEdge,
  type RankedMarket,
} from './edgeRank'
import { isMarketOpen, pickBestOpenMarket, pickRollTarget } from './marketSelect'
import type { MmCancelEvent, MmEngineState, MmFill, MmSnapshot } from './types'
import {
  marketForQuoteBook,
  quoteBookToL2Side,
  resolveQuoteBook,
  type QuoteBook,
} from './quoteBook'
import {
  clearPaperMmSession,
  deserializePaperMmSession,
  loadPaperMmSession,
  savePaperMmSession,
  serializePaperMmSession,
  type PersistedPaperMmSession,
  type SessionLedgerPersisted,
} from './persist'
import {
  FILL_CAP_WINDOW_MS,
  TickerFillCapStore,
  portfolioFillCap15m,
  type FillCapSnapshot,
} from './fillCaps'

export interface PortfolioBookView {
  slotId: string
  snapshot: MmSnapshot
  fills: MmFill[]
  cancels: MmCancelEvent[]
}

export interface PortfolioAggregate {
  cash: number
  realizedSpreadPnl: number
  unrealizedInventoryPnl: number
  feesPaid: number
  fillCount: number
  cancelCount: number
  inventoryNet: number
  activeBooks: number
  moneyPrinterBug: boolean
  /** Harsh-policy-era fills/hour (excludes legacy persisted fills). */
  harshFillsPerHour: number
  /** Rolling 15m fills across active ticker caps (harsh-era). */
  harshFillsLast15m: number
  harshPolicyEpochMs: number
  /** Hard portfolio-wide 15m fill ceiling currently enforced. */
  portfolioFillCap15m: number
  /** Sum of captureDollars on fills in last rolling 15m (session + live books). */
  realizedDeltaLast15m: number
  /** Average captured cents per fill over last 15m (0 if no fills). */
  avgCaptureCentsPerFillLast15m: number
}

export interface PortfolioState {
  running: boolean
  config: PaperMmConfig
  books: PortfolioBookView[]
  /** Full open-universe scan ranked by |edge|. */
  scan: RankedMarket[]
  aggregate: PortfolioAggregate
  message: string
  spotsByAsset: Record<string, number>
  sessionStartedAt: number | null
  /** Session-level fill journal (survives rolls/releases). */
  sessionFills: MmFill[]
  sessionCancels: MmCancelEvent[]
  /** Shared per-ticker fill caps snapshot (diagnostics). */
  fillCaps: FillCapSnapshot
}

/** Banked stats from released books — preserved across rolls/releases. */
type SessionLedger = SessionLedgerPersisted

function emptyLedger(): SessionLedger {
  return {
    realizedSpreadPnl: 0,
    feesPaid: 0,
    fillCount: 0,
    cancelCount: 0,
    fills: [],
    cancels: [],
  }
}

let slotSeq = 0
function nextSlotId(): string {
  slotSeq += 1
  return `slot-${slotSeq}`
}

export class PaperMmPortfolio {
  private config: PaperMmConfig = { ...DEFAULT_PAPER_MM_CONFIG }
  private running = false
  private books = new Map<string, PaperMmEngine>()
  private slotOfTicker = new Map<string, string>()
  /** U2.13: sticky YES/NO book per slot while |inventory| >= 1. */
  private quoteBookSticky = new Map<string, QuoteBook>()
  /**
   * U2.14: consecutive syncMarketUniverse ticks with useLiveBook && !liveBook
   * per slot. Reset when L2 returns or slot is removed.
   */
  private l2OffTicksBySlot = new Map<string, number>()
  /** U2.14: tickers dropped for L2-off+flat — excluded from refill until universe loses them. */
  private l2OffBlockedTickers = new Set<string>()
  private listeners = new Set<() => void>()
  private spotsByAsset: Record<string, number> = {}
  private lastScan: RankedMarket[] = []
  private message =
    'Idle — multi-book paper MM scans all open crypto 15m by |FV−mid| edge. Read-only · never places trades.'
  private sessionStartedAt: number | null = null
  private spotTimer: number | null = null
  private syncTimer: number | null = null
  private lastMarkets: Crypto15mMarket[] = []
  private unsubs: Array<() => void> = []
  /** Realized / fees / fills banked when books are released (session totals). */
  private sessionLedger: SessionLedger = emptyLedger()
  /** Shared per-ticker fill caps — survives sync/rebuild/restore. */
  private fillCapStore = new TickerFillCapStore()
  /** Set when localStorage said we were RUNNING — auto-start after first universe sync. */
  private pendingAutoResume = false
  private persistEnabled = true

  constructor(opts?: { skipRestore?: boolean }) {
    if (!opts?.skipRestore) {
      this.restoreFromStorage()
    }
  }

  /** Test helper: disable localStorage writes. */
  setPersistEnabled(on: boolean): void {
    this.persistEnabled = on
  }

  /** Whether a prior session asked to keep RUNNING across reload. */
  wantsAutoResume(): boolean {
    return this.pendingAutoResume
  }

  /** Snapshot for serialize/restore tests (session ledger Σ). */
  getSessionLedger(): SessionLedger {
    return {
      realizedSpreadPnl: this.sessionLedger.realizedSpreadPnl,
      feesPaid: this.sessionLedger.feesPaid,
      fillCount: this.sessionLedger.fillCount,
      cancelCount: this.sessionLedger.cancelCount,
      fills: [...this.sessionLedger.fills],
      cancels: [...this.sessionLedger.cancels],
    }
  }

  /** Pure serialize of current session (does not require localStorage). */
  serializeSession(): PersistedPaperMmSession {
    const activeTickers = [...this.slotOfTicker.keys()]
    return serializePaperMmSession({
      running: this.running,
      config: this.config,
      sessionLedger: this.getSessionLedger(),
      sessionStartedAt: this.sessionStartedAt,
      activeTickers,
      fillCaps: this.fillCapStore.exportSnapshot(),
    })
  }

  /** Test/helper access to shared fill-cap store. */
  getFillCapStore(): TickerFillCapStore {
    return this.fillCapStore
  }

  /** Recompute hard portfolio 15m cap from active books × per-ticker scarcity. */
  private refreshPortfolioFillCap(): void {
    const books = Math.max(1, this.books.size)
    const cap = portfolioFillCap15m(books, this.config.maxFillsPerMarketPer15m)
    this.fillCapStore.setPortfolioCap15m(cap)
  }

  /** Apply a previously serialized session (ledger + knobs + wasRunning). Does not start engines. */
  applySerializedSession(raw: PersistedPaperMmSession | unknown): boolean {
    const parsed =
      raw && typeof raw === 'object' && (raw as PersistedPaperMmSession).v === 1
        ? deserializePaperMmSession(raw)
        : deserializePaperMmSession(raw)
    if (!parsed) return false
    this.config = clampConfig(migratePersistedScarcityConfig(parsed.config))
    this.sessionLedger = {
      realizedSpreadPnl: parsed.sessionLedger.realizedSpreadPnl,
      feesPaid: parsed.sessionLedger.feesPaid,
      fillCount: parsed.sessionLedger.fillCount,
      cancelCount: parsed.sessionLedger.cancelCount,
      fills: [...parsed.sessionLedger.fills],
      cancels: [...parsed.sessionLedger.cancels],
    }
    this.sessionStartedAt = parsed.sessionStartedAt
    this.pendingAutoResume = parsed.running
    this.fillCapStore.importSnapshot(parsed.fillCaps)
    this.refreshPortfolioFillCap()
    // Do NOT set this.running yet — start({ resume: true }) after universe sync.
    this.running = false
    this.message =
      parsed.running
        ? 'Restored paper MM session — will auto-resume after market sync. Read-only · never places trades.'
        : 'Restored paper MM session (stopped). Read-only · never places trades.'
    this.emit()
    return true
  }

  private restoreFromStorage(): void {
    const loaded = loadPaperMmSession()
    if (!loaded) return
    this.applySerializedSession(loaded)
  }

  private persistNow(): void {
    if (!this.persistEnabled) return
    try {
      savePaperMmSession(this.serializeSession())
    } catch {
      /* ignore */
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    this.persistNow()
    for (const fn of this.listeners) fn()
  }

  getConfig(): PaperMmConfig {
    return { ...this.config }
  }

  setConfig(partial: Partial<PaperMmConfig>): void {
    if (partial.strictRealism !== undefined && partial.strictRealism !== this.config.strictRealism) {
      partial = { ...presetsForMode(partial.strictRealism), ...partial }
    }
    this.config = clampConfig({ ...this.config, ...partial })
    this.refreshPortfolioFillCap()
    for (const eng of this.books.values()) {
      // Preserve per-slot YES/NO L2 side (U2.13 sticky) across portfolio knobs.
      const side = eng.getConfig().quoteBookSide
      eng.setConfig({ ...this.config, quoteBookSide: side })
    }
    // Cap may shrink — drop lowest-edge extras only when a valid ranked set exists
    if (this.lastMarkets.length > 0 && this.openCount(this.lastMarkets) > 0) {
      this.rebalanceSlots(this.lastMarkets)
    }
    if (this.running) this.armTimers()
    this.emit()
  }

  setStrictRealism(strict: boolean): void {
    this.setConfig({ strictRealism: strict })
  }

  /** Test helper: seed spot for an asset without network. */
  seedSpot(asset: string, price: number): void {
    if (!Number.isFinite(price) || price <= 0) return
    const key = normalizeSpotAsset(asset)
    if (!key) return // refuse seeding unsupported → never store under BTC
    this.spotsByAsset = { ...this.spotsByAsset, [key]: price }
    for (const eng of this.books.values()) {
      const snap = eng.getState().snapshot
      if (snap.asset && normalizeSpotAsset(snap.asset) === key) {
        eng.seedSpot(price)
      }
    }
    if (this.lastMarkets.length > 0) {
      this.refreshScan(this.lastMarkets)
      if (this.running && this.openCount(this.lastMarkets) > 0) {
        this.rebalanceSlots(this.lastMarkets)
      }
    }
    this.emit()
  }

  /** Test helper: seed paper stats onto the book for a ticker. */
  seedBookStats(
    ticker: string,
    opts: {
      realizedSpreadPnl?: number
      feesPaid?: number
      cash?: number
      fill?: MmFill
      cancel?: MmCancelEvent
    },
  ): void {
    const slotId = this.slotOfTicker.get(ticker)
    if (!slotId) return
    const eng = this.books.get(slotId)
    if (!eng) return
    eng.seedPaperStats(opts)
    this.emit()
  }

  private openCount(markets: Crypto15mMarket[], nowMs = Date.now()): number {
    return markets.filter((m) => isMarketOpen(m, nowMs)).length
  }

  getState(): PortfolioState {
    const books: PortfolioBookView[] = []
    for (const [slotId, eng] of this.books) {
      const st = eng.getState()
      books.push({
        slotId,
        snapshot: st.snapshot,
        fills: st.fills,
        cancels: st.cancels,
      })
    }
    // Stable order: by abs edge of scan, then ticker
    const edgeOf = (t: string | null) =>
      this.lastScan.find((r) => r.ticker === t)?.absEdgeCents ?? -1
    books.sort(
      (a, b) =>
        edgeOf(b.snapshot.marketTicker) - edgeOf(a.snapshot.marketTicker) ||
        (a.snapshot.marketTicker ?? '').localeCompare(b.snapshot.marketTicker ?? ''),
    )

    // U2.8 shared bankroll: one startingCash, not sum of per-book startingCash.
    // Live books: starting + Σ(book.cash − starting). Idle/no books: starting +
    // sessionLedger realized − fees (ledger banks P&L on release, not cash).
    const starting = this.config.startingCash
    let cashSum = 0
    let realized = this.sessionLedger.realizedSpreadPnl
    let unrealized = 0
    let fees = this.sessionLedger.feesPaid
    let fills = this.sessionLedger.fillCount
    let cancels = this.sessionLedger.cancelCount
    let inv = 0
    let moneyPrinter = false
    for (const b of books) {
      cashSum += b.snapshot.cash
      realized += b.snapshot.realizedSpreadPnl
      unrealized += b.snapshot.unrealizedInventoryPnl
      fees += b.snapshot.feesPaid
      fills += b.snapshot.fillCount
      cancels += b.snapshot.cancelCount
      inv += b.snapshot.inventory
      if (b.snapshot.moneyPrinterBug) moneyPrinter = true
    }
    const n = books.length
    let cash =
      n === 0
        ? starting + this.sessionLedger.realizedSpreadPnl - this.sessionLedger.feesPaid
        : starting + (cashSum - n * starting)
    // Fail-loud: absurd / NaN → fall back to starting (do not crash strip).
    if (!Number.isFinite(cash)) {
      cash = starting
    }
    const now = Date.now()
    this.refreshPortfolioFillCap()
    const portCap =
      this.fillCapStore.getPortfolioCap15m() ??
      portfolioFillCap15m(Math.max(1, books.length), this.config.maxFillsPerMarketPer15m)
    const cut15 = now - FILL_CAP_WINDOW_MS
    let realizedDelta15 = 0
    let fills15 = 0
    const countCapture = (list: typeof this.sessionLedger.fills) => {
      for (const f of list) {
        if (f.reason === 'settlement') continue
        if (f.t < cut15) continue
        fills15 += 1
        realizedDelta15 += f.captureDollars ?? 0
      }
    }
    countCapture(this.sessionLedger.fills)
    for (const b of books) countCapture(b.fills)

    return {
      running: this.running,
      config: { ...this.config },
      books,
      scan: [...this.lastScan],
      aggregate: {
        cash,
        realizedSpreadPnl: realized,
        unrealizedInventoryPnl: unrealized,
        feesPaid: fees,
        fillCount: fills,
        cancelCount: cancels,
        inventoryNet: inv,
        activeBooks: books.length,
        moneyPrinterBug: moneyPrinter,
        harshFillsPerHour: this.fillCapStore.harshFillsPerHour(now),
        harshFillsLast15m: this.fillCapStore.countHarshInWindow(now, 15 * 60_000),
        harshPolicyEpochMs: this.fillCapStore.getHarshPolicyEpochMs(),
        portfolioFillCap15m: portCap,
        realizedDeltaLast15m: realizedDelta15,
        avgCaptureCentsPerFillLast15m: fills15 > 0 ? (realizedDelta15 / fills15) * 100 : 0,
      },
      message: this.message,
      spotsByAsset: { ...this.spotsByAsset },
      sessionStartedAt: this.sessionStartedAt,
      sessionFills: [...this.sessionLedger.fills].slice(-200).reverse(),
      sessionCancels: [...this.sessionLedger.cancels].slice(-100).reverse(),
      fillCaps: this.fillCapStore.exportSnapshot(now),
    }
  }


  /**
   * U2.13: resolve better YES/NO book, set engine quoteBookSide (true L2 side),
   * and return market mapped for the YES-oriented engine.
   */
  private routeQuoteBook(
    slotId: string,
    eng: PaperMmEngine,
    raw: Crypto15mMarket,
  ): Crypto15mMarket {
    const inv = eng.getState().snapshot.inventory
    const sticky = this.quoteBookSticky.get(slotId) ?? null
    const resolved = resolveQuoteBook(raw, sticky, inv)
    this.quoteBookSticky.set(slotId, resolved.book)
    const side = quoteBookToL2Side(resolved.book)
    if (eng.getConfig().quoteBookSide !== side) {
      eng.setQuoteBookSide(side)
    }
    return marketForQuoteBook(raw, resolved.book)
  }

  private tickBook(slotId: string, eng: PaperMmEngine, raw: Crypto15mMarket): void {
    eng.onMarketTick(this.routeQuoteBook(slotId, eng, raw))
  }

  /**
   * Feed update: roll same-asset, free dead slots only when a non-empty open
   * ranked set exists, fill from ranked edge list.
   */
  syncMarketUniverse(markets: Crypto15mMarket[]): void {
    this.lastMarkets = markets
    this.refreshScan(markets)

    const openN = this.openCount(markets)
    const hasValidRanked = this.lastScan.length > 0

    // Empty / all-closed feed: never wipe live books or reshuffle by "top-N".
    // Still settle closed inventory so P&L is realized while we wait for refresh.
    if (openN === 0 || !hasValidRanked) {
      for (const [slotId, eng] of this.books) {
        const snap = eng.getState().snapshot
        const current =
          (snap.marketTicker && markets.find((m) => m.ticker === snap.marketTicker)) || null
        if (current) {
          this.tickBook(slotId, eng, current)
        } else if (!snap.settled) {
          eng.settleNow()
        }
      }
      // U2.14.1: always evaluate L2-off eviction when useLiveBook, even while holding
      // through empty/unranked feed (previously returned before maybeEvictL2Off).
      // Refill only when hasValidRanked — not on this early-return path.
      const l2DroppedEarly = this.maybeEvictL2Off()
      if (l2DroppedEarly.length > 0) {
        this.message = `U2.14: dropped ${l2DroppedEarly.join(', ')} — L2 off`
      } else if (this.books.size > 0) {
        this.message =
          openN === 0
            ? `Feed empty/stale — holding ${this.books.size} slot(s) until open crypto 15m refresh. Read-only · never places trades.`
            : `No ranked open edges yet — holding ${this.books.size} slot(s). Read-only · never places trades.`
      }
      // Still auto-resume if we restored wasRunning (even on empty feed — hold idle running).
      if (this.pendingAutoResume && !this.running) {
        this.start({ resume: true })
        return
      }
      this.emit()
      return
    }

    // 1) Roll or free each active book
    const toRemove: string[] = []
    for (const [slotId, eng] of this.books) {
      const snap = eng.getState().snapshot
      const currentTicker = snap.marketTicker
      const current =
        (currentTicker && markets.find((m) => m.ticker === currentTicker)) || null

      if (!current) {
        // Ticker vanished — try same-asset successor only; else free only if open set exists
        const asset = snap.asset
        const target = asset ? pickBestOpenMarket(markets, asset) : null
        if (target) {
          this.rollBook(slotId, eng, target)
        } else if (hasValidRanked) {
          toRemove.push(slotId)
        }
        continue
      }

      const target = pickRollTarget(markets, current)
      if (target && target.ticker !== current.ticker) {
        if (canonicalMmAsset(target.asset) === canonicalMmAsset(current.asset)) {
          this.rollBook(slotId, eng, target)
        } else if (!isMarketOpen(current) && hasValidRanked) {
          // Dead with only cross-asset option → free slot for next-best edge
          toRemove.push(slotId)
        } else {
          this.tickBook(slotId, eng, current)
        }
      } else if (!isMarketOpen(current)) {
        // Closed, no roll target — free only when we have a valid open ranked set
        if (hasValidRanked) {
          toRemove.push(slotId)
        } else {
          this.tickBook(slotId, eng, current)
        }
      } else {
        this.tickBook(slotId, eng, current)
      }
    }

    // Free dead slots only when the open ranked set still has unassigned assets
    // to refill — never dump into emptiness while open markets remain.
    const openRanked = this.lastScan
    const assignedAssets = new Set(
      [...this.books.values()]
        .map((e) => {
          const a = e.getState().snapshot.asset
          return a ? canonicalMmAsset(a) : undefined
        })
        .filter((a): a is string => Boolean(a)),
    )
    const hasUnassignedOpen = openRanked.some(
      (r) => !assignedAssets.has(canonicalMmAsset(r.asset)) && !this.slotOfTicker.has(r.ticker),
    )

    for (const slotId of toRemove) {
      // Always free dead books when there is something else to quote; if the
      // only open markets are already assigned, still free the dead one so
      // rebalance can attach a replacement / leave a hole that next refresh fills.
      this.removeBook(
        slotId,
        hasUnassignedOpen || openRanked.length > 0
          ? 'Book died with no same-asset roll — refilling slot from ranked open set.'
          : 'Book died with no same-asset roll — holding until open markets return.',
      )
    }

    // U2.14: drop flat L2-off books past threshold (slot evict); hold open inv.
    const l2Dropped = this.maybeEvictL2Off()

    // 2) Fill free slots / reshuffle only with a valid non-empty ranked set
    this.rebalanceSlots(markets)

    // Keep fail-loud U2.14 drop visible after refill overwrites addBook message.
    if (l2Dropped.length > 0) {
      this.message = `U2.14: dropped ${l2Dropped.join(', ')} — L2 off`
    }

    // 3) While RUNNING, always attempt to fill empty slots every refresh
    if (this.running && this.books.size < this.config.maxActiveMarkets && openRanked.length > 0) {
      this.rebalanceSlots(markets)
    }

    const after = this.books.size
    if (
      this.running &&
      after < Math.min(this.config.maxActiveMarkets, openRanked.length) &&
      openRanked.length > 0
    ) {
      // U2.14.1: under-fill must not erase the fail-loud U2.14 drop strip.
      if (l2Dropped.length === 0) {
        this.message =
          `Multi-book under-filled (${after}/${this.config.maxActiveMarkets}) — ` +
          `retrying fill from ${openRanked.length} open ranked. Read-only · never places trades.`
      }
      this.rebalanceSlots(markets)
    }

    // Auto-resume after reload: never leave STOPPED just because windows flipped / page remounted.
    if (this.pendingAutoResume && !this.running) {
      this.start({ resume: true })
      return
    }

    this.emit()
  }


  /**
   * U2.14 / U2.14.1 — after l2OffDropTicks consecutive syncs with useLiveBook && !liveBook:
   * flat inventory → drop slot (SLOT_EVICT / L2_OFF_EVICT) and let rebalanceSlots
   * refill from ranked open set (when ranked set exists). Open inventory → hold with
   * fail-loud row status (never invent flatten prices without L2).
   * Called on the main sync path and on the empty/unranked early-return path (U2.14.1).
   * @returns tickers dropped this pass (for fail-loud strip after refill).
   */
  private maybeEvictL2Off(): string[] {
    if (!this.config.useLiveBook) {
      this.l2OffTicksBySlot.clear()
      this.l2OffBlockedTickers.clear()
      return []
    }
    const threshold = Math.max(1, this.config.l2OffDropTicks)
    const toDrop: string[] = []
    for (const [slotId, eng] of this.books) {
      const snap = eng.getState().snapshot
      if (snap.liveBook) {
        this.l2OffTicksBySlot.set(slotId, 0)
        continue
      }
      const n = (this.l2OffTicksBySlot.get(slotId) ?? 0) + 1
      this.l2OffTicksBySlot.set(slotId, n)
      if (n < threshold) continue
      const inv = snap.inventory ?? 0
      if (inv !== 0) {
        eng.noteL2OffHoldingInv()
        continue
      }
      toDrop.push(slotId)
    }
    const dropped: string[] = []
    for (const slotId of toDrop) {
      const eng = this.books.get(slotId)
      const t = eng?.getState().snapshot.marketTicker ?? '?'
      if (t && t !== '?') this.l2OffBlockedTickers.add(t)
      dropped.push(t)
      this.removeBook(slotId, `U2.14: dropped ${t} — L2 off`)
    }
    return dropped
  }


  /** Test helper — engine for a ticker or slotId (U2.14 / portfolio tests). */
  getEngineForTests(tickerOrSlot: string): PaperMmEngine | null {
    if (this.books.has(tickerOrSlot)) return this.books.get(tickerOrSlot) ?? null
    const slot = this.slotOfTicker.get(tickerOrSlot)
    return slot ? this.books.get(slot) ?? null : null
  }

  /** Test helper — consecutive L2-off sync ticks for a slot. */
  getL2OffTicksForTests(slotId: string): number {
    return this.l2OffTicksBySlot.get(slotId) ?? 0
  }

  private rollBook(slotId: string, eng: PaperMmEngine, target: Crypto15mMarket): void {
    const prev = eng.getState().snapshot.marketTicker
    if (prev) this.slotOfTicker.delete(prev)
    // Flat after settle-on-roll; re-resolve book for the new window.
    this.quoteBookSticky.delete(slotId)
    const mapped = this.routeQuoteBook(slotId, eng, target)
    eng.rollToMarket(mapped)
    this.slotOfTicker.set(target.ticker, slotId)
    const spotKey = normalizeSpotAsset(target.asset)
    const spot = spotKey != null ? this.spotsByAsset[spotKey] : undefined
    if (spot != null) eng.seedSpot(spot)
    this.message =
      `Rolled ${prev ?? '?'} → ${target.ticker} (same asset). Read-only · never places trades.`
  }

  /**
   * Settle inventory, bank session realized/fees/fills, then stop & drop the book.
   * Historical session totals are preserved in sessionLedger.
   */
  private removeBook(slotId: string, reason: string): void {
    const eng = this.books.get(slotId)
    if (!eng) return
    this.quoteBookSticky.delete(slotId)
    this.l2OffTicksBySlot.delete(slotId)
    eng.settleNow()
    this.bankEngineIntoSession(eng)
    const t = eng.getState().snapshot.marketTicker
    eng.stop()
    this.unsubEngine(eng)
    this.books.delete(slotId)
    if (t) this.slotOfTicker.delete(t)
    this.refreshPortfolioFillCap()
    this.message = reason
  }

  private bankEngineIntoSession(eng: PaperMmEngine): void {
    const st = eng.getState()
    this.sessionLedger.realizedSpreadPnl += st.snapshot.realizedSpreadPnl
    this.sessionLedger.feesPaid += st.snapshot.feesPaid
    this.sessionLedger.fillCount += st.snapshot.fillCount
    this.sessionLedger.cancelCount += st.snapshot.cancelCount
    for (const f of st.fills) {
      this.sessionLedger.fills.push(f)
    }
    for (const c of st.cancels) {
      this.sessionLedger.cancels.push(c)
    }
    // Cap journal size
    if (this.sessionLedger.fills.length > 1000) {
      this.sessionLedger.fills.splice(0, this.sessionLedger.fills.length - 1000)
    }
    if (this.sessionLedger.cancels.length > 500) {
      this.sessionLedger.cancels.splice(0, this.sessionLedger.cancels.length - 500)
    }
  }

  private rebalanceSlots(markets: Crypto15mMarket[]): void {
    this.refreshScan(markets)

    // CRITICAL: never release books as "outside top-N" on an empty/stale ranking
    if (this.lastScan.length === 0) {
      return
    }

    const sticky = [...this.slotOfTicker.keys()]
    const inventoryByTicker: Record<string, number> = {}
    for (const eng of this.books.values()) {
      const snap = eng.getState().snapshot
      if (snap.marketTicker) inventoryByTicker[snap.marketTicker] = snap.inventory
    }
    // U2.14: drop blocked tickers that left the universe; keep others excluded from refill.
    const universeTickers = new Set(markets.map((m) => m.ticker))
    for (const t of [...this.l2OffBlockedTickers]) {
      if (!universeTickers.has(t)) this.l2OffBlockedTickers.delete(t)
    }

    const desired = pickActiveMarkets(this.lastScan, {
      maxActive: this.config.maxActiveMarkets,
      stickyTickers: sticky,
      onePerAsset: true,
      requireEdge: this.config.fvQuoting,
      fillMidFallback: this.config.fillMidFallback,
      inventoryByTicker,
      evictSanityFlat: true,
      excludeTickers: [...this.l2OffBlockedTickers],
    })

    // Still nothing quoteable / pickable — hold sticky books, do not wipe
    if (desired.length === 0) {
      return
    }

    const desiredTickers = new Set(desired.map((m) => m.ticker))
    const scanByTicker = new Map(this.lastScan.map((r) => [r.ticker, r]))

    // Drop books not in desired — only when replacement set is non-empty AND
    // dropping would not leave us with fewer books than we can refill.
    const pendingDrops: string[] = []
    for (const [slotId, eng] of [...this.books.entries()]) {
      const t = eng.getState().snapshot.marketTicker
      if (t && !desiredTickers.has(t)) {
        pendingDrops.push(slotId)
      }
    }
    for (const slotId of pendingDrops) {
      const eng = this.books.get(slotId)
      const t = eng?.getState().snapshot.marketTicker
      const row = t ? scanByTicker.get(t) : undefined
      const inv = t ? inventoryByTicker[t] ?? 0 : 0
      const evictNote =
        row?.sanityPark && inv === 0
          ? `SLOT_EVICT sanity+flat; `
          : ''
      this.removeBook(
        slotId,
        `Slot released (${t ?? '?'}) — ${evictNote}outside top-${this.config.maxActiveMarkets} set; refilling.`,
      )
    }

    // Add missing — fill up to min(open ranked, maxActive)
    for (const m of desired) {
      if (this.slotOfTicker.has(m.ticker)) continue
      if (this.books.size >= this.config.maxActiveMarkets) break
      this.addBook(m)
    }
  }

  private addBook(market: Crypto15mMarket): void {
    if (this.slotOfTicker.has(market.ticker)) return
    if (this.books.size >= this.config.maxActiveMarkets) return

    const slotId = nextSlotId()
    const eng = new PaperMmEngine()
    eng.setFillCapStore(this.fillCapStore)
    eng.setConfig(this.config)
    const mapped = this.routeQuoteBook(slotId, eng, market)
    eng.setMarket(mapped)
    // New book: cash/inventory start fresh; session ledger keeps historical realized/fills
    const spotKey = normalizeSpotAsset(market.asset)
    const spot = spotKey != null ? this.spotsByAsset[spotKey] : undefined
    if (spot != null) eng.seedSpot(spot)

    const unsub = eng.subscribe(() => this.emit())
    this.unsubs.push(unsub)
    ;(eng as unknown as { __portfolioUnsub?: () => void }).__portfolioUnsub = unsub

    this.books.set(slotId, eng)
    this.slotOfTicker.set(market.ticker, slotId)
    this.refreshPortfolioFillCap()

    if (this.running) eng.start()
    this.message = !this.config.quotingEnabled
      ? QUOTING_PAUSED_REASON
      : (
          `Watching ${market.ticker} (${market.asset}) — multi-book slot ${this.books.size}/` +
          `${this.config.maxActiveMarkets}. Read-only · never places trades.`
        )
  }

  private unsubEngine(eng: PaperMmEngine): void {
    const u = (eng as unknown as { __portfolioUnsub?: () => void }).__portfolioUnsub
    if (u) {
      u()
      delete (eng as unknown as { __portfolioUnsub?: () => void }).__portfolioUnsub
    }
  }

  private refreshScan(markets: Crypto15mMarket[]): void {
    this.lastScan = rankMarketsByAbsEdge(
      markets,
      this.spotsByAsset,
      this.config.annualVol,
      this.config.minEdgeCents,
      Date.now(),
      this.config.maxSaneEdgeCents,
    )
  }

  /**
   * Start paper MM. Pass `{ resume: true }` after localStorage restore so
   * sessionStartedAt / ledger are preserved (refresh must not look like a wipe).
   */
  start(opts?: { resume?: boolean }): void {
    this.running = true
    this.pendingAutoResume = false
    if (!opts?.resume || this.sessionStartedAt == null) {
      this.sessionStartedAt = Date.now()
    }
    this.message = !this.config.quotingEnabled
      ? QUOTING_PAUSED_REASON
      : (
          'Multi-book paper MM running (house mid). Scans open crypto 15m; ' +
          `up to ${this.config.maxActiveMarkets} books. ` +
          'Read-only · never places trades.'
        )
    if (this.lastMarkets.length > 0 && this.openCount(this.lastMarkets) > 0) {
      this.rebalanceSlots(this.lastMarkets)
    }
    for (const eng of this.books.values()) {
      if (!eng.getState().snapshot.running) eng.start()
    }
    this.armTimers()
    void this.pollAllSpots()
    this.emit()
  }

  /**
   * If localStorage said wasRunning, start after universe sync without wiping ledger.
   * Safe to call repeatedly — no-ops when not pending or already running.
   */
  tryAutoResumeAfterSync(): boolean {
    if (!this.pendingAutoResume || this.running) return false
    this.start({ resume: true })
    return true
  }

  stop(): void {
    this.running = false
    this.pendingAutoResume = false
    this.clearTimers()
    for (const eng of this.books.values()) eng.stop()
    this.message = 'Multi-book stopped. Quotes cancelled (paper). Read-only · never places trades.'
    this.emit()
  }

  resetSession(): void {
    this.stop()
    for (const slotId of [...this.books.keys()]) {
      // Reset wipes session — bank then discard ledger below
      const eng = this.books.get(slotId)
      if (eng) {
        eng.stop()
        this.unsubEngine(eng)
      }
      this.books.delete(slotId)
    }
    this.quoteBookSticky.clear()
    this.l2OffTicksBySlot.clear()
    this.books.clear()
    this.slotOfTicker.clear()
    this.sessionLedger = emptyLedger()
    this.sessionStartedAt = null
    this.pendingAutoResume = false
    this.fillCapStore = new TickerFillCapStore(Date.now())
    this.refreshPortfolioFillCap()
    this.message =
      'Multi-book session reset. Paper books cleared. Read-only · never places trades.'
    if (this.lastMarkets.length > 0) {
      this.refreshScan(this.lastMarkets)
    }
    this.emit()
    // Clear after emit so persistNow cannot re-write an empty shell.
    clearPaperMmSession()
  }

  private armTimers(): void {
    this.clearTimers()
    this.spotTimer = window.setInterval(() => {
      void this.pollAllSpots()
    }, this.config.spotPollMs)
    this.syncTimer = window.setInterval(() => {
      if (this.lastMarkets.length > 0) {
        this.syncMarketUniverse(this.lastMarkets)
      }
    }, Math.max(2000, this.config.quoteRefreshMs))
  }

  private clearTimers(): void {
    if (this.spotTimer != null) {
      window.clearInterval(this.spotTimer)
      this.spotTimer = null
    }
    if (this.syncTimer != null) {
      window.clearInterval(this.syncTimer)
      this.syncTimer = null
    }
  }

  private async pollAllSpots(): Promise<void> {
    const assets = new Set<string>()
    for (const m of this.lastMarkets) {
      if (!isMarketOpen(m)) continue
      const key = normalizeSpotAsset(m.asset)
      if (key) assets.add(key)
    }
    for (const a of assets) {
      try {
        const tick = await fetchPublicSpot(a)
        this.spotsByAsset[a] = tick.price
        for (const eng of this.books.values()) {
          const snap = eng.getState().snapshot
          if (snap.asset && normalizeSpotAsset(snap.asset) === a) {
            eng.seedSpot(tick.price, tick.source)
          }
        }
      } catch {
        /* keep last spot — never invent BTC for foreign assets */
      }
    }
    if (this.lastMarkets.length > 0) {
      this.refreshScan(this.lastMarkets)
      if (this.running && this.openCount(this.lastMarkets) > 0 && this.lastScan.length > 0) {
        this.rebalanceSlots(this.lastMarkets)
      }
    }
    this.emit()
  }
}

/** Singleton multi-book controller for the lab panel. */
export const paperMmPortfolio = new PaperMmPortfolio()

/** Convenience: single-engine state shape adapter unused — UI talks to portfolio directly. */
export type { MmEngineState }
