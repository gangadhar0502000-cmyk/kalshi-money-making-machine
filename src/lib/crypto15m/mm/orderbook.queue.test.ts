/**
 * Size-ahead queue: join behind depth, burn ahead before any book_depth fill.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DETECT_STATE,
  detectBookFills,
  type DetectBookFillsState,
  type OrderBookSnapshot,
} from './orderbook'

const BID = 0.48
const ASK = 0.52

function quote(size = 5) {
  return {
    yesBid: BID,
    yesAsk: ASK,
    size,
    active: true,
    bidActive: true,
    askActive: false,
  }
}

/** Loose opts so queue logic (not scarcity knobs) is under test. */
function opts(nowMs = 0) {
  return {
    allowTakerCross: false,
    allowMidWalk: false,
    minBookDepthConsumed: 1,
    minTouchPolls: 1,
    midWalkCooldownMs: 0,
    nowMs,
  }
}

function mk(bidSize: number, t: number): OrderBookSnapshot {
  return {
    ticker: 'KXBTC15M-T',
    t,
    yesBids: bidSize > 0 ? [{ price: BID, size: bidSize }] : [],
    yesAsks: [{ price: ASK, size: 40 }],
    // Keep synthetic bestBid at our quote so we stay "at touch" even if ladder empty.
    bestBid: BID,
    bestAsk: ASK,
    mid: (BID + ASK) / 2,
    authenticated: false,
  }
}

