/**
 * Paper crypto 15m market maker — simulate quotes, fills, and spot-guard cancels.
 * Does NOT place live Kalshi orders.
 *
 * Near-real mode: polls read-only L2 via local proxy; fills from book depth / mid walk.
 * Soft-sim fallback when proxy is down (strict: rare random fills).
 *
 * P&L units: all YES prices are dollars on [0, 1]. Unrealized = inventory * (mid - avgEntry).
 * Never multiply by 100 in P&L paths.
 */

import type { Crypto15mMarket } from '../../../types/crypto15m'
import { estimateFillFeeDollars } from '../fees'
import { SpotHistory, fetchPublicSpot, type SpotTick } from '../spot'
import {
  DEFAULT_PAPER_MM_CONFIG,
  clampConfig,
  presetsForMode,
  type PaperMmConfig,
} from './config'
import {
  detectBookFills,
  DEFAULT_DETECT_STATE,
  type DetectBookFillsState,
  type OrderBookSnapshot,
} from './orderbook'
import { fetchLiveOrderbook, fetchLocalHealth } from './liveBook'
import { asDollarPrice, isValidQuoteMid } from './prices'
import { pickRollTarget } from './marketSelect'
import { isToxicExtremeMid } from './toxicity'
import { edgeVsMidCents, estimateYesFairValue, resolveStrike } from './fairValue'
import {
  canAcceptInventoryIncreasingFill,
  decideQuoteSides,
  QUOTING_PAUSED_REASON,
  U312_BLACKOUT_FLATTEN,
  U31_NO_SPOT,
  U31_NO_STRIKE,
  U31_NO_TAU,
  U32_HOUSE_MID,
  DEFAULT_DECISION_POLICY,
  emptyEdgePersistState,
  emptyStuckUnwindState,
  type DecisionPolicyConfig,
  type EdgePersistState,
  type StuckUnwindState,
  isFlattenHouseTag,
  U321_STUCK_NO_BID,
  U321_STUCK_NO_ASK,
  U323_LONG_OPEN_CURB,
  U323_NO_LATE_OPENS,
  DEFAULT_LONG_OPEN_MIN_MID,
  toHouseFillTag,
} from './decisionPolicy'
import { evaluateClose } from './profitableScenarios'
import type {
  MmCancelEvent,
  MmEngineState,
  MmFill,
  MmGuardAction,
  MmQuote,
  MmSnapshot,
} from './types'
import {
  FILL_CAP_MINUTE_MS,
  FILL_CAP_WINDOW_MS,
  TickerFillCapStore,
  isHarshFillRateSoftWarn,
} from './fillCaps'

let idSeq = 0
function nextId(prefix: string): string {
  idSeq += 1
  return `${prefix}-${Date.now()}-${idSeq}`
}

/**
 * Official YES settlement price.
 * Fail closed: without an explicit result, mark to mid (no invented binary 0/1).
 * Inventing YES=1 from mid≥0.5 was a soft P&L path.
 */
function settlementYesPrice(market: Crypto15mMarket): number {
  const result = (market.raw?.result ?? '').toLowerCase()
  if (result === 'yes') return 1
  if (result === 'no') return 0
  return asDollarPrice(market.midYes, 'settle.markMid')
}

function marketLooksSettled(market: Crypto15mMarket): boolean {
  const st = (market.status ?? '').toLowerCase()
  if (st === 'settled' || st === 'finalized' || st === 'determined') return true
  if (st === 'closed' && market.raw?.result) return true
  if (market.minutesRemaining <= 0) return true
  const closeMs = Date.parse(market.closeTime)
  if (Number.isFinite(closeMs) && Date.now() >= closeMs) return true
  return false
}

function clampProb(p: number): number {
  return Math.min(0.95, Math.max(0, p))
}

export class PaperMmEngine {
  private config: PaperMmConfig = { ...DEFAULT_PAPER_MM_CONFIG }
  private running = false
  private market: Crypto15mMarket | null = null
  private inventory = 0
  private cash = DEFAULT_PAPER_MM_CONFIG.startingCash
  private realizedSpreadPnl = 0
  private feesPaid = 0
  private avgEntry: number | null = null
  private quote: MmQuote | null = null
  private fills: MmFill[] = []
  private cancels: MmCancelEvent[] = []
  private spotHist = new SpotHistory(180)
  private lastSpot: SpotTick | null = null
  private lastMid: number | null = null
  private lastQuoteAt = 0
  private guardActiveUntil = 0
  private guardMode: MmGuardAction | null = null
  private lastTickAt: number | null = null
  private sessionStartedAt: number | null = null
  private settled = false
  private midCrossRejectCount = 0
  private message = 'Idle — pick a market and Start paper MM.'
  private spotTimer: number | null = null
  private quoteTimer: number | null = null
  private bookTimer: number | null = null
  private listeners = new Set<() => void>()
  private prevBook: OrderBookSnapshot | null = null
  private liveBook = false
  private liveBookAuthenticated = false
  /**
   * U2.14.1: portfolio called noteL2OffHoldingInv — pollBook / soft-sim must not
   * overwrite with U2.13 while inventory remains open.
   */
  private holdingInvForL2Off = false
  /**
   * U2.14.1: last mid from a real L2 onBook. When useLiveBook && !liveBook, freeze
   * mark to this (do not adopt extreme feed 0¢/100¢ mids for unrealized).
   */
  private lastLiveMarkMid: number | null = null
  private bookBestBid: number | null = null
  private bookBestAsk: number | null = null
  private unitsWarning: string | null = null
  private lastUnrealizedAbs = 0
  private lastFillAt = 0
  /**
   * Per-ticker fill caps (shared with portfolio when multi-book).
   * Survives sync/rebuild/start; keyed by ticker across 15m windows.
   */
  private fillCapStore: TickerFillCapStore = new TickerFillCapStore()
  /** When true, resetSession clears the store; portfolio may own the store. */
  private ownsFillCapStore = true
  private midWalkState: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
  private moneyPrinterBug = false
  private lastFairValue: number | null = null
  private lastEdgeVsMidCents: number | null = null
  private lastFvCenterActive = false
  private lastTotalPnl = 0
  private lastTotalPnlAt = 0
  /** Temporary bid pull after toxic buy_yes fill. */
  private toxicBidPullUntil = 0
  /** Temporary ask pull after toxic sell_yes fill. */
  private toxicAskPullUntil = 0
  /** Edge persistence counters across quote rebuilds. */
  private edgePersistState: EdgePersistState = emptyEdgePersistState()
  /** S4.1 / S4.2 stuck-unwind counters across quote rebuilds. */
  private stuckUnwindState: StuckUnwindState = emptyStuckUnwindState()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  getConfig(): PaperMmConfig {
    return { ...this.config }
  }

  setConfig(partial: Partial<PaperMmConfig>): void {
    if (partial.strictRealism !== undefined && partial.strictRealism !== this.config.strictRealism) {
      partial = { ...presetsForMode(partial.strictRealism), ...partial }
    }
    const prevSide = this.config.quoteBookSide
    this.config = clampConfig({ ...this.config, ...partial })
    if (
      partial.quoteBookSide !== undefined &&
      this.config.quoteBookSide !== prevSide
    ) {
      // Side flip — drop YES queueAhead on NO book (and vice versa).
      this.midWalkState = { ...DEFAULT_DETECT_STATE }
      this.prevBook = null
      this.liveBook = false
      this.bookBestBid = null
      this.bookBestAsk = null
    }
    if (!this.running) {
      this.cash = this.config.startingCash
    }
    this.rebuildQuote(true)
    if (this.running) this.armTimers()
    this.emit()
  }

  /** U2.13: set primary L2 side; resets queue walk when side flips. */
  setQuoteBookSide(side: 'yes' | 'no'): void {
    this.setConfig({ quoteBookSide: side === 'no' ? 'no' : 'yes' })
  }

  setStrictRealism(strict: boolean): void {
    this.setConfig({ strictRealism: strict })
  }

  /** Inject shared portfolio fill-cap store (multi-book). */
  setFillCapStore(store: TickerFillCapStore): void {
    this.fillCapStore = store
    this.ownsFillCapStore = false
  }

  getFillCapStore(): TickerFillCapStore {
    return this.fillCapStore
  }

  getState(): MmEngineState {
    return {
      snapshot: this.snapshot(),
      fills: [...this.fills].slice(-200).reverse(),
      cancels: [...this.cancels].slice(-100).reverse(),
    }
  }


