/**
 * Paper crypto 15m market maker — simulate quotes, fills, and spot-guard cancels.
 * Does NOT place live Kalshi orders.
 */

import type { Crypto15mMarket } from '../../../types/crypto15m'
import { SpotHistory, fetchPublicSpot, type SpotTick } from '../spot'
import {
  DEFAULT_PAPER_MM_CONFIG,
  clampConfig,
  type PaperMmConfig,
} from './config'
import type {
  MmCancelEvent,
  MmEngineState,
  MmFill,
  MmGuardAction,
  MmQuote,
  MmSnapshot,
} from './types'

function clampProb(p: number): number {
  return Math.min(0.95, Math.max(0, p))
}

function roundPx(p: number): number {
  // Kalshi-style cent grid
  return Math.round(p * 100) / 100
}

function clampPx(p: number): number {
  return Math.min(0.99, Math.max(0.01, roundPx(p)))
}

let idSeq = 0
function nextId(prefix: string): string {
  idSeq += 1
  return `${prefix}-${Date.now()}-${idSeq}`
}

export class PaperMmEngine {
  private config: PaperMmConfig = { ...DEFAULT_PAPER_MM_CONFIG }
  private running = false
  private market: Crypto15mMarket | null = null
  private inventory = 0
  private cash = DEFAULT_PAPER_MM_CONFIG.startingCash
  private realizedSpreadPnl = 0
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
  private message = 'Idle — pick a market and Start paper MM.'
  private spotTimer: number | null = null
  private quoteTimer: number | null = null
  private listeners = new Set<() => void>()

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
    this.config = clampConfig({ ...this.config, ...partial })
    if (!this.running) {
      this.cash = this.config.startingCash
    }
    this.rebuildQuote(true)
    this.emit()
  }

  getState(): MmEngineState {
    return {
      snapshot: this.snapshot(),
      fills: [...this.fills].slice(-200).reverse(),
      cancels: [...this.cancels].slice(-100).reverse(),
    }
  }

  private snapshot(): MmSnapshot {
    const mid = this.market?.midYes ?? 0.5
    const unrealized =
      this.inventory !== 0 && this.avgEntry != null
        ? this.inventory * (mid - this.avgEntry)
        : 0
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
      unrealizedInventoryPnl: unrealized,
      avgEntry: this.avgEntry,
      fillCount: this.fills.length,
      cancelCount: this.cancels.length,
      guardActiveUntil: this.guardActiveUntil,
      guardMode: this.guardMode,
      lastTickAt: this.lastTickAt,
      message: this.message,
    }
  }

  setMarket(market: Crypto15mMarket | null): void {
    const changed = market?.ticker !== this.market?.ticker
    this.market = market
    if (changed) {
      this.lastMid = market?.midYes ?? null
      this.spotHist.clear()
      this.lastSpot = null
      if (this.running) {
        this.rebuildQuote(true)
        void this.pollSpot()
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
    this.message =
      'Paper MM running. Live placement needs Kalshi API keys — not in this build.'
    this.rebuildQuote(true)
    this.armTimers()
    void this.pollSpot()
    this.emit()
  }

  stop(): void {
    this.running = false
    this.clearTimers()
    if (this.quote) this.quote = { ...this.quote, active: false }
    this.guardMode = null
    this.guardActiveUntil = 0
    this.message = 'Stopped. Quotes cancelled (paper).'
    this.emit()
  }

  resetSession(): void {
    this.stop()
    this.inventory = 0
    this.cash = this.config.startingCash
    this.realizedSpreadPnl = 0
    this.avgEntry = null
    this.fills = []
    this.cancels = []
    this.quote = null
    this.spotHist.clear()
    this.lastSpot = null
    this.message = 'Session reset. Paper cash restored.'
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

    // Severity: large move → hard cancel; medium → widen; always skew with inventory
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

    // Mild inventory skew nudge always when guard fires
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

  /** Called when lab refreshes market mids. */
  onMarketTick(market: Crypto15mMarket): void {
    if (this.market?.ticker !== market.ticker) return
    this.market = market
    const mid = market.midYes
    const now = Date.now()
    this.lastTickAt = now

    if (this.running) {
      const midMoved =
        this.lastMid != null &&
        Math.abs(mid - this.lastMid) * 100 >= this.config.midMoveRequoteCents
      const due = now - this.lastQuoteAt >= this.config.quoteRefreshMs
      if (midMoved || due) {
        this.rebuildQuote(false)
      }
      this.simulateFills(mid)
    }
    this.lastMid = mid
    this.emit()
  }

  private tick(): void {
    if (!this.running || !this.market) return
    const now = Date.now()
    this.lastTickAt = now
    if (now - this.lastQuoteAt >= this.config.quoteRefreshMs) {
      this.rebuildQuote(false)
    }
    // Soft random fills even between market polls (demo / slow polls)
    this.simulateFills(this.market.midYes)
    this.emit()
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

    const mid = this.market.midYes
    let half = this.config.halfSpreadCents
    if (this.guardMode === 'widen' && now < this.guardActiveUntil) {
      half += this.config.guardWidenCents
    }

    // Avellaneda-lite inventory skew: long YES → lower quotes (eager to sell)
    const skewCents = this.inventory * this.config.inventorySkewCentsPerUnit
    const skew = skewCents / 100
    const bid = clampPx(mid - half / 100 - skew)
    let ask = clampPx(mid + half / 100 - skew)
    if (ask <= bid) ask = clampPx(bid + 0.01)

    const atMaxLong = this.inventory >= this.config.maxInventory
    const atMaxShort = this.inventory <= -this.config.maxInventory

    // Suppress toxic side at inventory limit
    let activeBid = !atMaxLong
    let activeAsk = !atMaxShort
    if (!this.running) {
      activeBid = false
      activeAsk = false
    }

    this.quote = {
      yesBid: activeBid ? bid : bid,
      yesAsk: activeAsk ? ask : ask,
      size: this.config.quoteSize,
      active: this.running && (activeBid || activeAsk) && !guardCancel,
      skewCents,
      halfSpreadCents: half,
    }
    // Encode one-sided: if at limit, park inactive side at extreme so fills skip it
    if (atMaxLong) this.quote.yesBid = 0.01
    if (atMaxShort) this.quote.yesAsk = 0.99

    this.lastQuoteAt = now
    if (force) {
      /* no-op marker for callers */
    }
  }

  private simulateFills(mid: number): void {
    if (!this.running || !this.quote?.active || !this.market) return
    const q = this.quote
    const stats = this.spotHist.stats(this.config.spotWindowSec)
    const spotUp = stats.signedPct > 0.02
    const spotDown = stats.signedPct < -0.02

    // 1) Mid-cross fills (market mid walks through your quote)
    if (mid <= q.yesBid && this.inventory < this.config.maxInventory) {
      // Someone hits your bid → you buy YES. Toxic if spot is dumping (YES likely worse).
      const toxic = spotDown
      this.applyFill('buy_yes', q.yesBid, q.size, mid, toxic, 'mid_cross')
      this.rebuildQuote(true)
      return
    }
    if (mid >= q.yesAsk && this.inventory > -this.config.maxInventory) {
      const toxic = spotUp
      this.applyFill('sell_yes', q.yesAsk, q.size, mid, toxic, 'mid_cross')
      this.rebuildQuote(true)
      return
    }

    // 2) Random fills with toxicity bias — model adverse selection
    // When spot moved against a resting quote, fill probability rises on that side.
    let buyProb = this.config.baseFillProb
    let sellProb = this.config.baseFillProb
    if (spotDown) buyProb += this.config.toxicityBias // dump → your bid gets hit
    if (spotUp) sellProb += this.config.toxicityBias // rally → your ask gets lifted
    // Mildly reduce friendly fills
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
      )
      this.rebuildQuote(true)
    }
  }

  private applyFill(
    side: MmFill['side'],
    price: number,
    size: number,
    mid: number,
    toxic: boolean,
    reason: MmFill['reason'],
  ): void {
    const signed = side === 'buy_yes' ? size : -size

    // Cash: buy YES spends price; sell YES receives price (per contract)
    if (side === 'buy_yes') {
      this.cash -= price * size
    } else {
      this.cash += price * size
    }

    // Realized spread / inventory accounting
    if (this.inventory === 0 || Math.sign(this.inventory) === Math.sign(signed)) {
      // Increasing position — update avg entry
      const newInv = this.inventory + signed
      if (this.avgEntry == null || this.inventory === 0) {
        this.avgEntry = price
      } else {
        this.avgEntry =
          (this.avgEntry * Math.abs(this.inventory) + price * size) / Math.abs(newInv)
      }
      this.inventory = newInv
    } else {
      // Reducing / flipping — realize vs avg entry
      const closeQty = Math.min(Math.abs(this.inventory), size)
      if (this.avgEntry != null && closeQty > 0) {
        // Long YES closed by sell: pnl = sell - entry; short closed by buy: pnl = entry - buy
        const pnlPer =
          this.inventory > 0 ? price - this.avgEntry : this.avgEntry - price
        this.realizedSpreadPnl += pnlPer * closeQty
      }
      const newInv = this.inventory + signed
      if (newInv === 0) {
        this.avgEntry = null
      } else if (Math.sign(newInv) !== Math.sign(this.inventory) && this.inventory !== 0) {
        // Flipped — remainder opens at this price
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
    })
    if (this.fills.length > 500) this.fills.splice(0, this.fills.length - 500)

    if (toxic) {
      this.message = `Toxic ${side} @ ${(price * 100).toFixed(0)}¢ — spot moved against you.`
    }
  }
}

/** Singleton for the lab panel (one paper MM session). */
export const paperMmEngine = new PaperMmEngine()
