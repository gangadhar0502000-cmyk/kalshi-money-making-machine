/**
 * U2.13 — NO-primary L2 parse + queue fill on NO book.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DETECT_STATE,
  detectBookFills,
  parseOrderbookFp,
  type DetectBookFillsState,
} from './orderbook'

const RAW = {
  orderbook_fp: {
    // YES bids @ 0.40 size 10 → NO ask = 1-0.40 = 0.60
    yes_dollars: [['0.40', '10']] as [string, string][],
    // NO bids @ 0.48 size 12 → YES ask = 1-0.48 = 0.52
    no_dollars: [['0.48', '12']] as [string, string][],
  },
}

describe('parseOrderbookFp NO-primary (U2.13)', () => {
  it('YES-primary: bids=yes, asks from no complement', () => {
    const book = parseOrderbookFp('T', RAW, true, 1, 'yes')
    expect(book).not.toBeNull()
    expect(book!.bestBid).toBeCloseTo(0.4)
    expect(book!.bestAsk).toBeCloseTo(0.52) // 1 - 0.48
    expect(book!.yesBids[0]!.size).toBe(10)
    expect(book!.yesAsks[0]!.size).toBe(12)
  })

  it('NO-primary: bids=no, asks from yes complement', () => {
    const book = parseOrderbookFp('T', RAW, true, 1, 'no')
    expect(book).not.toBeNull()
    expect(book!.bestBid).toBeCloseTo(0.48)
    expect(book!.bestAsk).toBeCloseTo(0.6) // 1 - 0.40
    expect(book!.yesBids[0]!.size).toBe(12)
    expect(book!.yesAsks[0]!.size).toBe(10)
    expect(book!.mid).toBeCloseTo((0.48 + 0.6) / 2)
  })

  it('queue helpers see depth on NO-primary bid and can book_depth fill', () => {
    const NO_BID = 0.48
    const NO_ASK = 0.6
    const walk: DetectBookFillsState = { ...DEFAULT_DETECT_STATE }
    const opts = {
      allowTakerCross: false,
      allowMidWalk: false,
      minBookDepthConsumed: 1,
      minTouchPolls: 1,
      midWalkCooldownMs: 0,
      nowMs: 0,
    }
    const quote = {
      yesBid: NO_BID,
      yesAsk: NO_ASK,
      size: 5,
      active: true,
      bidActive: true,
      askActive: false,
    }
    const mk = (sz: number, t: number) => ({
      ticker: 'T',
      t,
      yesBids: sz > 0 ? [{ price: NO_BID, size: sz }] : [],
      yesAsks: [{ price: NO_ASK, size: 40 }],
      bestBid: NO_BID,
      bestAsk: NO_ASK,
      mid: (NO_BID + NO_ASK) / 2,
      authenticated: true,
    })

    let t = 0
    const seed = mk(10, t++)
    detectBookFills(null, seed, quote, 0, 10, walk, { ...opts, nowMs: seed.t })
    let prev = seed
    let next = mk(10, t++)
    expect(detectBookFills(prev, next, quote, 0, 10, walk, { ...opts, nowMs: next.t })).toEqual([])
    expect(walk.bidQueueAhead).toBe(10)
    prev = next
    next = mk(6, t++)
    expect(detectBookFills(prev, next, quote, 0, 10, walk, { ...opts, nowMs: next.t })).toEqual([])
    expect(walk.bidQueueAhead).toBe(6)
    prev = next
    next = mk(0, t++)
    expect(detectBookFills(prev, next, quote, 0, 10, walk, { ...opts, nowMs: next.t })).toEqual([])
    expect(walk.bidQueueAhead).toBe(0)
    prev = next
    next = mk(8, t++)
    expect(detectBookFills(prev, next, quote, 0, 10, walk, { ...opts, nowMs: next.t })).toEqual([])
    prev = next
    next = mk(6, t++)
    const sigs = detectBookFills(prev, next, quote, 0, 10, walk, { ...opts, nowMs: next.t })
    expect(sigs).toHaveLength(1)
    expect(sigs[0]!.reason).toBe('book_depth')
    expect(sigs[0]!.size).toBe(2)
    expect(sigs[0]!.price).toBeCloseTo(NO_BID)
  })
})
