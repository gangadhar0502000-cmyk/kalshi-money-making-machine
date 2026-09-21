/**
 * Parse Kalshi L2 orderbook_fp and detect maker fills from depth changes / mid walks.
 * Prices in dollars 0–1. Does not place orders.
 *
 * Hard realism: at most ONE fill per poll (never buy+sell same tick),
 * book_depth only at touch (±0.5¢), mid_walk only on armed crossings.
 */

import { asDollarPrice } from './prices'

export interface BookLevel {
  price: number
  size: number
}

export interface OrderBookSnapshot {
  ticker: string
  t: number
  yesBids: BookLevel[]
  yesAsks: BookLevel[]
  bestBid: number
  bestAsk: number
  mid: number
  authenticated: boolean
}

type RawLevel = [string | number, string | number]

function parseLevel(pair: RawLevel): BookLevel | null {
  const price = asDollarPrice(Number.parseFloat(String(pair[0])), 'book.price')
  const size = Number.parseFloat(String(pair[1]))
  // Reject empty-book sentinels at 0 / non-positive size (window-boundary junk).
  if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0 || price <= 0) return null
  return { price, size }
}

/**
 * Kalshi returns yes bids + no bids. YES ask @ P ⇔ NO bid @ (1−P).
 */
export function parseOrderbookFp(
  ticker: string,
  raw: {
    orderbook_fp?: { yes_dollars?: RawLevel[]; no_dollars?: RawLevel[] }
    orderbook?: { yes?: RawLevel[]; no?: RawLevel[] }
  },
  authenticated = false,
  t = Date.now(),
): OrderBookSnapshot | null {
  const yesRaw = raw.orderbook_fp?.yes_dollars ?? raw.orderbook?.yes ?? []
  const noRaw = raw.orderbook_fp?.no_dollars ?? raw.orderbook?.no ?? []

  const yesBids: BookLevel[] = []
  for (const row of yesRaw) {
    if (Array.isArray(row) && row.length >= 2) {
      const lv = parseLevel(row as RawLevel)
      if (lv) yesBids.push(lv)
    }
  }
  yesBids.sort((a, b) => b.price - a.price)

  const yesAsks: BookLevel[] = []
  for (const row of noRaw) {
    if (Array.isArray(row) && row.length >= 2) {
      const noBid = parseLevel(row as RawLevel)
      if (!noBid) continue
      const askPx = asDollarPrice(1 - noBid.price, 'book.yesAsk')
      if (askPx >= 0.01 && askPx <= 0.99) {
        yesAsks.push({ price: Math.round(askPx * 100) / 100, size: noBid.size })
      }
    }
  }
  yesAsks.sort((a, b) => a.price - b.price)

  if (yesBids.length === 0 && yesAsks.length === 0) return null

  const hasBid = yesBids.length > 0
  const hasAsk = yesAsks.length > 0
  const bestBid = hasBid ? yesBids[0]!.price : 0
  const bestAsk = hasAsk ? yesAsks[0]!.price : 0
  let mid: number
  if (hasBid && hasAsk) {
    mid = (bestBid + bestAsk) / 2
  } else if (hasBid) {
    mid = bestBid
  } else if (hasAsk) {
    mid = bestAsk
  } else {
    return null
  }
  mid = asDollarPrice(mid, 'book.mid')
  // One-sided / empty mid=0 is not a real quote mid — keep snapshot but mid stays 0
  // so callers (isValidQuoteMid) can gate edge/quoting.

  return { ticker, t, yesBids, yesAsks, bestBid: hasBid ? bestBid : 0, bestAsk: hasAsk ? bestAsk : 0, mid, authenticated }
}

function depthBidAtOrAbove(book: OrderBookSnapshot, price: number): number {
  const p = asDollarPrice(price)
  let sum = 0
  for (const lv of book.yesBids) {
    if (lv.price + 1e-9 >= p) sum += lv.size
  }
  return sum
}

function depthAskAtOrBelow(book: OrderBookSnapshot, price: number): number {
  const p = asDollarPrice(price)
  let sum = 0
  for (const lv of book.yesAsks) {
    if (lv.price - 1e-9 <= p) sum += lv.size
  }
  return sum
}

export type BookFillSignal = {
  side: 'buy_yes' | 'sell_yes'
  price: number
  size: number
  reason: 'book_depth' | 'mid_walk' | 'taker_cross'
  /** true if our quote crossed the spread (immediate take) */
  taker: boolean
}

/** Touch tolerance: 0.5¢ = $0.005 */
const TOUCH_TOL = 0.005

export type DetectBookFillsState = {
  /** Mid was above our bid since last bid mid_walk — armed for next down-cross. */
  midWalkBidArmed: boolean
  /** Mid was below our ask since last ask mid_walk — armed for next up-cross. */
  midWalkAskArmed: boolean
}

export const DEFAULT_DETECT_STATE: DetectBookFillsState = {
  midWalkBidArmed: true,
  midWalkAskArmed: true,
}