  private activeTicker(): string | null {
    return this.market?.ticker ?? null
  }

  private countFillsInWindow(now: number, windowMs: number): number {
    const t = this.activeTicker()
    if (!t) return 0
    return this.fillCapStore.countInWindow(t, now, windowMs)
  }

  private canAcceptFillByRateCaps(now: number): { ok: boolean; reason?: string } {
    return this.fillCapStore.canAccept(
      this.activeTicker(),
      now,
      this.config.maxFillsPerMinute,
      this.config.maxFillsPerMarketPer15m,
      this.fillCapStore.getPortfolioCap15m(),
    )
  }

  /** Sum captureDollars / avg ¢ for fills in last 15m (excludes settlement). */
  private captureStatsLast15m(now = Date.now()): {
    realizedDelta: number
    avgCentsPerFill: number
    fillCount: number
  } {
    const cut = now - FILL_CAP_WINDOW_MS
    let realized = 0
    let n = 0
    for (const f of this.fills) {
      if (f.reason === 'settlement') continue
      if (f.t < cut) continue
      n += 1
      realized += f.captureDollars ?? 0
    }
    return {
      realizedDelta: realized,
      avgCentsPerFill: n > 0 ? (realized / n) * 100 : 0,
      fillCount: n,
    }
  }

  /** Legacy session fills/hour (may include pre-migration fills in journal). */
  private fillsPerHourNow(now = Date.now()): number {
    const started = this.sessionStartedAt
    const n = this.fills.filter((f) => f.reason !== 'settlement').length
    if (started == null) return 0
    const hours = Math.max(1 / 3600, (now - started) / 3_600_000)
    return n / hours
  }

  private harshFillsPerHourNow(now = Date.now()): number {
    return this.fillCapStore.harshFillsPerHour(now, this.activeTicker())
  }

  private midDollars(): number {
    // U2.14.1: freeze mark to last live L2 mid while L2 is off (avoid 0¢/100¢ feed).
    if (this.config.useLiveBook && !this.liveBook && this.lastLiveMarkMid != null) {
      return asDollarPrice(this.lastLiveMarkMid, 'frozenLiveMark')
    }
    if (this.prevBook) return asDollarPrice(this.prevBook.mid, 'book.mid')
    return asDollarPrice(this.market?.midYes ?? 0.5, 'market.midYes')
  }

  private unrealizedDollars(mid: number): number {
    // U2.14.1: no honest L2 mark yet → do not invent unrealized from extreme feed mid.
    if (this.config.useLiveBook && !this.liveBook && this.lastLiveMarkMid == null) {
      return 0
    }
    const m = asDollarPrice(mid, 'unrealized.mid')
    if (this.inventory === 0 || this.avgEntry == null) return 0
    const entry = asDollarPrice(this.avgEntry, 'unrealized.avgEntry')
    // dollars: contracts * (price dollars). NEVER * 100.
    return this.inventory * (m - entry)
  }

  private snapshot(): MmSnapshot {
    const mid = this.midDollars()
    let unrealized = this.unrealizedDollars(mid)

    // Guard: Total/unrealized must not silently 50× on a single mid tick from bad units.
    const absU = Math.abs(unrealized)
    if (
      this.lastUnrealizedAbs > 0.05 &&
      absU > this.lastUnrealizedAbs * 40 &&
      absU > 2
    ) {
      const msg = `P&L spike blocked: unrealized $${absU.toFixed(2)} vs prior $${this.lastUnrealizedAbs.toFixed(2)} — check mid/avgEntry units (must be dollars 0–1). mid=${mid} avg=${this.avgEntry}`
      console.warn(`[paper-mm] ${msg}`)
      this.unitsWarning = msg
      unrealized = Math.sign(unrealized) * this.lastUnrealizedAbs
    } else {
      this.lastUnrealizedAbs = absU
    }

    return {
      running: this.running,
      marketTicker: this.market?.ticker ?? null,
      marketCloseTime: this.market?.closeTime ?? null,
      asset: this.market?.asset ?? null,
      config: { ...this.config },
      quote: this.quote ? { ...this.quote } : null,
      inventory: this.inventory,
      cash: this.cash,
      midYes: mid,
      spotPrice: this.lastSpot?.price ?? null,
      spotSource: this.lastSpot?.source ?? null,
      realizedSpreadPnl: this.realizedSpreadPnl,
      feesPaid: this.feesPaid,
      unrealizedInventoryPnl: unrealized,
      avgEntry: this.avgEntry,
      fillCount: this.fills.length,
      cancelCount: this.cancels.length,
      midCrossRejectCount: this.midCrossRejectCount,
      guardActiveUntil: this.guardActiveUntil,
      guardMode: this.guardMode,
      lastTickAt: this.lastTickAt,
      sessionStartedAt: this.sessionStartedAt,
      settled: this.settled,
      message: this.message,
      liveBook: this.liveBook,
      liveBookAuthenticated: this.liveBookAuthenticated,
      quoteBookSide: this.config.quoteBookSide === 'no' ? 'no' : 'yes',
      bookBestBid: this.bookBestBid,
      bookBestAsk: this.bookBestAsk,
      unitsWarning: this.unitsWarning,
      moneyPrinterBug: this.moneyPrinterBug,
      fairValue: this.lastFairValue,
      edgeVsMidCents: this.lastEdgeVsMidCents,
      floorStrike: this.market?.floorStrike ?? null,
      minutesRemaining: this.market?.minutesRemaining ?? null,
      fvCenterActive: this.lastFvCenterActive,
      fillsPerHour: this.fillsPerHourNow(),
      fillsLastMinute: this.countFillsInWindow(Date.now(), FILL_CAP_MINUTE_MS),
      fillsLast15m: this.countFillsInWindow(Date.now(), FILL_CAP_WINDOW_MS),
      harshFillsPerHour: this.harshFillsPerHourNow(),
      harshFillsLast15m: this.fillCapStore.countHarshInWindow(
        Date.now(),
        FILL_CAP_WINDOW_MS,
        this.activeTicker(),
      ),
      harshPolicyEpochMs: this.fillCapStore.getHarshPolicyEpochMs(),
      fillRateUnrealistic: this.isFillRateUnrealistic(),
      realizedDeltaLast15m: this.captureStatsLast15m().realizedDelta,
      avgCaptureCentsPerFillLast15m: this.captureStatsLast15m().avgCentsPerFill,
      portfolioFillCap15m: this.fillCapStore.getPortfolioCap15m(),
      stuckTicks: (() => {
        const invSign = this.inventory > 0 ? 1 : this.inventory < 0 ? -1 : 0
        if (invSign === 0) return 0
        return this.stuckUnwindState.invSign === invSign ? this.stuckUnwindState.ticks : 0
      })(),
    }
  }

  private isFillRateUnrealistic(): boolean {
    // Soft warn from rolling 15m harsh fills only — never short-session /hr.
    const last15 = this.fillCapStore.countHarshInWindow(
      Date.now(),
      FILL_CAP_WINDOW_MS,
      this.activeTicker(),
    )
    return isHarshFillRateSoftWarn(last15, {
      strictRealism: this.config.strictRealism,
      activeBooks: 1,
      maxFillsPerMarketPer15m: this.config.maxFillsPerMarketPer15m,
    })
  }

