/**
 * Parse Kalshi L2 orderbook_fp and detect maker fills from depth changes / mid walks.
 * Prices in dollars 0–1. Does not place orders.
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
  if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) return null
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

  const bestBid = yesBids[0]?.price ?? 0.01
  const bestAsk = yesAsks[0]?.price ?? 0.99
  let mid = (bestBid + bestAsk) / 2
  if (!(bestBid > 0 && bestAsk > 0)) {
    mid = bestBid > 0 ? bestBid : bestAsk > 0 ? bestAsk : 0.5
  }
  mid = asDollarPrice(mid, 'book.mid')

  return { ticker, t, yesBids, yesAsks, bestBid, bestAsk, mid, authenticated }
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

/**
 * Infer fills for resting (or crossing) simulated quotes from consecutive L2 snapshots.
 */
export function detectBookFills(
  prev: OrderBookSnapshot | null,
  next: OrderBookSnapshot,
  quote: { yesBid: number; yesAsk: number; size: number; active: boolean },
  inventory: number,
  maxInventory: number,
): BookFillSignal[] {
  const out: BookFillSignal[] = []
  if (!quote.active) return out

  const bid = asDollarPrice(quote.yesBid, 'quote.bid')
  const ask = asDollarPrice(quote.yesAsk, 'quote.ask')
  const size = Math.max(1, Math.round(quote.size))

  // Immediate cross → taker
  if (bid >= next.bestAsk - 1e-9 && inventory < maxInventory) {
    const avail = Math.max(size, Math.floor(depthAskAtOrBelow(next, bid)))
    out.push({
      side: 'buy_yes',
      price: Math.min(bid, next.bestAsk),
      size: Math.min(size, Math.max(1, avail)),
      reason: 'taker_cross',
      taker: true,
    })
    return out
  }
  if (ask <= next.bestBid + 1e-9 && inventory > -maxInventory) {
    const avail = Math.max(size, Math.floor(depthBidAtOrAbove(next, ask)))
    out.push({
      side: 'sell_yes',
      price: Math.max(ask, next.bestBid),
      size: Math.min(size, Math.max(1, avail)),
      reason: 'taker_cross',
      taker: true,
    })
    return out
  }

  if (!prev || prev.ticker !== next.ticker) return out

  const prevMid = asDollarPrice(prev.mid, 'prev.mid')
  const nextMid = asDollarPrice(next.mid, 'next.mid')

  // Mid walk through resting quotes
  if (
    prevMid > bid + 1e-9 &&
    nextMid <= bid + 1e-9 &&
    inventory < maxInventory
  ) {
    out.push({
      side: 'buy_yes',
      price: bid,
      size,
      reason: 'mid_walk',
      taker: false,
    })
  } else if (
    prevMid < ask - 1e-9 &&
    nextMid >= ask - 1e-9 &&
    inventory > -maxInventory
  ) {
    out.push({
      side: 'sell_yes',
      price: ask,
      size,
      reason: 'mid_walk',
      taker: false,
    })
  }

  // Depth consumption at our price (aggressive flow)
  const bidDepthPrev = depthBidAtOrAbove(prev, bid)
  const bidDepthNext = depthBidAtOrAbove(next, bid)
  const bidConsumed = bidDepthPrev - bidDepthNext
  // Only count if we were competitive (at/near touch)
  const bidCompetitive = bid + 1e-9 >= next.bestBid - 0.02 || bid + 1e-9 >= prev.bestBid - 0.02
  if (
    bidConsumed >= 1 &&
    bidCompetitive &&
    inventory < maxInventory &&
    !out.some((f) => f.side === 'buy_yes')
  ) {
    const fillSz = Math.min(size, Math.max(1, Math.floor(bidConsumed)))
    out.push({
      side: 'buy_yes',
      price: bid,
      size: fillSz,
      reason: 'book_depth',
      taker: false,
    })
  }

  const askDepthPrev = depthAskAtOrBelow(prev, ask)
  const askDepthNext = depthAskAtOrBelow(next, ask)
  const askConsumed = askDepthPrev - askDepthNext
  const askCompetitive = ask - 1e-9 <= next.bestAsk + 0.02 || ask - 1e-9 <= prev.bestAsk + 0.02
  if (
    askConsumed >= 1 &&
    askCompetitive &&
    inventory > -maxInventory &&
    !out.some((f) => f.side === 'sell_yes')
  ) {
    const fillSz = Math.min(size, Math.max(1, Math.floor(askConsumed)))
    out.push({
      side: 'sell_yes',
      price: ask,
      size: fillSz,
      reason: 'book_depth',
      taker: false,
    })
  }

  return out
}
