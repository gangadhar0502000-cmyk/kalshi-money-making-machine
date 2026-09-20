/**
 * Paper crypto 15m market maker — simulate quotes, fills, and spot-guard cancels.
 * Does NOT place live Kalshi orders.
 *
 * Strict realism (default): rare random fills, probabilistic mid-cross, Kalshi fees,
 * and settlement risk when the window closes with inventory open.
 */

import type { Crypto15mMarket } from '../../../types/crypto15m'
import { estimateKalshiFeeDollars } from '../fees'
import { SpotHistory, fetchPublicSpot, type SpotTick } from '../spot'
import {
  DEFAULT_PAPER_MM_CONFIG,
  clampConfig,
  presetsForMode,
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

/** Infer binary settlement price: prefer raw.result, else mid threshold. */
function settlementYesPrice(market: Crypto15mMarket): number {
  const result = (market.raw?.result ?? '').toLowerCase()
  if (result === 'yes') return 1
  if (result === 'no') return 0
  // Soft inference when feed still shows mid after close
  return market.midYes >= 0.5 ? 1 : 0
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
    // Toggling strict realism pulls harsh/loose fill+fee+settlement knobs together
    if (partial.strictRealism !== undefined && partial.strictRealism !== this.config.strictRealism) {
      partial = { ...presetsForMode(partial.strictRealism), ...partial }
    }
    this.config = clampConfig({ ...this.config, ...partial })
    if (!this.running) {
      this.cash = this.config.startingCash
    }
    this.rebuildQuote(true)
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
    }
  }

  setMarket(market: Crypto15mMarket | null): void {
    const changed = market?.ticker !== this.market?.ticker
    this.market = market
    if (changed) {
      this.lastMid = market?.midYes ?? null
      this.spotHist.clear()
      this.lastSpot = null
      this.settled = false
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
    this.settled = false
    this.sessionStartedAt = Date.now()
    this.message = this.config.strictRealism
      ? 'Paper MM running (strict realism). Live placement needs Kalshi API keys — not in this build.'
      : 'Paper MM running (LOOSE debug). Fills are soft — not live edge.'
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

    if (this.running && this.config.settleOnClose && !this.settled && marketLooksSettled(market)) {
      this.settleInventory(market)
      this.lastMid = mid
      this.emit()
      return
    }

    if (this.running && !this.settled) {
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
    // Soft random fills even between market polls (demo / slow polls)
    this.simulateFills(this.market.midYes)
    this.emit()
  }

  /**
   * When the 15m window closes with open inventory, mark YES to 0 or 1 and realize.
   * Can wipe spread gains — intentional settlement risk.
   */
  private settleInventory(market: Crypto15mMarket): void {
    if (this.settled) return
    this.settled = true
    if (this.quote) this.quote = { ...this.quote, active: false }

    const settlePx = settlementYesPrice(market)
    const inv = this.inventory

    if (inv !== 0 && this.avgEntry != null) {
      const size = Math.abs(inv)
      // Realize mark-to-settlement vs avg entry
      const pnlPer = inv > 0 ? settlePx - this.avgEntry : this.avgEntry - settlePx
      this.realizedSpreadPnl += pnlPer * size

      // Cash mark: long YES receives settle; short covers at settle
      if (inv > 0) {
        this.cash += settlePx * size
      } else {
        this.cash -= settlePx * size
      }

      // Binary settlement at 0/1 → Kalshi fee formula is $0 (P*(1-P)=0).
      const displayPx = settlePx === 0 ? 0 : settlePx === 1 ? 1 : settlePx
      this.fills.push({
        id: nextId('f'),
        t: Date.now(),
        side: inv > 0 ? 'sell_yes' : 'buy_yes',
        price: displayPx,
        size,
        midAtFill: market.midYes,
        toxic: true,
        reason: 'settlement',
        feeDollars: 0,
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
    if (!this.running || this.settled) {
      activeBid = false
      activeAsk = false
    }

    this.quote = {
      yesBid: activeBid ? bid : bid,
      yesAsk: activeAsk ? ask : ask,
      size: this.config.quoteSize,
      active: this.running && !this.settled && (activeBid || activeAsk) && !guardCancel,
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
    if (!this.running || !this.quote?.active || !this.market || this.settled) return
    const q = this.quote
    const stats = this.spotHist.stats(this.config.spotWindowSec)
    const spotUp = stats.signedPct > 0.02
    const spotDown = stats.signedPct < -0.02

    // 1) Mid-cross — probabilistic fill (void/reject modeled); never assume 100%
    if (mid <= q.yesBid && this.inventory < this.config.maxInventory) {
      if (Math.random() < this.config.midCrossFillProb) {
        const toxic = spotDown
        this.applyFill('buy_yes', q.yesBid, q.size, mid, toxic, 'mid_cross')
        this.rebuildQuote(true)
      } else {
        this.midCrossRejectCount += 1
        this.message = `Mid-cross VOID/reject on bid @ ${(q.yesBid * 100).toFixed(0)}¢ (p=${this.config.midCrossFillProb}).`
      }
      return
    }
    if (mid >= q.yesAsk && this.inventory > -this.config.maxInventory) {
      if (Math.random() < this.config.midCrossFillProb) {
        const toxic = spotUp
        this.applyFill('sell_yes', q.yesAsk, q.size, mid, toxic, 'mid_cross')
        this.rebuildQuote(true)
      } else {
        this.midCrossRejectCount += 1
        this.message = `Mid-cross VOID/reject on ask @ ${(q.yesAsk * 100).toFixed(0)}¢ (p=${this.config.midCrossFillProb}).`
      }
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

    const fee =
      this.config.applyFees ? estimateKalshiFeeDollars(size, price) : 0
    if (fee > 0) {
      this.cash -= fee
      this.feesPaid += fee
      this.realizedSpreadPnl -= fee
    }

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
      feeDollars: fee,
    })
    if (this.fills.length > 500) this.fills.splice(0, this.fills.length - 500)

    if (toxic) {
      this.message = `Toxic ${side} @ ${(price * 100).toFixed(0)}¢ — spot moved against you.`
    }
  }
}

/** Singleton for the lab panel (one paper MM session). */
export const paperMmEngine = new PaperMmEngine()