  setMarket(market: Crypto15mMarket | null): void {
    const prevTicker = this.market?.ticker ?? null
    const changed = market?.ticker !== prevTicker
    // Always settle open inventory before leaving a ticker — never zero without realizing.
    if (changed && this.market && this.inventory !== 0 && !this.settled) {
      this.settleInventory(this.market, {
        keepRunning: this.running && Boolean(market),
      })
    }
    this.market = market
    if (changed) {
      this.lastMid = market ? asDollarPrice(market.midYes, 'setMarket.mid') : null
      this.spotHist.clear()
      this.lastSpot = null
      this.settled = false
      this.prevBook = null
      this.bookBestBid = null
      this.bookBestAsk = null
      this.liveBook = false
      this.holdingInvForL2Off = false
      this.lastLiveMarkMid = null
      this.midWalkState = { ...DEFAULT_DETECT_STATE }
      this.lastFillAt = 0
      // Do NOT clear fillCapStore — per-ticker caps must survive roll/rebuild.
      // Fresh ticker naturally has an empty window; old ticker stays capped.
      // Inventory must already be flat after settle; refuse silent wipe of open risk.
      if (this.inventory !== 0) {
        console.warn(
          `[paper-mm] setMarket refused silent inventory wipe (inv=${this.inventory}) — forcing mid mark`,
        )
        if (this.avgEntry != null) {
          const mid = asDollarPrice(this.lastMid ?? 0.5, 'setMarket.forceMark')
          const size = Math.abs(this.inventory)
          const entry = asDollarPrice(this.avgEntry, 'setMarket.forceEntry')
          const pnlPer = this.inventory > 0 ? mid - entry : entry - mid
          this.realizedSpreadPnl += pnlPer * size
          if (this.inventory > 0) this.cash += mid * size
          else this.cash -= mid * size
        }
      }
      this.inventory = 0
      this.avgEntry = null
      this.quote = null
      this.lastUnrealizedAbs = 0
      this.unitsWarning = null
      this.moneyPrinterBug = false
      this.lastFairValue = null
      this.lastEdgeVsMidCents = null
      this.lastFvCenterActive = false
      this.lastTotalPnl = 0
      this.lastTotalPnlAt = 0
      this.toxicBidPullUntil = 0
      this.toxicAskPullUntil = 0
    this.edgePersistState = emptyEdgePersistState()
    this.stuckUnwindState = emptyStuckUnwindState()
      if (prevTicker && market) {
        this.message =
          `Rolled to ${market.ticker} (from ${prevTicker}) · close ${market.closeTime} · ` +
          `inventory/quotes reset. Read-only API · never places trades.`
      }
      if (this.running && market) {
        this.rebuildQuote(true)
        void this.pollSpot()
        void this.pollBook()
      }
    } else if (market) {
      this.onMarketTick(market)
    }
    this.emit()
  }

  /**
   * Given the latest open-market feed, settle+roll when the active contract is
   * dead or a newer same-asset 15m window appears. Keeps the engine running.
   * @returns ticker after sync (may be unchanged)
   */
  syncMarketUniverse(markets: Crypto15mMarket[]): string | null {
    const target = pickRollTarget(markets, this.market)
    if (!target) {
      // Refresh current mid/status if still in feed
      if (this.market) {
        const fresh = markets.find((m) => m.ticker === this.market!.ticker)
        if (fresh) this.onMarketTick(fresh)
      }
      return this.market?.ticker ?? null
    }
    if (target.ticker === this.market?.ticker) {
      this.onMarketTick(target)
      return target.ticker
    }
    this.rollToMarket(target)
    return target.ticker
  }

  /** Settle open inventory if needed, switch ticker, reset quotes, keep running. */
  rollToMarket(market: Crypto15mMarket): void {
    const wasRunning = this.running
    this.setMarket(market)
    this.settled = false
    if (wasRunning) {
      this.running = true
      this.sessionStartedAt = this.sessionStartedAt ?? Date.now()
      this.rebuildQuote(true)
      this.armTimers()
      void this.pollSpot()
      void this.pollBook()
    }
    this.emit()
  }

  start(): void {
    if (!this.market) {
      this.message = 'Select a crypto 15m market first.'
      this.emit()
      return
    }
    this.running = true
    this.settled = false
    this.sessionStartedAt = Date.now()
    this.unitsWarning = null
    this.lastUnrealizedAbs = 0
    this.moneyPrinterBug = false
      this.lastFairValue = null
      this.lastEdgeVsMidCents = null
      this.lastFvCenterActive = false
    this.lastTotalPnl = 0
    this.lastTotalPnlAt = 0
    this.lastFillAt = 0
    // Keep fillCapStore — caps must survive start/rebuild/sync.
    this.midWalkState = { ...DEFAULT_DETECT_STATE }
    this.message = !this.config.quotingEnabled
      ? QUOTING_PAUSED_REASON
      : this.config.strictRealism
        ? 'Paper MM running (strict realism · house mid). Read-only API · never places trades.'
        : 'Paper MM running (LOOSE · house mid). Fills soft — not live edge.'
    this.rebuildQuote(true)
    this.armTimers()
    void this.pollSpot()
    void this.pollBook()
    void this.refreshProxyHealth()
    this.emit()
  }

  stop(): void {
    this.running = false
    this.clearTimers()
    if (this.quote) {
      this.quote = { ...this.quote, active: false, bidActive: false, askActive: false }
    }
    this.guardMode = null
    this.guardActiveUntil = 0
    this.message = 'Stopped. Quotes cancelled (paper). Read-only API · never places trades.'
    this.emit()
  }

  resetSession(): void {
    this.stop()
    this.inventory = 0
    this.cash = this.config.startingCash
    this.realizedSpreadPnl = 0
    this.feesPaid = 0
    this.avgEntry = null
    this.fills = []
    this.cancels = []
    this.quote = null
    this.spotHist.clear()
    this.lastSpot = null
    this.sessionStartedAt = null
    this.settled = false
    this.midCrossRejectCount = 0
    this.prevBook = null
    this.holdingInvForL2Off = false
    this.lastLiveMarkMid = null
    this.unitsWarning = null
    this.lastUnrealizedAbs = 0
    this.moneyPrinterBug = false
      this.lastFairValue = null
      this.lastEdgeVsMidCents = null
      this.lastFvCenterActive = false
    this.lastTotalPnl = 0
    this.lastTotalPnlAt = 0
    this.toxicBidPullUntil = 0
    this.toxicAskPullUntil = 0
    this.edgePersistState = emptyEdgePersistState()
    this.stuckUnwindState = emptyStuckUnwindState()
    this.lastFillAt = 0
    if (this.ownsFillCapStore) {
      this.fillCapStore = new TickerFillCapStore(Date.now())
    } else {
      // Shared store: reset harsh-era marker; ticker caps cleared by portfolio reset.
      this.fillCapStore.resetHarshPolicyEpoch(Date.now())
    }
    this.midWalkState = { ...DEFAULT_DETECT_STATE }
    this.message = 'Session reset. Paper cash restored. Read-only API · never places trades.'
    this.emit()
  }

  private armTimers(): void {
    this.clearTimers()
    this.spotTimer = window.setInterval(() => {
      void this.pollSpot()
    }, this.config.spotPollMs)
    this.quoteTimer = window.setInterval(() => {
      this.tick()
    }, Math.min(500, this.config.quoteRefreshMs))
    this.bookTimer = window.setInterval(() => {
      void this.pollBook()
    }, this.config.bookPollMs)
  }

  private clearTimers(): void {
    if (this.spotTimer != null) {
      window.clearInterval(this.spotTimer)
      this.spotTimer = null
    }
    if (this.quoteTimer != null) {
      window.clearInterval(this.quoteTimer)
      this.quoteTimer = null
    }
    if (this.bookTimer != null) {
      window.clearInterval(this.bookTimer)
      this.bookTimer = null
    }
  }

  private async refreshProxyHealth(): Promise<void> {
    const h = await fetchLocalHealth()
    if (h?.ok && h.credentialsLoaded) {
      this.liveBookAuthenticated = true
    }
  }

  private async pollSpot(): Promise<void> {
    if (!this.running || !this.market) return
    try {
      const tick = await fetchPublicSpot(this.market.asset)
      this.lastSpot = tick
      this.spotHist.push(tick.price, tick.t)
      this.evaluateSpotGuard()
      // Spot feeds FV — requote so edge gates track distance-to-strike
      this.rebuildQuote(false)
      this.emit()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Unsupported assets fail closed — clear any stale BTC/demo tick so FV cannot lie.
      if (/unsupported spot asset/i.test(msg)) {
        this.lastSpot = null
        this.message = `No spot for ${this.market.asset} — FV parked (not BTC).`
      } else {
        this.message = `Spot poll failed: ${msg}`
      }
      this.emit()
    }
  }

  private async pollBook(): Promise<void> {
    if (!this.running || !this.market || !this.config.useLiveBook || this.settled) return
    try {
      const book = await fetchLiveOrderbook(this.market.ticker, {
        side: this.config.quoteBookSide === 'no' ? 'no' : 'yes',
      })
      if (!book) {
        this.liveBook = false
        this.setL2OffNoSoftFillsMessage()
        this.emit()
        return
      }
      this.onBook(book)
    } catch (e) {
      this.liveBook = false
      this.setL2OffNoSoftFillsMessage(e instanceof Error ? e.message : String(e))
      this.emit()
    }
  }

