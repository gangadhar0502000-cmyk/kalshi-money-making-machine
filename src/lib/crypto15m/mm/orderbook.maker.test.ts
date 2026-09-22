/**
 * Maker-only fill discipline — no taker_cross fee bleed under strict realism.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DETECT_STATE,
  detectBookFills,
  type DetectBookFillsState,
  type OrderBookSnapshot,
} from './orderbook'
import { estimateFillFeeDollars } from '../fees'
import { clampQuotesMakerOnly, decideQuoteSides, DEFAULT_DECISION_POLICY } from './decisionPolicy'

function book(partial: Partial<OrderBookSnapshot> & { bestBid: number; bestAsk: number }): OrderBookSnapshot {
  const mid = (partial.bestBid + partial.bestAsk) / 2
  return {
    ticker: 'KXBTC15M-T',
    t: Date.now(),
    yesBids: [{ price: partial.bestBid, size: 40 }],
    yesAsks: [{ price: partial.bestAsk, size: 40 }],
    mid,
    authenticated: false,
    ...partial,
  }
}

describe('detectBookFills maker-only', () => {
  it('FV far from mid crossing quote does not produce taker_cross when allowTakerCross=false', () => {
    const next = book({ bestBid: 0.48, bestAsk: 0.52 })
    const walk: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
    // Bid crosses bestAsk (would be taker)
    const signals = detectBookFills(
      null,
      next,
      { yesBid: 0.7, yesAsk: 0.75, size: 1, active: true, bidActive: true, askActive: false },
      0,
      10,
      walk,
      { allowTakerCross: false },
    )
    expect(signals).toEqual([])
    expect(signals.some((s) => s.reason === 'taker_cross')).toBe(false)
  })

  it('allowTakerCross=true still emits taker_cross for debug/loose mode', () => {
    const next = book({ bestBid: 0.48, bestAsk: 0.52 })
    const signals = detectBookFills(
      null,
      next,
      { yesBid: 0.7, yesAsk: 0.75, size: 1, active: true },
      0,
      10,
      { ...DEFAULT_DETECT_STATE },
      { allowTakerCross: true },
    )
    expect(signals).toHaveLength(1)
    expect(signals[0]!.reason).toBe('taker_cross')
    expect(signals[0]!.taker).toBe(true)
  })

  it('100 simulated book polls with crossing FV do not accrue taker fees (maker fee = 0)', () => {
    let fees = 0
    let takerFills = 0
    let makerFills = 0
    const walk: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
    let prev: OrderBookSnapshot | null = null

    for (let i = 0; i < 100; i++) {
      // Alternate mild depth moves at the touch; quote still "wants" to cross via high FV bid
      const bestBid = 0.48
      const bestAsk = 0.52
      const next = book({
        bestBid,
        bestAsk,
        yesBids: [{ price: bestBid, size: 40 - (i % 5) }],
        yesAsks: [{ price: bestAsk, size: 40 }],
        t: Date.now() + i,
      })
      // Maker-clamped quote joins touch (as engine+policy do)
      const clamped = clampQuotesMakerOnly(0.7, 0.75, bestBid, bestAsk)
      const signals = detectBookFills(
        prev,
        next,
        {
          yesBid: clamped.bid,
          yesAsk: clamped.ask,
          size: 1,
          active: true,
          bidActive: true,
          askActive: false,
        },
        0,
        10,
        walk,
        { allowTakerCross: false },
      )
      for (const sig of signals) {
        if (sig.taker || sig.reason === 'taker_cross') takerFills += 1
        else makerFills += 1
        fees += estimateFillFeeDollars(sig.size, sig.price, {
          taker: sig.taker,
          applyFees: true,
        })
      }
      prev = next
    }

    expect(takerFills).toBe(0)
    expect(fees).toBe(0)
    // Maker fills (book_depth) may or may not fire; fee must stay 0 either way
    for (let i = 0; i < makerFills; i++) {
      expect(estimateFillFeeDollars(1, 0.48, { taker: false, applyFees: true })).toBe(0)
    }
  })

  it('maker fill fee = 0', () => {
    expect(estimateFillFeeDollars(1, 0.5, { taker: false, applyFees: true })).toBe(0)
    expect(estimateFillFeeDollars(10, 0.5, { taker: false, applyFees: true })).toBe(0)
  })
})

describe('clampQuotesMakerOnly / decisionPolicy', () => {
  it('quote with FV far from mid does not cross BBO', () => {
    const d = decideQuoteSides({
      mid: 0.5,
      fairValue: 0.85,
      edgeCents: 35,
      inventory: 0,
      bookBestBid: 0.48,
      bookBestAsk: 0.52,
      minutesRemaining: 8,
      running: true,
      settled: false,
      moneyPrinterBug: false,
      spotGuardCancel: false,
      guardWiden: false,
      toxicBidPullUntil: 0,
      toxicAskPullUntil: 0,
      now: 1e6,
      config: {
        halfSpreadCents: 2,
        quoteSize: 1,
        maxInventory: 10,
        inventorySkewCentsPerUnit: 0.15,
        guardWidenCents: 4,
        toxicMidLow: 0.05,
        toxicMidHigh: 0.95,
        minEdgeCents: 2.5,
        expiryPullMinutes: 0.5,
        fvQuoting: true,
        sizeDownEdgeMult: DEFAULT_DECISION_POLICY.sizeDownEdgeMult,
        sizeUpEdgeMult: DEFAULT_DECISION_POLICY.sizeUpEdgeMult,
        unwindThreshold: 1,
        maxSaneEdgeCents: 50,
        minCaptureCents: DEFAULT_DECISION_POLICY.minCaptureCents,
        edgePersistTicks: 1,
        twoSidedEdgeBandCents: DEFAULT_DECISION_POLICY.twoSidedEdgeBandCents,
        openingEdgeExtraCents: DEFAULT_DECISION_POLICY.openingEdgeExtraCents,
        openEdgeAddHalfSpread: DEFAULT_DECISION_POLICY.openEdgeAddHalfSpread,
      },
    })
    expect(d.bidActive).toBe(true)
    // Must not cross: bid ≤ bestBid, and bid < bestAsk
    expect(d.yesBid).toBeLessThanOrEqual(0.48 + 1e-9)
    expect(d.yesBid).toBeLessThan(0.52)
  })

  it('unwind long joins ask (maker), never crosses bestBid', () => {
    const d = decideQuoteSides({
      mid: 0.5,
      fairValue: null,
      edgeCents: null,
      inventory: 5,
      bookBestBid: 0.48,
      bookBestAsk: 0.52,
      minutesRemaining: 8,
      running: true,
      settled: false,
      moneyPrinterBug: false,
      spotGuardCancel: false,
      guardWiden: false,
      toxicBidPullUntil: 0,
      toxicAskPullUntil: 0,
      now: 1e6,
      config: {
        halfSpreadCents: 2,
        quoteSize: 2,
        maxInventory: 10,
        inventorySkewCentsPerUnit: 0.15,
        guardWidenCents: 4,
        toxicMidLow: 0.05,
        toxicMidHigh: 0.95,
        minEdgeCents: 2.5,
        expiryPullMinutes: 0.5,
        fvQuoting: true,
        sizeDownEdgeMult: DEFAULT_DECISION_POLICY.sizeDownEdgeMult,
        sizeUpEdgeMult: DEFAULT_DECISION_POLICY.sizeUpEdgeMult,
        unwindThreshold: 1,
        maxSaneEdgeCents: 25,
        minCaptureCents: DEFAULT_DECISION_POLICY.minCaptureCents,
        edgePersistTicks: 1,
        twoSidedEdgeBandCents: DEFAULT_DECISION_POLICY.twoSidedEdgeBandCents,
        openingEdgeExtraCents: DEFAULT_DECISION_POLICY.openingEdgeExtraCents,
        openEdgeAddHalfSpread: DEFAULT_DECISION_POLICY.openEdgeAddHalfSpread,
      },
    })
    expect(d.askActive).toBe(true)
    expect(d.unwindActive).toBe(true)
    expect(d.yesAsk).toBeGreaterThanOrEqual(0.52 - 1e-9)
    expect(d.yesAsk).toBeGreaterThan(0.48)
  })
})
