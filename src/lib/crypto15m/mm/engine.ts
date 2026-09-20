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
import { detectBookFills, type OrderBookSnapshot } from './orderbook'
import { fetchLiveOrderbook, fetchLocalHealth } from './liveBook'
import { asDollarPrice, clampPx } from './prices'
import type {
  MmCancelEvent,
  MmEngineState,
  MmFill,
  MmGuardAction,
  MmQuote,
  MmSnapshot,
} from './types'

let idSeq = 0
function nextId(prefix: string): string {
  idSeq += 1
  return `${prefix}-${Date.now()}-${idSeq}`
}

function settlementYesPrice(market: Crypto15mMarket): number {
  const result = (market.raw?.result ?? '').toLowerCase()
  if (result === 'yes') return 1
  if (result === 'no') return 0
  return asDollarPrice(market.midYes, 'settle.inferMid') >= 0.5 ? 1 : 0
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

  getState(): MmEngineState {
    return {
      snapshot: this.snapshot(),
      fills: [...this.fills].slice(-200).reverse(),
      cancels: [...this.cancels].slice(-100).reverse(),
    }
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
    }
  }

  setMarket(market: Crypto15mMarket | null): void {
    const changed = market?.ticker !== this.market?.ticker
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
      if (this.running) {
        this.rebuildQuote(true)
        void this.pollSpot()
        void this.pollBook()
      }
    } else if (market) {
      this.onMarketTick(market)
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
    if (this.quote) this.quote = { ...this.quote, active: false }
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
      this.emit()
    } catch (e) {
      this.message = `Spot poll failed: ${e instanceof Error ? e.message : String(e)}`
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

    if (this.quote?.active) {
      const signals = detectBookFills(
        this.prevBook,
        book,
        this.quote,
        this.inventory,
        this.config.maxInventory,
      )
      const stats = this.spotHist.stats(this.config.spotWindowSec)
      for (const sig of signals) {
        const toxic =
          (sig.side === 'buy_yes' && stats.signedPct < -0.02) ||
          (sig.side === 'sell_yes' && stats.signedPct > 0.02)
        this.applyFill(sig.side, sig.price, sig.size, mid, toxic, sig.reason, sig.taker)
      }
      if (signals.length) this.rebuildQuote(true)
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

  private settleInventory(market: Crypto15mMarket): void {
    if (this.settled) return
    this.settled = true
    if (this.quote) this.quote = { ...this.quote, active: false }

    const settlePx = settlementYesPrice(market)
    const inv = this.inventory

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

      this.message =
        `SETTLEMENT: inventory ${inv > 0 ? '+' : ''}${inv} marked to ${settlePx === 1 ? 'YES=1' : 'YES=0'} ` +
        `(P&L ${pnlPer * size >= 0 ? '+' : ''}${(pnlPer * size).toFixed(2)}). Spread gains can wipe.`
    } else {
      this.message = 'Market closed/settled with flat inventory.'
    }

    this.inventory = 0
    this.avgEntry = null
    this.running = false
    this.clearTimers()
  }

  private rebuildQuote(force: boolean): void {
    if (!this.market) {
      this.quote = null
      return
    }
    const now = Date.now()
    const guardCancel = this.guardMode === 'cancel' && now < this.guardActiveUntil
    if (guardCancel) {
      if (this.quote) this.quote = { ...this.quote, active: false }
      return
    }

    const mid = this.midDollars()
    let half = this.config.halfSpreadCents
    if (this.guardMode === 'widen' && now < this.guardActiveUntil) {
      half += this.config.guardWidenCents
    }

    const skewCents = this.inventory * this.config.inventorySkewCentsPerUnit
    const skew = skewCents / 100
    const bid = clampPx(mid - half / 100 - skew)
    let ask = clampPx(mid + half / 100 - skew)
    if (ask <= bid) ask = clampPx(bid + 0.01)

    const atMaxLong = this.inventory >= this.config.maxInventory
    const atMaxShort = this.inventory <= -this.config.maxInventory

    let activeBid = !atMaxLong
    let activeAsk = !atMaxShort
    if (!this.running || this.settled) {
      activeBid = false
      activeAsk = false
    }

    this.quote = {
      yesBid: bid,
      yesAsk: ask,
      size: this.config.quoteSize,
      active: this.running && !this.settled && (activeBid || activeAsk) && !guardCancel,
      skewCents,
      halfSpreadCents: half,
    }
    if (atMaxLong) this.quote.yesBid = 0.01
    if (atMaxShort) this.quote.yesAsk = 0.99

    this.lastQuoteAt = now
    if (force) {
      /* requote forced */
    }
  }

  /** Soft-sim fallback when L2 proxy is unavailable. */
  private simulateSoftFills(midRaw: number): void {
    if (!this.running || !this.quote?.active || !this.market || this.settled) return
    const mid = asDollarPrice(midRaw, 'soft.mid')
    const q = this.quote
    const stats = this.spotHist.stats(this.config.spotWindowSec)
    const spotUp = stats.signedPct > 0.02
    const spotDown = stats.signedPct < -0.02

    if (mid <= q.yesBid && this.inventory < this.config.maxInventory) {
      if (Math.random() < this.config.midCrossFillProb) {
        this.applyFill('buy_yes', q.yesBid, q.size, mid, spotDown, 'mid_cross', false)
        this.rebuildQuote(true)
      } else {
        this.midCrossRejectCount += 1
        this.message = `Mid-cross VOID/reject on bid @ ${(q.yesBid * 100).toFixed(0)}¢ (p=${this.config.midCrossFillProb}).`
      }
      return
    }
    if (mid >= q.yesAsk && this.inventory > -this.config.maxInventory) {
      if (Math.random() < this.config.midCrossFillProb) {
        this.applyFill('sell_yes', q.yesAsk, q.size, mid, spotUp, 'mid_cross', false)
        this.rebuildQuote(true)
      } else {
        this.midCrossRejectCount += 1
        this.message = `Mid-cross VOID/reject on ask @ ${(q.yesAsk * 100).toFixed(0)}¢ (p=${this.config.midCrossFillProb}).`
      }
      return
    }

    // Strict + preferred live book: do not spam random fills while waiting for book.
    if (this.config.strictRealism && this.config.useLiveBook) return

    let buyProb = this.config.baseFillProb
    let sellProb = this.config.baseFillProb
    if (spotDown) buyProb += this.config.toxicityBias
    if (spotUp) sellProb += this.config.toxicityBias
    if (spotUp) buyProb *= 0.35
    if (spotDown) sellProb *= 0.35

    buyProb = clampProb(buyProb)
    sellProb = clampProb(sellProb)

    const r = Math.random()
    if (r < buyProb && this.inventory < this.config.maxInventory) {
      this.applyFill(
        'buy_yes',
        q.yesBid,
        q.size,
        mid,
        spotDown,
        spotDown ? 'random_toxic' : 'random',
        false,
      )
      this.rebuildQuote(true)
    } else if (r < buyProb + sellProb && this.inventory > -this.config.maxInventory) {
      this.applyFill(
        'sell_yes',
        q.yesAsk,
        q.size,
        mid,
        spotUp,
        spotUp ? 'random_toxic' : 'random',
        false,
      )
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

    const signed = side === 'buy_yes' ? size : -size

    const fee = estimateFillFeeDollars(size, price, {
      taker,
      applyFees: this.config.applyFees,
    })
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

    this.fills.push({
      id: nextId('f'),
      t: Date.now(),
      side,
      price,
      size,
      midAtFill: mid,
      toxic,
      reason,
      feeDollars: fee,
      taker,
    })
    if (this.fills.length > 500) this.fills.splice(0, this.fills.length - 500)

    if (toxic) {
      this.message = `Toxic ${side} @ ${(price * 100).toFixed(0)}¢ — spot moved against you.`
    }
  }
}

/** Singleton for the lab panel (one paper MM session). */
export const paperMmEngine = new PaperMmEngine()