describe('size-ahead queue fills', () => {
  it('join behind 10, consume 4 → no fill; clear ahead → no fill; then consume 2 → fill 2', () => {
    const walk: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
    let t = 0

    const seed = mk(10, t++)
    detectBookFills(null, seed, quote(), 0, 10, walk, opts(seed.t))
    expect(walk.bidQueuePrice).toBeNull()

    // Join poll: depth 10 → queueAhead = 10, no fill
    let prev = seed
    let next = mk(10, t++)
    expect(detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))).toEqual([])
    expect(walk.bidQueueAhead).toBe(10)
    expect(walk.bidQueuePrice).toBe(BID)
    prev = next

    // Consume 4 → ahead 6, no fill
    next = mk(6, t++)
    expect(detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))).toEqual([])
    expect(walk.bidQueueAhead).toBe(6)
    prev = next

    // Consume remaining 6 (ahead cleared exactly) → still no fill
    next = mk(0, t++)
    expect(detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))).toEqual([])
    expect(walk.bidQueueAhead).toBe(0)
    prev = next

    // Depth add behind (0 → 8) — ahead stays 0
    next = mk(8, t++)
    expect(detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))).toEqual([])
    expect(walk.bidQueueAhead).toBe(0)
    prev = next

    // Consume 2 → fill 2
    next = mk(6, t++)
    const sigs = detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))
    expect(sigs).toHaveLength(1)
    expect(sigs[0]!.reason).toBe('book_depth')
    expect(sigs[0]!.size).toBe(2)
    expect(sigs[0]!.fillSize).toBe(2)
    expect(sigs[0]!.queueAhead).toBe(0)
    expect(sigs[0]!.side).toBe('buy_yes')
    expect(sigs[0]!.taker).toBe(false)
  })

  it('consume 10 after partial burn + depth-add-behind fills only excess past ahead', () => {
    const walk: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
    let t = 0

    const seed = mk(10, t++)
    detectBookFills(null, seed, quote(), 0, 10, walk, opts(seed.t))
    let prev = seed
    let next = mk(10, t++)
    detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))
    prev = next

    next = mk(6, t++)
    expect(detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))).toEqual([])
    expect(walk.bidQueueAhead).toBe(6)
    prev = next

    // +10 behind; ahead unchanged
    next = mk(16, t++)
    expect(detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))).toEqual([])
    expect(walk.bidQueueAhead).toBe(6)
    prev = next

    // Consume 10: burn 6 ahead, excess 4 → fill 4
    next = mk(6, t++)
    const sigs = detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))
    expect(walk.bidQueueAhead).toBe(0)
    expect(sigs).toHaveLength(1)
    expect(sigs[0]!.size).toBe(4)
    expect(sigs[0]!.fillSize).toBe(4)
  })

  it('requote to new price resets queue ahead from new join depth', () => {
    const walk: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
    let t = 0

    const mkPx = (bidPx: number, bidSize: number): OrderBookSnapshot => ({
      ticker: 'KXBTC15M-T',
      t: t++,
      yesBids: [{ price: bidPx, size: bidSize }],
      yesAsks: [{ price: ASK, size: 40 }],
      bestBid: bidPx,
      bestAsk: ASK,
      mid: (bidPx + ASK) / 2,
      authenticated: false,
    })
    const q = (bidPx: number) => ({
      yesBid: bidPx,
      yesAsk: ASK,
      size: 3,
      active: true,
      bidActive: true,
      askActive: false,
    })

    const seed = mkPx(0.48, 10)
    detectBookFills(null, seed, q(0.48), 0, 10, walk, opts(seed.t))
    let prev = seed
    let next = mkPx(0.48, 10)
    detectBookFills(prev, next, q(0.48), 0, 10, walk, opts(next.t))
    expect(walk.bidQueueAhead).toBe(10)
    prev = next

    next = mkPx(0.48, 7)
    detectBookFills(prev, next, q(0.48), 0, 10, walk, opts(next.t))
    expect(walk.bidQueueAhead).toBe(7)
    prev = next

    // Improve to 0.49 — reset from join depth 20
    next = mkPx(0.49, 20)
    expect(detectBookFills(prev, next, q(0.49), 0, 10, walk, opts(next.t))).toEqual([])
    expect(walk.bidQueuePrice).toBe(0.49)
    expect(walk.bidQueueAhead).toBe(20)

    prev = next
    next = mkPx(0.49, 15)
    expect(detectBookFills(prev, next, q(0.49), 0, 10, walk, opts(next.t))).toEqual([])
    expect(walk.bidQueueAhead).toBe(15)
  })

  it('depth add behind does not increase ahead', () => {
    const walk: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
    let t = 0

    const seed = mk(10, t++)
    detectBookFills(null, seed, quote(), 0, 10, walk, opts(seed.t))
    let prev = seed
    let next = mk(10, t++)
    detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))
    expect(walk.bidQueueAhead).toBe(10)
    prev = next

    next = mk(6, t++)
    detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))
    expect(walk.bidQueueAhead).toBe(6)
    prev = next

    next = mk(18, t++)
    expect(detectBookFills(prev, next, quote(), 0, 10, walk, opts(next.t))).toEqual([])
    expect(walk.bidQueueAhead).toBe(6)
  })

  it('fill size is min(our size, attributed); no mid_walk / taker_cross under strict opts', () => {
    const walk: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
    let t = 0

    // Join with 0 ahead
    const seed = mk(0, t++)
    detectBookFills(null, seed, quote(2), 0, 10, walk, opts(seed.t))
    let prev = seed
    let next = mk(0, t++)
    detectBookFills(prev, next, quote(2), 0, 10, walk, opts(next.t))
    expect(walk.bidQueueAhead).toBe(0)
    prev = next

    // Add behind then consume 5 → fill min(2,5)=2
    next = mk(5, t++)
    detectBookFills(prev, next, quote(2), 0, 10, walk, opts(next.t))
    prev = next
    next = mk(0, t++)
    const sigs = detectBookFills(prev, next, quote(2), 0, 10, walk, opts(next.t))
    expect(sigs).toHaveLength(1)
    expect(sigs[0]!.size).toBe(2)
    expect(sigs[0]!.reason).toBe('book_depth')
    expect(sigs.some((s) => s.reason === 'mid_walk' || s.reason === 'taker_cross')).toBe(false)
  })
})