  /** Ingest a real L2 snapshot — primary fill path when proxy is up. */
  onBook(book: OrderBookSnapshot): void {
    if (!this.running || this.settled) return
    if (this.market && book.ticker !== this.market.ticker) return

    this.liveBook = true
    this.liveBookAuthenticated = book.authenticated
    this.holdingInvForL2Off = false
    this.bookBestBid = asDollarPrice(book.bestBid, 'book.bestBid')
    this.bookBestAsk = asDollarPrice(book.bestAsk, 'book.bestAsk')
    this.lastTickAt = Date.now()

    const mid = asDollarPrice(book.mid, 'onBook.mid')
    this.lastLiveMarkMid = mid
    if (this.market) {
      // Keep market mid aligned to book mid (dollars)
      this.market = { ...this.market, midYes: mid, yesBid: book.bestBid, yesAsk: book.bestAsk }
    }

    if (this.config.settleOnClose && this.market && marketLooksSettled(this.market)) {
      this.settleInventory(this.market)
      this.prevBook = book
      this.emit()
      return
    }

    const midMoved =
      this.lastMid != null &&
      Math.abs(mid - this.lastMid) * 100 >= this.config.midMoveRequoteCents
    const due = Date.now() - this.lastQuoteAt >= this.config.quoteRefreshMs
    // U3.2.1: with inventory, always reprice on each book so flatten can hit the
    // live bid/ask (start() may have quoted with null BBO → false "stuck").
    const invNeedsBbo = this.inventory !== 0
    if (midMoved || due || !this.quote || invNeedsBbo) {
      this.rebuildQuote(false)
    }

    if (this.quote?.active && !this.moneyPrinterBug) {
      const now = Date.now()
      const cooling = now - this.lastFillAt < this.config.fillCooldownMs
      const flattenExit = isFlattenHouseTag(this.quote?.activeScenario)
      const rate = cooling
        ? { ok: false as const, reason: 'fill cooldown' }
        : flattenExit
          ? { ok: true as const }
          : this.canAcceptFillByRateCaps(now)
      if (!rate.ok && !cooling) {
        this.message =
          `FILL RATE CAP — ${rate.reason}. Harsh paper discipline · read-only.`
      }
      // Always run detectBookFills so size-ahead queue tracks depth while cooling / capped.
      const signals = detectBookFills(
        this.prevBook,
        book,
        this.quote,
        this.inventory,
        this.config.maxInventory,
        this.midWalkState,
        {
          // Strict realism (default): maker-only — never emit taker_cross fee bleed.
          allowTakerCross:
            !this.config.strictRealism ||
            isFlattenHouseTag(this.quote?.activeScenario),
          allowMidWalk: this.config.allowMidWalk,
          minBookDepthConsumed: this.config.minBookDepthConsumed,
          minTouchPolls: this.config.minTouchPolls,
          // When mid_walk is enabled, still require a long post-fill cooldown.
          midWalkCooldownMs: this.config.strictRealism
            ? Math.max(this.config.fillCooldownMs, 15_000)
            : 0,
          nowMs: now,
        },
      )
      // Hard cap: max 1 fill per book poll (detectBookFills already enforces)
      const sig = signals[0]
      if (sig && rate.ok && !cooling) {
        if (
          isToxicExtremeMid(
            sig.side,
            mid,
            this.config.toxicMidLow,
            this.config.toxicMidHigh,
            this.inventory,
          )
        ) {
          this.midCrossRejectCount += 1
          this.message =
            `TOXIC SKIP ${sig.reason} ${sig.side} @ mid $${mid.toFixed(4)} — adverse side pulled.`
          this.rebuildQuote(true)
        } else {
          const stats = this.spotHist.stats(this.config.spotWindowSec)
          const toxic =
            (sig.side === 'buy_yes' && stats.signedPct < -0.02) ||
            (sig.side === 'sell_yes' && stats.signedPct > 0.02)
          this.applyFill(
            sig.side,
            sig.price,
            sig.size,
            mid,
            toxic,
            sig.reason,
            sig.taker,
            { queueAhead: sig.queueAhead, fillSize: sig.fillSize ?? sig.size },
          )
          this.lastFillAt = now
          this.rebuildQuote(true)
        }
      }
    }

    this.prevBook = book
    this.lastMid = mid
    if (!this.config.quotingEnabled) {
      this.message = QUOTING_PAUSED_REASON
    } else if (
      !/U2\.14:\s*L2 off — holding inv/i.test(this.message) &&
      !/^U3\.(1|2)/.test(this.message)
    ) {
      this.message = this.liveBookAuthenticated
        ? 'LIVE BOOK (read-only) · never places trades'
        : 'LIVE BOOK via public/proxy · Read-only API · never places trades'
    }
    this.emit()
  }

  private evaluateSpotGuard(): void {
    if (!this.running) return
    const now = Date.now()
    const stats = this.spotHist.stats(this.config.spotWindowSec, now)
    if (stats.samples < 2) return

    const hitPct = stats.pctRange >= this.config.spotMovePct
    const hitDollar = stats.dollarRange >= this.config.spotMoveDollars
    if (!hitPct && !hitDollar) {
      if (now >= this.guardActiveUntil) {
        this.guardMode = null
      }
      return
    }

    const severity =
      stats.pctRange >= this.config.spotMovePct * 2 ||
      stats.dollarRange >= this.config.spotMoveDollars * 2
        ? 'cancel'
        : 'widen'

    const action: MmGuardAction = severity
    const reason =
      `Spot moved ${stats.pctRange.toFixed(3)}% / $${stats.dollarRange.toFixed(2)} ` +
      `in ${this.config.spotWindowSec}s (thr ${this.config.spotMovePct}% / $${this.config.spotMoveDollars})`

    if (action === 'cancel') {
      this.guardMode = 'cancel'
      this.guardActiveUntil = now + this.config.guardCancelMs
      if (this.quote?.active) {
        this.quote = { ...this.quote, active: false }
        this.pushCancel('cancel', reason, stats.pctRange, stats.dollarRange)
      }
    } else {
      this.guardMode = 'widen'
      this.guardActiveUntil = now + Math.max(1500, this.config.guardCancelMs / 2)
      this.pushCancel('widen', reason, stats.pctRange, stats.dollarRange)
      this.rebuildQuote(true)
    }

    if (this.inventory !== 0 && action === 'widen') {
      this.guardMode = 'skew'
    }
  }

  private pushCancel(
    action: MmGuardAction,
    reason: string,
    spotPct: number,
    spotDollar: number,
  ): void {
    this.cancels.push({
      id: nextId('cx'),
      t: Date.now(),
      action,
      reason,
      spotPct,
      spotDollar,
      spotPrice: this.lastSpot?.price ?? 0,
    })
    if (this.cancels.length > 300) this.cancels.splice(0, this.cancels.length - 300)
  }

  onMarketTick(market: Crypto15mMarket): void {
    if (this.market?.ticker !== market.ticker) return
    const feedMid = asDollarPrice(market.midYes, 'onMarketTick.mid')
    // U2.14.1: when useLiveBook && !liveBook, freeze mark to last live L2 mid —
    // do not adopt extreme feed mids (0¢/100¢ settled/empty window) for unrealized.
    const freezeMark =
      this.config.useLiveBook && !this.liveBook && this.lastLiveMarkMid != null
    const mid = freezeMark
      ? asDollarPrice(this.lastLiveMarkMid!, 'onMarketTick.frozenMark')
      : feedMid
    this.market = { ...market, midYes: mid }
    const now = Date.now()
    this.lastTickAt = now

    if (this.running && this.config.settleOnClose && !this.settled && marketLooksSettled(market)) {
      this.settleInventory(this.market)
      if (!freezeMark) this.lastMid = mid
      this.emit()
      return
    }

    if (this.running && !this.settled) {
      // When live book is driving fills, market ticks only requote — no random spam.
      const midMoved =
        this.lastMid != null &&
        Math.abs(mid - this.lastMid) * 100 >= this.config.midMoveRequoteCents
      const due = now - this.lastQuoteAt >= this.config.quoteRefreshMs
      if (midMoved || due) {
        this.rebuildQuote(false)
      }
      this.maybeSoftSimOrFailLoud(mid)
    }
    if (!freezeMark) this.lastMid = mid
    this.emit()
  }

  private tick(): void {
    if (!this.running || !this.market || this.settled) return
    const now = Date.now()
    this.lastTickAt = now

    if (this.config.settleOnClose && marketLooksSettled(this.market)) {
      this.settleInventory(this.market)
      this.emit()
      return
    }

    if (now - this.lastQuoteAt >= this.config.quoteRefreshMs) {
      this.rebuildQuote(false)
    }
    this.maybeSoftSimOrFailLoud(this.midDollars())
    this.emit()
  }