/**
 * Infer fills for resting (or crossing) simulated quotes from consecutive L2 snapshots.
 * Returns at most ONE signal — never buy and sell in the same poll.
 */
export function detectBookFills(
  prev: OrderBookSnapshot | null,
  next: OrderBookSnapshot,
  quote: {
    yesBid: number
    yesAsk: number
    size: number
    active: boolean
    bidActive?: boolean
    askActive?: boolean
  },
  inventory: number,
  maxInventory: number,
  walkState: DetectBookFillsState = { ...DEFAULT_DETECT_STATE },
): BookFillSignal[] {
  if (!quote.active) return []

  const bid = asDollarPrice(quote.yesBid, 'quote.bid')
  const ask = asDollarPrice(quote.yesAsk, 'quote.ask')
  const size = Math.max(1, Math.round(quote.size))
  const bidOn = quote.bidActive !== false
  const askOn = quote.askActive !== false

  // Immediate cross → taker (single fill, then stop). Per-side must be active.
  if (bidOn && bid >= next.bestAsk - 1e-9 && inventory < maxInventory) {
    const avail = Math.max(1, Math.floor(depthAskAtOrBelow(next, bid)))
    return [
      {
        side: 'buy_yes',
        price: Math.min(bid, next.bestAsk),
        size: Math.min(size, avail),
        reason: 'taker_cross',
        taker: true,
      },
    ]
  }
  if (askOn && ask <= next.bestBid + 1e-9 && inventory > -maxInventory) {
    const avail = Math.max(1, Math.floor(depthBidAtOrAbove(next, ask)))
    return [
      {
        side: 'sell_yes',
        price: Math.max(ask, next.bestBid),
        size: Math.min(size, avail),
        reason: 'taker_cross',
        taker: true,
      },
    ]
  }

  // book_depth / mid_walk require a previous snapshot of the same ticker
  if (!prev || prev.ticker !== next.ticker) {
    // Still update arming from current mid so first cross after book appears works
    const mid = asDollarPrice(next.mid, 'next.mid')
    if (mid > bid + 1e-9) walkState.midWalkBidArmed = true
    if (mid < ask - 1e-9) walkState.midWalkAskArmed = true
    return []
  }

  const prevMid = asDollarPrice(prev.mid, 'prev.mid')
  const nextMid = asDollarPrice(next.mid, 'next.mid')

  // Re-arm when mid is clearly on the safe side of the quote (uncrossed)
  if (nextMid > bid + 1e-9) walkState.midWalkBidArmed = true
  if (nextMid < ask - 1e-9) walkState.midWalkAskArmed = true

  // Mid walk through resting quotes — only once per crossing (armed)
  if (
    bidOn &&
    walkState.midWalkBidArmed &&
    prevMid > bid + 1e-9 &&
    nextMid <= bid + 1e-9 &&
    inventory < maxInventory
  ) {
    walkState.midWalkBidArmed = false
    return [
      {
        side: 'buy_yes',
        price: bid,
        size,
        reason: 'mid_walk',
        taker: false,
      },
    ]
  }
  if (
    askOn &&
    walkState.midWalkAskArmed &&
    prevMid < ask - 1e-9 &&
    nextMid >= ask - 1e-9 &&
    inventory > -maxInventory
  ) {
    walkState.midWalkAskArmed = false
    return [
      {
        side: 'sell_yes',
        price: ask,
        size,
        reason: 'mid_walk',
        taker: false,
      },
    ]
  }

  // Depth consumption at our price — ONLY if we are at the touch (±0.5¢)
  const bidAtTouch =
    Math.abs(bid - next.bestBid) <= TOUCH_TOL + 1e-9 ||
    Math.abs(bid - prev.bestBid) <= TOUCH_TOL + 1e-9
  const bidDepthPrev = depthBidAtOrAbove(prev, bid)
  const bidDepthNext = depthBidAtOrAbove(next, bid)
  const bidConsumed = bidDepthPrev - bidDepthNext
  if (bidOn && bidAtTouch && bidConsumed >= 1 && inventory < maxInventory) {
    const fillSz = Math.min(size, Math.floor(bidConsumed))
    if (fillSz >= 1) {
      return [
        {
          side: 'buy_yes',
          price: bid,
          size: fillSz,
          reason: 'book_depth',
          taker: false,
        },
      ]
    }
  }

  const askAtTouch =
    Math.abs(ask - next.bestAsk) <= TOUCH_TOL + 1e-9 ||
    Math.abs(ask - prev.bestAsk) <= TOUCH_TOL + 1e-9
  const askDepthPrev = depthAskAtOrBelow(prev, ask)
  const askDepthNext = depthAskAtOrBelow(next, ask)
  const askConsumed = askDepthPrev - askDepthNext
  if (askOn && askAtTouch && askConsumed >= 1 && inventory > -maxInventory) {
    const fillSz = Math.min(size, Math.floor(askConsumed))
    if (fillSz >= 1) {
      return [
        {
          side: 'sell_yes',
          price: ask,
          size: fillSz,
          reason: 'book_depth',
          taker: false,
        },
      ]
    }
  }

  return []
}
