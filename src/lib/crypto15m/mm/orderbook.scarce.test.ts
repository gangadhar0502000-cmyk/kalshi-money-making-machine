/**
 * Strict realism: scarce maker fills — mild book flicker must not print.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DETECT_STATE,
  detectBookFills,
  type DetectBookFillsState,
  type OrderBookSnapshot,
} from './orderbook'
import { STRICT_PAPER_MM_CONFIG, clampConfig } from './config'
import { PaperMmEngine } from './engine'
import type { Crypto15mMarket } from '../../../types/crypto15m'

function book(
  partial: Partial<OrderBookSnapshot> & { bestBid: number; bestAsk: number },
): OrderBookSnapshot {
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

function strictOpts(nowMs = Date.now()) {
  const c = STRICT_PAPER_MM_CONFIG
  return {
    allowTakerCross: false,
    allowMidWalk: c.allowMidWalk,
    minBookDepthConsumed: c.minBookDepthConsumed,
    minTouchPolls: c.minTouchPolls,
    midWalkCooldownMs: Math.max(c.fillCooldownMs, 15_000),
    nowMs,
  }
}

function mkMarket(): Crypto15mMarket {
  return {
    ticker: 'KXBTC15M-T',
    eventTicker: 'KXBTC15M-T',
    seriesTicker: 'KXBTC15M',
    asset: 'BTC',
    title: 'BTC up?',
    status: 'active',
    openTime: new Date(Date.now() - 5 * 60_000).toISOString(),
    closeTime: new Date(Date.now() + 10 * 60_000).toISOString(),
    yesBid: 0.48,
    yesAsk: 0.52,
    noBid: 0.48,
    noAsk: 0.52,
    midYes: 0.5,
    spreadCents: 4,
    last: 0.5,
    volume: 0,
    volume24h: 0,
    openInterest: 0,
    yesBidSize: 40,
    yesAskSize: 40,
    floorStrike: 100_000,
    rulesPrimary: 'YES if up',
    kalshiUrl: '',
    windowMinutes: 15,
    minutesElapsed: 5,
    minutesRemaining: 10,
    feeEstimate1: 0,
    thinBook: false,
    raw: {} as Crypto15mMarket['raw'],
  }
}

describe('strictRealism scarce book fills', () => {
  it('100 synthetic polls with mild depth changes → 0 fills under strict opts', () => {
    const walk: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
    let prev: OrderBookSnapshot | null = null
    let fills = 0
    const now0 = 1_700_000_000_000

    for (let i = 0; i < 100; i++) {
      const bestBid = 0.48
      const bestAsk = 0.52
      // Mild flicker: ±0..4 contracts — well below minBookDepthConsumed=8
      const next = book({
        bestBid,
        bestAsk,
        yesBids: [{ price: bestBid, size: 40 - (i % 5) }],
        yesAsks: [{ price: bestAsk, size: 40 - ((i + 2) % 4) }],
        t: now0 + i * 750,
      })
      const signals = detectBookFills(
        prev,
        next,
        {
          yesBid: bestBid,
          yesAsk: bestAsk,
          size: 1,
          active: true,
          bidActive: true,
          askActive: true,
        },
        0,
        10,
        walk,
        strictOpts(now0 + i * 750),
      )
      fills += signals.length
      prev = next
    }

    expect(fills).toBe(0)
  })

  it('mid_walk disabled under strict allowMidWalk=false', () => {
    const walk: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
    const prev = book({ bestBid: 0.5, bestAsk: 0.54, mid: 0.52 })
    const next = book({ bestBid: 0.46, bestAsk: 0.5, mid: 0.48 })
    // Mid walked down through bid at 0.50
    const signals = detectBookFills(
      prev,
      next,
      { yesBid: 0.5, yesAsk: 0.54, size: 1, active: true },
      0,
      10,
      walk,
      { ...strictOpts(), allowMidWalk: false },
    )
    expect(signals).toEqual([])
  })

  it('book_depth requires minTouchPolls + queue ahead cleared + large attributed consume', () => {
    const walk: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
    const bid = 0.48
    const ask = 0.52
    const q = { yesBid: bid, yesAsk: ask, size: 1, active: true as const }

    const emptyAt = (t: number): OrderBookSnapshot => ({
      ticker: 'KXBTC15M-T',
      t,
      yesBids: [],
      yesAsks: [{ price: ask, size: 100 }],
      bestBid: bid,
      bestAsk: ask,
      mid: (bid + ask) / 2,
      authenticated: false,
    })
    const depthAt = (t: number, size: number): OrderBookSnapshot => ({
      ticker: 'KXBTC15M-T',
      t,
      yesBids: [{ price: bid, size }],
      yesAsks: [{ price: ask, size: 100 }],
      bestBid: bid,
      bestAsk: ask,
      mid: (bid + ask) / 2,
      authenticated: false,
    })

    // Seed + join at depth 0 → queueAhead 0
    const seed = emptyAt(0)
    detectBookFills(null, seed, q, 0, 10, walk, strictOpts(0))
    let prev = seed
    let next = emptyAt(1)
    expect(detectBookFills(prev, next, q, 0, 10, walk, strictOpts(1))).toEqual([])
    expect(walk.bidQueueAhead).toBe(0)
    prev = next

    // Depth arrives behind us; build touch polls (strict needs 4). No fill yet.
    let got = 0
    for (let i = 2; i <= 4; i++) {
      next = depthAt(i, 100)
      got += detectBookFills(prev, next, q, 0, 10, walk, strictOpts(i)).length
      prev = next
    }
    expect(got).toBe(0)
    expect(walk.bidQueueAhead).toBe(0)
    expect(walk.bidTouchPolls).toBeGreaterThanOrEqual(3)

    // Large consume at touch with polls satisfied → fill (attributed ≥ minBookDepthConsumed)
    next = depthAt(5, 20) // consume 80 from 100
    const sigs = detectBookFills(prev, next, q, 0, 10, walk, strictOpts(5))
    expect(walk.bidTouchPolls).toBeGreaterThanOrEqual(4)
    expect(sigs).toHaveLength(1)
    expect(sigs[0]!.reason).toBe('book_depth')
    expect(sigs[0]!.side).toBe('buy_yes')
    expect(sigs[0]!.size).toBe(1)
  })
})

describe('engine cooldown + per-window caps', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('enforces fillCooldownMs and maxFillsPerMinute via onBook', () => {
    const eng = new PaperMmEngine()
    eng.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        fillCooldownMs: 20_000,
        maxFillsPerMinute: 2,
        maxFillsPerMarketPer15m: 8,
        minBookDepthConsumed: 1,
        minTouchPolls: 1,
        allowMidWalk: false,
        useLiveBook: true,
        fvQuoting: false,
        minEdgeCents: 0,
        halfSpreadCents: 2,
      }),
    )
    const m = mkMarket()
    eng.setMarket(m)
    eng.start()

    // Drive books: sit at touch then consume depth repeatedly
    let prevSize = 200
    const t0 = Date.now()
    for (let i = 0; i < 30; i++) {
      const size = prevSize - 10
      const b = book({
        bestBid: 0.48,
        bestAsk: 0.52,
        yesBids: [{ price: 0.48, size }],
        yesAsks: [{ price: 0.52, size: 100 }],
        t: t0 + i,
      })
      eng.onBook(b)
      prevSize = size
    }

    const st = eng.getState()
    // With 20s cooldown and max 2/min, even aggressive depth consumption cannot spam
    expect(st.snapshot.fillCount).toBeLessThanOrEqual(2)
    eng.stop()
  })

  it('maxFillsPerMinute blocks further applyFill after cap', () => {
    const eng = new PaperMmEngine()
    eng.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        fillCooldownMs: 0,
        maxFillsPerMinute: 2,
        maxFillsPerMarketPer15m: 8,
        fvQuoting: false,
        minEdgeCents: 0,
      }),
    )
    eng.setMarket(mkMarket())
    eng.start()
    // Bypass book detection — exercise rate cap path via public applyFill used in other tests
    // @ts-expect-error private in types but available for research tests
    eng.applyFill('buy_yes', 0.48, 1, 0.5, false, 'book_depth', false)
    // @ts-expect-error private
    eng.applyFill('sell_yes', 0.52, 1, 0.5, false, 'book_depth', false)
    const before = eng.getState().snapshot.fillCount
    expect(before).toBe(2)
    // Third fill attempt through onBook should hit rate cap (cooldown 0, depth easy)
    let size = 100
    for (let i = 0; i < 10; i++) {
      size -= 10
      eng.onBook(
        book({
          bestBid: 0.48,
          bestAsk: 0.52,
          yesBids: [{ price: 0.48, size }],
          yesAsks: [{ price: 0.52, size: 100 }],
          t: Date.now() + i,
        }),
      )
    }
    // Cap held: no additional fills despite easy depth consumption
    expect(eng.getState().snapshot.fillCount).toBe(2)
    expect(eng.getState().snapshot.fillsLastMinute).toBe(2)
    eng.stop()
  })

  it('STRICT defaults expose harsh scarcity knobs', () => {
    expect(STRICT_PAPER_MM_CONFIG.fillCooldownMs).toBeGreaterThanOrEqual(15_000)
    expect(STRICT_PAPER_MM_CONFIG.minBookDepthConsumed).toBeGreaterThanOrEqual(5)
    expect(STRICT_PAPER_MM_CONFIG.minTouchPolls).toBeGreaterThanOrEqual(3)
    expect(STRICT_PAPER_MM_CONFIG.allowMidWalk).toBe(false)
    expect(STRICT_PAPER_MM_CONFIG.maxFillsPerMinute).toBe(1)
    expect(STRICT_PAPER_MM_CONFIG.maxFillsPerMarketPer15m).toBe(4)
  })
})