  /**
   * Soft-sim only when useLiveBook is off. U2.13: useLiveBook && !liveBook →
   * fail-loud, no mid-cross / random fills.
   * U2.14.1: do not overwrite U2.14 hold-inv advisory with U2.13.
   */
  private maybeSoftSimOrFailLoud(mid: number): void {
    if (this.liveBook) return
    if (this.config.useLiveBook) {
      this.setL2OffNoSoftFillsMessage()
      return
    }
    this.simulateSoftFills(mid)
  }

  private settleInventory(
    market: Crypto15mMarket,
    opts: { keepRunning?: boolean } = {},
  ): void {
    if (this.settled) return
    this.settled = true
    if (this.quote) {
      this.quote = { ...this.quote, active: false, bidActive: false, askActive: false }
    }

    const settlePx = settlementYesPrice(market)
    const inv = this.inventory
    // Keep session alive for auto-roll only if we were already running
    const awaitRoll =
      this.config.autoRoll && (opts.keepRunning === true || this.running)

    if (inv !== 0) {
      const size = Math.abs(inv)
      const entry =
        this.avgEntry != null
          ? asDollarPrice(this.avgEntry, 'settle.avgEntry')
          : asDollarPrice(market.midYes, 'settle.fallbackMidEntry')
      const pnlPer = inv > 0 ? settlePx - entry : entry - settlePx
      this.realizedSpreadPnl += pnlPer * size

      if (inv > 0) {
        this.cash += settlePx * size
      } else {
        this.cash -= settlePx * size
      }

      this.fills.push({
        id: nextId('f'),
        t: Date.now(),
        side: inv > 0 ? 'sell_yes' : 'buy_yes',
        price: settlePx,
        size,
        midAtFill: asDollarPrice(market.midYes, 'settle.mid'),
        toxic: true,
        reason: 'settlement',
        feeDollars: 0,
        taker: false,
      })
      if (this.fills.length > 500) this.fills.splice(0, this.fills.length - 500)

      const official =
        (market.raw?.result ?? '').toLowerCase() === 'yes' ||
        (market.raw?.result ?? '').toLowerCase() === 'no'
      this.message =
        `SETTLEMENT: inventory ${inv > 0 ? '+' : ''}${inv} marked to ` +
        (official
          ? settlePx === 1
            ? 'YES=1'
            : 'YES=0'
          : `mid $${settlePx.toFixed(4)} (no official result — fail-closed)`) +
        ` (P&L ${pnlPer * size >= 0 ? '+' : ''}${(pnlPer * size).toFixed(2)}). Spread gains can wipe.` +
        (awaitRoll ? ' Waiting to auto-roll…' : '')
    } else {
      this.message =
        'Market closed/settled with flat inventory.' +
        (awaitRoll ? ' Waiting to auto-roll…' : '')
    }

    this.inventory = 0
    this.avgEntry = null
    this.holdingInvForL2Off = false

    if (awaitRoll) {
      // Stay running (timers up) so syncMarketUniverse can roll without Start.
      this.running = true
      return
    }

    this.running = false
    this.clearTimers()
  }

  private rebuildQuote(force: boolean): void {
    if (!this.market) {
      this.quote = null
      this.lastFairValue = null
      this.lastEdgeVsMidCents = null
      this.lastFvCenterActive = false
      return
    }
    const now = Date.now()
    const mid = this.midDollars()
    const spot = this.lastSpot?.price
    const mins = this.market.minutesRemaining
    const resolved = resolveStrike(this.market.floorStrike, spot, {
      title: this.market.title,
      rulesPrimary: this.market.rulesPrimary,
    })
    const strike = resolved.strike
    let fair: number | null = null
    let edgeCents: number | null = null
    let fvBlockReason: string | null = null
    if (spot == null || !Number.isFinite(spot) || !(spot > 0)) {
      fvBlockReason = U31_NO_SPOT
    } else if (strike == null || !Number.isFinite(strike) || !(strike > 0)) {
      fvBlockReason = U31_NO_STRIKE
    } else if (mins == null || !Number.isFinite(mins)) {
      fvBlockReason = U31_NO_TAU
    } else {
      const est = estimateYesFairValue({
        spot,
        strike,
        minutesRemaining: mins,
        annualVol: this.config.annualVol,
      })
      if (est) {
        fair = est.fairProb
        if (isValidQuoteMid(mid)) {
          edgeCents = edgeVsMidCents(est.fairProb, mid)
        }
      } else {
        fvBlockReason = U31_NO_SPOT
      }
    }
    this.lastFairValue = fair
    if (!isValidQuoteMid(mid)) {
      edgeCents = null
    }
    this.lastEdgeVsMidCents = edgeCents

    const guardCancel = this.guardMode === 'cancel' && now < this.guardActiveUntil
    const guardWiden = this.guardMode === 'widen' && now < this.guardActiveUntil

    const policyCfg: DecisionPolicyConfig = {
      halfSpreadCents: this.config.halfSpreadCents,
      quoteSize: this.config.quoteSize,
      maxInventory: this.config.maxInventory,
      inventorySkewCentsPerUnit: this.config.inventorySkewCentsPerUnit,
      guardWidenCents: this.config.guardWidenCents,
      toxicMidLow: this.config.toxicMidLow,
      toxicMidHigh: this.config.toxicMidHigh,
      minEdgeCents: this.config.minEdgeCents,
      expiryPullMinutes: this.config.expiryPullMinutes,
      fvQuoting: this.config.fvQuoting,
      sizeDownEdgeMult: DEFAULT_DECISION_POLICY.sizeDownEdgeMult,
      sizeUpEdgeMult: DEFAULT_DECISION_POLICY.sizeUpEdgeMult,
      unwindThreshold: this.config.unwindThreshold,
      maxSaneEdgeCents: this.config.maxSaneEdgeCents,
      minCaptureCents: this.config.minCaptureCents,
      edgePersistTicks: this.config.edgePersistTicks,
      twoSidedEdgeBandCents: this.config.twoSidedEdgeBandCents,
      openingEdgeExtraCents: this.config.openingEdgeExtraCents,
      openEdgeAddHalfSpread: this.config.openEdgeAddHalfSpread,
      openMinEdgeCents: this.config.openMinEdgeCents,
      hardFlatMinutes: this.config.hardFlatMinutes,
      minCloseProfitCents: this.config.minCloseProfitCents,
      stuckUnwindTicks: this.config.stuckUnwindTicks ?? 30,
      markBleedCents: this.config.markBleedCents ?? 5,
      quotingEnabled: this.config.quotingEnabled === true,
      blackoutMinutes: this.config.blackoutMinutes ?? DEFAULT_DECISION_POLICY.blackoutMinutes,
      quoteClampEpsilon: this.config.quoteClampEpsilon ?? DEFAULT_DECISION_POLICY.quoteClampEpsilon,
      tauSkewAccel: this.config.tauSkewAccel ?? DEFAULT_DECISION_POLICY.tauSkewAccel,
      longOpenMinMid:
        this.config.longOpenMinMid ?? DEFAULT_DECISION_POLICY.longOpenMinMid,
    }

    const decision = decideQuoteSides({
      mid,
      fairValue: fair,
      edgeCents,
      inventory: this.inventory,
      bookBestBid: this.bookBestBid,
      bookBestAsk: this.bookBestAsk,
      minutesRemaining: mins,
      running: this.running,
      settled: this.settled,
      moneyPrinterBug: this.moneyPrinterBug,
      spotGuardCancel: guardCancel,
      guardWiden,
      toxicBidPullUntil: this.toxicBidPullUntil,
      toxicAskPullUntil: this.toxicAskPullUntil,
      now,
      config: policyCfg,
      fvBlockReason,
      edgePersist: this.edgePersistState,
      avgEntry: this.avgEntry,
      stuckUnwind: this.stuckUnwindState,
    })
    this.edgePersistState = decision.edgePersist
    this.stuckUnwindState = decision.stuckUnwind

    this.lastFvCenterActive = decision.centerMode === 'fv'

    // Spot-guard cancel still parks opens; S4 risk-flat reduce may stay live.
    const allowRiskFlatThroughGuard =
      guardCancel && decision.unwindActive && this.inventory !== 0
    const guardBlocks = guardCancel && !allowRiskFlatThroughGuard

    this.quote = {
      yesBid: decision.yesBid,
      yesAsk: decision.yesAsk,
      size: decision.size,
      active: decision.active && !guardBlocks,
      bidActive: decision.bidActive && !guardBlocks,
      askActive: decision.askActive && !guardBlocks,
      skewCents: decision.skewCents,
      halfSpreadCents: decision.halfSpreadCents,
      centerMode: decision.centerMode,
      bidReason: decision.bidReason,
      askReason: decision.askReason,
      bidScenario: decision.bidScenario,
      askScenario: decision.askScenario,
      activeScenario: decision.activeScenario,
    }

    // U3.0 pause / U3.2 house mid / U3.1.x retained gates on strip
    // (do not erase U2.14 hold advisories).
    const holdL2 = /U2\.14:\s*L2 off — holding inv/i.test(this.message)
    if (this.running && !holdL2) {
      if (!this.config.quotingEnabled) {
        this.message = QUOTING_PAUSED_REASON
      } else if (
        decision.bothOffReason &&
        /^U3\.(1|2)/.test(decision.bothOffReason)
      ) {
        this.message = decision.bothOffReason
      } else if (decision.active && decision.activeScenario === 'blackout_flatten') {
        const stuck =
          (typeof decision.askReason === 'string' &&
            decision.askReason.startsWith('U3.2.1:') &&
            decision.askReason) ||
          (typeof decision.bidReason === 'string' &&
            decision.bidReason.startsWith('U3.2.1:') &&
            decision.bidReason) ||
          null
        this.message = stuck || U312_BLACKOUT_FLATTEN
      } else if (decision.active && decision.activeScenario === 'flatten') {
        const stuck =
          (typeof decision.askReason === 'string' &&
            decision.askReason.startsWith('U3.2.1:') &&
            decision.askReason) ||
          (typeof decision.bidReason === 'string' &&
            decision.bidReason.startsWith('U3.2.1:') &&
            decision.bidReason) ||
          null
        this.message = stuck || 'U3.1: flatten — exit only'
      } else if (decision.active && decision.activeScenario === 'house_mid') {
        this.message = U32_HOUSE_MID
      } else if (
        decision.active &&
        /^U3\.(1|2)/.test(this.message)
      ) {
        // Clear prior U3 park once quotes arm again (house mid / two-sided).
        this.message = U32_HOUSE_MID
      }
    }

    this.lastQuoteAt = now
    if (force) {
      /* requote forced */
    }
  }

