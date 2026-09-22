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
  DEFAULT_DECISION_POLICY,
  type DecisionPolicyConfig,
} from './decisionPolicy'
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
    this.config = clampConfig({ ...this.config, ...partial })
    if (!this.running) {
      this.cash = this.config.startingCash
    }
    this.rebuildQuote(true)
    if (this.running) this.armTimers()
    this.emit()
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
    )
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
    if (this.prevBook) return asDollarPrice(this.prevBook.mid, 'book.mid')
    return asDollarPrice(this.market?.midYes ?? 0.5, 'market.midYes')
  }

  private unrealizedDollars(mid: number): number {
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
    // If leaving a live position on a different ticker, settle first
    if (
      changed &&
      this.market &&
      this.inventory !== 0 &&
      !this.settled &&
      market
    ) {
      this.settleInventory(this.market, { keepRunning: this.running })
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
      this.midWalkState = { ...DEFAULT_DETECT_STATE }
      this.lastFillAt = 0
      // Do NOT clear fillCapStore — per-ticker caps must survive roll/rebuild.
      // Fresh ticker naturally has an empty window; old ticker stays capped.
      // New contract → clear paper inventory/quotes (cash + realized kept)
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
    this.message = this.config.strictRealism
      ? 'Paper MM running (strict realism). Read-only API · never places trades.'
      : 'Paper MM running (LOOSE debug). Fills are soft — not live edge.'
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
      const book = await fetchLiveOrderbook(this.market.ticker)
      if (!book) {
        this.liveBook = false
        return
      }
      this.onBook(book)
    } catch (e) {
      this.liveBook = false
      this.message = `L2 book poll failed (falling back to soft sim): ${
        e instanceof Error ? e.message : String(e)
      }`
      this.emit()
    }
  }

  /** Ingest a real L2 snapshot — primary fill path when proxy is up. */
  onBook(book: OrderBookSnapshot): void {
    if (!this.running || this.settled) return
    if (this.market && book.ticker !== this.market.ticker) return

    this.liveBook = true
    this.liveBookAuthenticated = book.authenticated
    this.bookBestBid = asDollarPrice(book.bestBid, 'book.bestBid')
    this.bookBestAsk = asDollarPrice(book.bestAsk, 'book.bestAsk')
    this.lastTickAt = Date.now()

    const mid = asDollarPrice(book.mid, 'onBook.mid')
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
    if (midMoved || due || !this.quote) {
      this.rebuildQuote(false)
    }

    if (this.quote?.active && !this.moneyPrinterBug) {
      const now = Date.now()
      const cooling = now - this.lastFillAt < this.config.fillCooldownMs
      if (!cooling) {
        const rate = this.canAcceptFillByRateCaps(now)
        if (!rate.ok) {
          this.message =
            `FILL RATE CAP — ${rate.reason}. Harsh paper discipline · read-only.`
          // Keep mid-walk arming fresh while capped
          const bid = this.quote.yesBid
          const ask = this.quote.yesAsk
          if (mid > bid + 1e-9) this.midWalkState.midWalkBidArmed = true
          if (mid < ask - 1e-9) this.midWalkState.midWalkAskArmed = true
        } else {
          const signals = detectBookFills(
            this.prevBook,
            book,
            this.quote,
            this.inventory,
            this.config.maxInventory,
            this.midWalkState,
            {
              // Strict realism (default): maker-only — never emit taker_cross fee bleed.
              allowTakerCross: !this.config.strictRealism,
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
          if (sig) {
            if (
              isToxicExtremeMid(
                sig.side,
                mid,
                this.config.toxicMidLow,
                this.config.toxicMidHigh,
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
              this.applyFill(sig.side, sig.price, sig.size, mid, toxic, sig.reason, sig.taker)
              this.lastFillAt = now
              this.rebuildQuote(true)
            }
          }
        }
      } else {
        // Keep mid-walk arming fresh while cooling; do not detect fills
        const bid = this.quote.yesBid
        const ask = this.quote.yesAsk
        if (mid > bid + 1e-9) this.midWalkState.midWalkBidArmed = true
        if (mid < ask - 1e-9) this.midWalkState.midWalkAskArmed = true
      }
    }

    this.prevBook = book
    this.lastMid = mid
    this.message = this.liveBookAuthenticated
      ? 'LIVE BOOK (read-only) · never places trades'
      : 'LIVE BOOK via public/proxy · Read-only API · never places trades'
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
    const mid = asDollarPrice(market.midYes, 'onMarketTick.mid')
    this.market = { ...market, midYes: mid }
    const now = Date.now()
    this.lastTickAt = now

    if (this.running && this.config.settleOnClose && !this.settled && marketLooksSettled(market)) {
      this.settleInventory(this.market)
      this.lastMid = mid
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
      if (!this.liveBook) {
        this.simulateSoftFills(mid)
      }
    }
    this.lastMid = mid
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
    if (!this.liveBook) {
      this.simulateSoftFills(this.midDollars())
    }
    this.emit()
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

    if (inv !== 0 && this.avgEntry != null) {
      const size = Math.abs(inv)
      const entry = asDollarPrice(this.avgEntry, 'settle.avgEntry')
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
    if (
      spot != null &&
      strike != null &&
      Number.isFinite(spot) &&
      Number.isFinite(strike) &&
      mins != null
    ) {
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
    })

    this.lastFvCenterActive = decision.centerMode === 'fv'

    this.quote = {
      yesBid: decision.yesBid,
      yesAsk: decision.yesAsk,
      size: decision.size,
      active: decision.active && !guardCancel,
      bidActive: decision.bidActive && !guardCancel,
      askActive: decision.askActive && !guardCancel,
      skewCents: decision.skewCents,
      halfSpreadCents: decision.halfSpreadCents,
      centerMode: decision.centerMode,
      bidReason: decision.bidReason,
      askReason: decision.askReason,
    }

    this.lastQuoteAt = now
    if (force) {
      /* requote forced */
    }
  }

  /** Soft-sim fallback when L2 proxy is unavailable. Disabled under strict / live book. */
  private simulateSoftFills(midRaw: number): void {
    if (!this.running || !this.quote?.active || !this.market || this.settled) return
    if (this.moneyPrinterBug) return
    // Kill soft fills entirely when live book is up, or always under strict realism
    if (this.config.strictRealism) return
    if (this.config.useLiveBook && this.liveBook) return
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
      !isToxicExtremeMid('buy_yes', mid, this.config.toxicMidLow, this.config.toxicMidHigh)
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
      !isToxicExtremeMid('sell_yes', mid, this.config.toxicMidLow, this.config.toxicMidHigh)
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
      !isToxicExtremeMid('buy_yes', mid, this.config.toxicMidLow, this.config.toxicMidHigh)
    const canSell =
      q.askActive !== false &&
      canAcceptInventoryIncreasingFill(
        'sell_yes',
        this.inventory,
        this.config.maxInventory,
        this.config.unwindThreshold,
      ) &&
      !isToxicExtremeMid('sell_yes', mid, this.config.toxicMidLow, this.config.toxicMidHigh)
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
      isToxicExtremeMid(side, mid, this.config.toxicMidLow, this.config.toxicMidHigh)
    ) {
      this.midCrossRejectCount += 1
      this.message =
        `TOXIC SKIP ${side} @ mid $${mid.toFixed(4)} (extreme mid guard ` +
        `${this.config.toxicMidLow}–${this.config.toxicMidHigh}). ` +
        `Pulled adverse side. Read-only · never places trades.`
      // Force requote with adverse side off
      this.rebuildQuote(true)
      return
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

    const signed = side === 'buy_yes' ? size : -size

    // Belt-and-suspenders: refuse taker fills under strict realism
    if (taker && this.config.strictRealism) {
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
        this.realizedSpreadPnl += pnlPer * closeQty
      }
      const newInv = this.inventory + signed
      if (newInv === 0) {
        this.avgEntry = null
      } else if (Math.sign(newInv) !== Math.sign(this.inventory) && this.inventory !== 0) {
        this.avgEntry = price
      }
      this.inventory = newInv
    }

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
   * Triggers an FV requote.
   */
  seedSpot(price: number): void {
    if (!Number.isFinite(price) || price <= 0) return
    const asset = this.market?.asset ?? 'UNKNOWN'
    this.lastSpot = { asset, price, source: 'demo', t: Date.now() }
    this.spotHist.push(price, Date.now())
    this.rebuildQuote(true)
    this.emit()
  }

  /**
   * Test helper — seed net YES inventory + optional avg entry (paper only).
   */
  seedInventory(inventory: number, avgEntry: number | null = 0.5): void {
    this.inventory = Math.trunc(inventory)
    this.avgEntry =
      this.inventory === 0 ? null : avgEntry != null ? asDollarPrice(avgEntry, 'seed.avg') : 0.5
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