  /** Soft-sim fallback when L2 proxy is unavailable. Disabled under strict / live book / U2.13. */
  private simulateSoftFills(midRaw: number): void {
    if (!this.running || !this.quote?.active || !this.market || this.settled) return
    if (this.moneyPrinterBug) return
    // Kill soft fills entirely when live book is up, useLiveBook requested, or strict
    if (this.config.strictRealism) return
    if (this.config.useLiveBook) return
    if (this.liveBook) return
    const mid = asDollarPrice(midRaw, 'soft.mid')
    const q = this.quote
    const stats = this.spotHist.stats(this.config.spotWindowSec)
    const spotUp = stats.signedPct > 0.02
    const spotDown = stats.signedPct < -0.02

    if (
      q.bidActive !== false &&
      mid <= q.yesBid &&
      canAcceptInventoryIncreasingFill(
        'buy_yes',
        this.inventory,
        this.config.maxInventory,
        this.config.unwindThreshold,
      ) &&
      !isToxicExtremeMid('buy_yes', mid, this.config.toxicMidLow, this.config.toxicMidHigh, this.inventory)
    ) {
      if (Math.random() < this.config.midCrossFillProb) {
        if (Date.now() - this.lastFillAt < this.config.fillCooldownMs) return
        this.applyFill('buy_yes', q.yesBid, q.size, mid, spotDown, 'mid_cross', false)
        this.lastFillAt = Date.now()
        this.rebuildQuote(true)
      } else {
        this.midCrossRejectCount += 1
        this.message = `Mid-cross VOID/reject on bid @ ${(q.yesBid * 100).toFixed(0)}¢ (p=${this.config.midCrossFillProb}).`
      }
      return
    }
    if (
      q.askActive !== false &&
      mid >= q.yesAsk &&
      canAcceptInventoryIncreasingFill(
        'sell_yes',
        this.inventory,
        this.config.maxInventory,
        this.config.unwindThreshold,
      ) &&
      !isToxicExtremeMid('sell_yes', mid, this.config.toxicMidLow, this.config.toxicMidHigh, this.inventory)
    ) {
      if (Math.random() < this.config.midCrossFillProb) {
        if (Date.now() - this.lastFillAt < this.config.fillCooldownMs) return
        this.applyFill('sell_yes', q.yesAsk, q.size, mid, spotUp, 'mid_cross', false)
        this.lastFillAt = Date.now()
        this.rebuildQuote(true)
      } else {
        this.midCrossRejectCount += 1
        this.message = `Mid-cross VOID/reject on ask @ ${(q.yesAsk * 100).toFixed(0)}¢ (p=${this.config.midCrossFillProb}).`
      }
      return
    }

    let buyProb = this.config.baseFillProb
    let sellProb = this.config.baseFillProb
    if (spotDown) buyProb += this.config.toxicityBias
    if (spotUp) sellProb += this.config.toxicityBias
    if (spotUp) buyProb *= 0.35
    if (spotDown) sellProb *= 0.35

    buyProb = clampProb(buyProb)
    sellProb = clampProb(sellProb)

    if (Date.now() - this.lastFillAt < this.config.fillCooldownMs) return
    const r = Math.random()
    const canBuy =
      q.bidActive !== false &&
      canAcceptInventoryIncreasingFill(
        'buy_yes',
        this.inventory,
        this.config.maxInventory,
        this.config.unwindThreshold,
      ) &&
      !isToxicExtremeMid('buy_yes', mid, this.config.toxicMidLow, this.config.toxicMidHigh, this.inventory)
    const canSell =
      q.askActive !== false &&
      canAcceptInventoryIncreasingFill(
        'sell_yes',
        this.inventory,
        this.config.maxInventory,
        this.config.unwindThreshold,
      ) &&
      !isToxicExtremeMid('sell_yes', mid, this.config.toxicMidLow, this.config.toxicMidHigh, this.inventory)
    if (r < buyProb && canBuy) {
      this.applyFill(
        'buy_yes',
        q.yesBid,
        q.size,
        mid,
        spotDown,
        spotDown ? 'random_toxic' : 'random',
        false,
      )
      this.lastFillAt = Date.now()
      this.rebuildQuote(true)
    } else if (r < buyProb + sellProb && canSell) {
      this.applyFill(
        'sell_yes',
        q.yesAsk,
        q.size,
        mid,
        spotUp,
        spotUp ? 'random_toxic' : 'random',
        false,
      )
      this.lastFillAt = Date.now()
      this.rebuildQuote(true)
    }
  }

  private applyFill(
    side: MmFill['side'],
    priceRaw: number,
    size: number,
    midRaw: number,
    toxic: boolean,
    reason: MmFill['reason'],
    taker: boolean,
    extras?: { queueAhead?: number; fillSize?: number },
  ): void {
    const price = asDollarPrice(priceRaw, `fill.${reason}.price`)
    const mid = asDollarPrice(midRaw, `fill.${reason}.mid`)
    if (price > 1.01 || mid > 1.01) {
      console.warn(`[paper-mm] reject fill with non-dollar price price=${priceRaw} mid=${midRaw}`)
      this.unitsWarning = `Rejected fill with cents-like price (price=${priceRaw}, mid=${midRaw})`
      return
    }

    // Enforce per-ticker fill caps immediately before accepting any non-settlement fill.
    if (reason !== 'settlement') {
      const nowCap = Date.now()
      const rate = this.canAcceptFillByRateCaps(nowCap)
      if (!rate.ok) {
        this.midCrossRejectCount += 1
        this.message =
          `FILL RATE CAP — ${rate.reason}. Harsh paper discipline · read-only.`
        return
      }
    }

    // Hard refuse: do not accumulate into near-certain settlement loss at extreme mids
    if (
      reason !== 'settlement' &&
      isToxicExtremeMid(side, mid, this.config.toxicMidLow, this.config.toxicMidHigh, this.inventory)
    ) {
      this.midCrossRejectCount += 1
      this.message =
        `U3.1.1: TOXIC SKIP ${side} @ mid $${mid.toFixed(4)} (extreme mid open guard ` +
        `${this.config.toxicMidLow}–${this.config.toxicMidHigh}). ` +
        `No new opens at pinned mid. Read-only · never places trades.`
      // Force requote with adverse side off
      this.rebuildQuote(true)
      return
    }

    // U3.2.3: refuse NEW long opens in low-mid bleed band (covers/shorts OK)
    if (reason !== 'settlement' && side === 'buy_yes' && this.inventory >= 0) {
      const minLong =
        Number.isFinite(this.config.longOpenMinMid) && this.config.longOpenMinMid > 0
          ? this.config.longOpenMinMid
          : DEFAULT_LONG_OPEN_MIN_MID
      if (Number.isFinite(mid) && mid <= minLong) {
        this.midCrossRejectCount += 1
        this.message =
          `${U323_LONG_OPEN_CURB} (mid $${mid.toFixed(4)} ≤ ${minLong}). ` +
          `Read-only · never places trades.`
        this.rebuildQuote(true)
        return
      }
    }

    // U3.2.3: no inventory-increasing opens when τ ≤ hardFlatMinutes
    if (reason !== 'settlement') {
      const minsLeft = this.market?.minutesRemaining
      const hardFlat = this.config.hardFlatMinutes ?? 2
      const increasingOpen =
        (side === 'buy_yes' && this.inventory >= 0) ||
        (side === 'sell_yes' && this.inventory <= 0)
      if (
        increasingOpen &&
        minsLeft != null &&
        Number.isFinite(minsLeft) &&
        minsLeft <= hardFlat
      ) {
        this.midCrossRejectCount += 1
        this.message =
          `${U323_NO_LATE_OPENS} (τ=${minsLeft.toFixed(2)}m). Read-only · never places trades.`
        this.rebuildQuote(true)
        return
      }
    }

    // Fill discipline: never add inventory when already at/over unwindThreshold
    // (or past maxInventory). Unwind / reducing fills remain allowed.
    if (reason !== 'settlement') {
      const increasing =
        (side === 'buy_yes' && this.inventory >= 0) ||
        (side === 'sell_yes' && this.inventory <= 0)
      if (
        increasing &&
        !canAcceptInventoryIncreasingFill(
          side,
          this.inventory,
          this.config.maxInventory,
          this.config.unwindThreshold,
        )
      ) {
        this.midCrossRejectCount += 1
        this.message =
          `INV BLOCK ${side} — inventory ${this.inventory} at/over unwind ` +
          `(thresh=${this.config.unwindThreshold}, max=${this.config.maxInventory}). ` +
          `Refuse adds; unwind only. Read-only · never places trades.`
        this.rebuildQuote(true)
        return
      }
    }

    // S3 CLOSE_PROFIT / S4 CLOSE_RISK — refuse lossy / sub-1¢ voluntary unwinds.
    // Fixes −0.88¢/fill churn: signed capture vs avgEntry must be ≥ minCloseProfitCents
    // unless S4 risk flat (hardFlat / maxInv / spot-guard / toxic holding mid).
    // Stamp fill.scenarioId from evaluateClose (or open quote decision) at fill time —
    // post-flat requote often shows S5 and must not rewrite close attribution.
    const flattenExitFill = isFlattenHouseTag(this.quote?.activeScenario)
    const reducingFill =
      (side === 'sell_yes' && this.inventory > 0) ||
      (side === 'buy_yes' && this.inventory < 0)

    let fillScenarioId: string | undefined
    if (reason !== 'settlement' && this.inventory !== 0) {
      const reducing =
        (side === 'sell_yes' && this.inventory > 0) ||
        (side === 'buy_yes' && this.inventory < 0)
      if (reducing) {
        const minClose = Math.max(
          this.config.minCloseProfitCents ?? 0,
          this.config.minChurnCaptureCents ?? 0,
        )
        const mins = this.market?.minutesRemaining ?? null
        const invSign = this.inventory > 0 ? 1 : this.inventory < 0 ? -1 : 0
        const stuckBase =
          invSign !== 0 && this.stuckUnwindState.invSign === invSign
            ? this.stuckUnwindState.ticks
            : 0
        const closeDec = evaluateClose({
          side,
          price,
          avgEntry: this.avgEntry,
          inventory: this.inventory,
          minCloseProfitCents: minClose,
          risk: {
            minutesRemaining: mins,
            inventory: this.inventory,
            maxInventory: this.config.maxInventory,
            hardFlatMinutes: this.config.hardFlatMinutes ?? 2,
            spotGuardCancel: this.guardMode === 'cancel' && Date.now() < this.guardActiveUntil,
            guardWidenExtreme: this.guardMode === 'widen' && Date.now() < this.guardActiveUntil,
            mid,
            toxicMidLow: this.config.toxicMidLow,
            toxicMidHigh: this.config.toxicMidHigh,
            holdingSide: this.inventory > 0 ? 'long' : this.inventory < 0 ? 'short' : 'flat',
          },
          stuckBlockedTicks: stuckBase + 1,
          stuckUnwindTicks: this.config.stuckUnwindTicks ?? 30,
          markBleedCents: this.config.markBleedCents ?? 5,
        })
        if (!closeDec.allow) {
          this.midCrossRejectCount += 1
          this.message =
            `CHURN SKIP ${side} @ $${price.toFixed(4)} — ${closeDec.reason}. ` +
            `Read-only · never places trades.`
          return
        }
        // U3.2.3: never emit S1–S5 on new fills — map to house_cover / house_close / flatten.
        const rawClose = flattenExitFill
          ? (this.quote?.activeScenario ?? closeDec.scenario)
          : closeDec.scenario
        fillScenarioId = toHouseFillTag(rawClose) ?? rawClose
        const houseCloseTag = toHouseFillTag(closeDec.scenario) ?? closeDec.scenario
        if (houseCloseTag === 'house_close' && closeDec.scenario === 'S4') {
          this.message =
            `house_close risk flat ${side} @ $${price.toFixed(4)} ` +
            `(capture ${
              closeDec.captureCents == null ? 'n/a' : `${closeDec.captureCents.toFixed(1)}¢`
            }). Read-only · never places trades.`
        }
        if (houseCloseTag === 'house_close' && closeDec.scenario === 'S4.1') {
          this.message =
            `house_close stuck unwind ${side} @ $${price.toFixed(4)} ` +
            `(capture ${closeDec.captureCents.toFixed(1)}¢). Read-only · never places trades.`
        }
        if (houseCloseTag === 'house_close' && closeDec.scenario === 'S4.2') {
          this.message =
            `house_close mark bleed ${side} @ $${price.toFixed(4)} ` +
            `(capture ${closeDec.captureCents.toFixed(1)}¢). Read-only · never places trades.`
        }
        if (houseCloseTag === 'house_cover' && closeDec.scenario === 'S3') {
          this.message =
            `house_cover ${side} @ $${price.toFixed(4)} ` +
            `(capture ${closeDec.captureCents.toFixed(1)}¢). Read-only · never places trades.`
        }
      }
    }
    if (fillScenarioId == null && reason !== 'settlement') {
      // Open / add — stamp from the quote decision that authorized the resting side.
      const rawOpen =
        side === 'buy_yes' ? this.quote?.bidScenario : this.quote?.askScenario
      fillScenarioId = toHouseFillTag(rawOpen) ?? rawOpen
    }

    const inventoryBefore = this.inventory
    const signed = side === 'buy_yes' ? size : -size

    // Belt-and-suspenders: refuse taker fills under strict realism
    if (taker && this.config.strictRealism && !(flattenExitFill && reducingFill)) {
      this.midCrossRejectCount += 1
      this.message =
        `TAKER REFUSED ${side} @ $${price.toFixed(4)} — strict maker-only (no taker_cross).`
      this.rebuildQuote(true)
      return
    }

    const fee = estimateFillFeeDollars(size, price, {
      taker,
      applyFees: this.config.applyFees,
    })
    // Skip fill when fee would exceed expected edge on this size
    if (fee > 0 && this.lastEdgeVsMidCents != null && Number.isFinite(this.lastEdgeVsMidCents)) {
      const edgeDollars = (Math.abs(this.lastEdgeVsMidCents) / 100) * size
      if (fee > edgeDollars + 1e-9) {
        this.midCrossRejectCount += 1
        this.message =
          `FEE SKIP ${side} — fee $${fee.toFixed(2)} > edge $${edgeDollars.toFixed(2)} ` +
          `(|FV−mid|=${Math.abs(this.lastEdgeVsMidCents).toFixed(1)}¢ × ${size}).`
        return
      }
    }
    if (fee > 0) {
      this.cash -= fee
      this.feesPaid += fee
      this.realizedSpreadPnl -= fee
    }

    if (side === 'buy_yes') {
      this.cash -= price * size
    } else {
      this.cash += price * size
    }

    let captureDollars = 0
    if (this.inventory === 0 || Math.sign(this.inventory) === Math.sign(signed)) {
      const newInv = this.inventory + signed
      if (this.avgEntry == null || this.inventory === 0) {
        this.avgEntry = price
      } else {
        this.avgEntry =
          (asDollarPrice(this.avgEntry, 'avgEntry') * Math.abs(this.inventory) + price * size) /
          Math.abs(newInv)
      }
      this.inventory = newInv
    } else {
      const closeQty = Math.min(Math.abs(this.inventory), size)
      if (this.avgEntry != null && closeQty > 0) {
        const entry = asDollarPrice(this.avgEntry, 'close.avgEntry')
        const pnlPer = this.inventory > 0 ? price - entry : entry - price
        captureDollars = pnlPer * closeQty
        this.realizedSpreadPnl += captureDollars
      }
      const newInv = this.inventory + signed
      if (newInv === 0) {
        this.avgEntry = null
      } else if (Math.sign(newInv) !== Math.sign(this.inventory) && this.inventory !== 0) {
        this.avgEntry = price
      }
      this.inventory = newInv
    }
    // Fees already deducted from realizedSpreadPnl above — attribute fee to capture for diagnostics
    if (fee > 0) captureDollars -= fee

    const fillAt = Date.now()
    this.fills.push({
      id: nextId('f'),
      t: fillAt,
      side,
      price,
      size,
      midAtFill: mid,
      toxic,
      reason,
      feeDollars: fee,
      taker,
      ticker: this.activeTicker(),
      captureDollars,
      scenarioId: fillScenarioId,
      queueAhead: extras?.queueAhead,
      fillSize: extras?.fillSize ?? size,
      inventoryBefore,
      inventoryAfter: this.inventory,
      fairValue: this.lastFairValue,
      edgeCents: this.lastEdgeVsMidCents,
      yesBid: this.quote?.yesBid ?? this.bookBestBid,
      yesAsk: this.quote?.yesAsk ?? this.bookBestAsk,
      centerMode: this.quote?.centerMode ?? 'mid',
      cashAfter: this.cash,
      spot: this.lastSpot?.price ?? null,
      strike: this.market?.floorStrike ?? null,
      minutesLeft: this.market?.minutesRemaining ?? null,
      asset: this.market?.asset ?? null,
    })
    if (reason !== 'settlement') {
      this.fillCapStore.record(this.activeTicker(), fillAt)
      this.lastFillAt = fillAt
    }
    if (this.fills.length > 500) this.fills.splice(0, this.fills.length - 500)

    if (toxic) {
      this.message = `Toxic ${side} @ ${(price * 100).toFixed(0)}¢ — spot moved against you.`
      const pullMs = this.config.toxicFillPullMs
      if (pullMs > 0) {
        if (side === 'buy_yes') {
          // Pull bid (stop digging); inventory unwind will force ask ON on next rebuild
          this.toxicBidPullUntil = Math.max(this.toxicBidPullUntil, Date.now() + pullMs)
          this.message += ' Bid pulled · ask unwind enabled if long.'
        } else {
          this.toxicAskPullUntil = Math.max(this.toxicAskPullUntil, Date.now() + pullMs)
          this.message += ' Ask pulled · bid unwind enabled if short.'
        }
      }
    }

    this.checkMoneyPrinterBug()
  }

  /**
   * Settle open inventory (e.g. before portfolio release). Idempotent.
   */
  settleNow(): void {
    if (!this.market || this.settled) return
    this.settleInventory(this.market, { keepRunning: false })
    this.emit()
  }

  /**
   * Test helper — seed paper P&L / a fill without soft-sim (portfolio ledger tests).
   */
  seedPaperStats(opts: {
    realizedSpreadPnl?: number
    feesPaid?: number
    cash?: number
    fill?: MmFill
    cancel?: MmCancelEvent
  }): void {
    if (opts.realizedSpreadPnl != null) this.realizedSpreadPnl = opts.realizedSpreadPnl
    if (opts.feesPaid != null) this.feesPaid = opts.feesPaid
    if (opts.cash != null) this.cash = opts.cash
    if (opts.fill) {
      this.fills.push(opts.fill)
    }
    if (opts.cancel) {
      this.cancels.push(opts.cancel)
    }
    this.emit()
  }

  /**
   * Test/helper: seed last public spot without network (paper research only).
   * Triggers an FV requote. Never tags source as 'demo' — pass real venue when known.
   */
  seedSpot(price: number, source: SpotTick['source'] = 'binance'): void {
    if (!Number.isFinite(price) || price <= 0) return
    const asset = this.market?.asset ?? 'UNKNOWN'
    this.lastSpot = { asset, price, source, t: Date.now() }
    this.spotHist.push(price, Date.now())
    this.rebuildQuote(true)
    this.emit()
  }

  /**
   * Test helper — seed net YES inventory + optional avg entry (paper only).
   */

  /**
   * U2.14 / U2.14.1: L2-off row message. Prefer hold advisory when portfolio has
   * noted open inventory past l2OffDropTicks (or message already says so).
   */
  private setL2OffNoSoftFillsMessage(detail?: string): void {
    if (
      this.holdingInvForL2Off ||
      (this.inventory !== 0 && /U2\.14:\s*L2 off — holding inv/i.test(this.message))
    ) {
      this.holdingInvForL2Off = true
      this.message = 'U2.14: L2 off — holding inv until flat'
      return
    }
    this.message = detail
      ? `L2 off — no soft fills (U2.13): ${detail}`
      : 'L2 off — no soft fills (U2.13)'
  }

  /**
   * U2.14: portfolio advisory when L2 stays off past l2OffDropTicks with open inv.
   * Does not invent fills or flatten prices.
   */
  noteL2OffHoldingInv(): void {
    this.holdingInvForL2Off = true
    this.message = 'U2.14: L2 off — holding inv until flat'
    this.emit()
  }

  /**
   * U2.14.1 test helper — same message path as pollBook when fetch returns null.
   */
  __noteL2PollFailedForTests(detail?: string): void {
    this.liveBook = false
    this.setL2OffNoSoftFillsMessage(detail)
    this.emit()
  }

  /** Test helper — force liveBook flag without network. */
  __setLiveBookForTests(on: boolean): void {
    this.liveBook = on
    if (on) {
      this.holdingInvForL2Off = false
      this.message = 'Live L2 (test)'
      if (this.lastMid != null) this.lastLiveMarkMid = this.lastMid
    } else if (!/L2 off/i.test(this.message)) {
      this.setL2OffNoSoftFillsMessage()
    }
    this.emit()
  }

  /** U2.14.1 test helper — seed last live mark mid (frozen while L2 off). */
  __setLastLiveMarkMidForTests(mid: number | null): void {
    this.lastLiveMarkMid = mid == null ? null : asDollarPrice(mid, 'test.lastLiveMarkMid')
  }

  seedInventory(inventory: number, avgEntry: number | null = 0.5): void {
    this.inventory = Math.trunc(inventory)
    this.avgEntry =
      this.inventory === 0 ? null : avgEntry != null ? asDollarPrice(avgEntry, 'seed.avg') : 0.5
    if (this.inventory === 0) this.holdingInvForL2Off = false
    this.rebuildQuote(true)
    this.emit()
  }

  /**
   * If |Δ Total P&L| > $1 in under 2s, freeze quoting — money-printer fill bug.
   */
  private checkMoneyPrinterBug(): void {
    if (this.moneyPrinterBug) return
    const mid = this.midDollars()
    const total = this.realizedSpreadPnl + this.unrealizedDollars(mid)
    const now = Date.now()
    if (this.lastTotalPnlAt > 0) {
      const dt = now - this.lastTotalPnlAt
      const dPnl = Math.abs(total - this.lastTotalPnl)
      if (dt < 2000 && dPnl > 1) {
        this.moneyPrinterBug = true
        if (this.quote) {
          this.quote = { ...this.quote, active: false, bidActive: false, askActive: false }
        }
        this.message =
          'MONEY PRINTER BUG — paused. |Δ Total P&L| > $1 in under 2s. Reset session. Read-only · never places trades.'
        console.error(
          `[paper-mm] MONEY PRINTER BUG: ΔP&L=$${dPnl.toFixed(2)} in ${dt}ms — quoting frozen`,
        )
      }
    }
    this.lastTotalPnl = total
    this.lastTotalPnlAt = now
  }
}

/** Singleton for the lab panel (one paper MM session). */
export const paperMmEngine = new PaperMmEngine()
