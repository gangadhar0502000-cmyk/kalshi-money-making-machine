/**
 * Parse Kalshi L2 orderbook_fp and detect maker fills from depth changes / mid walks.
 * Prices in dollars 0–1. Does not place orders.
 *
 * Hard realism: at most ONE fill per poll (never buy+sell same tick),
 * book_depth only at touch (±0.5¢) after minTouchPolls + size-ahead queue cleared,
 * mid_walk opt-in (disabled under strict) and requires arm + cooldown.
 *
 * Size-ahead queue: on join at a price we snapshot depth at/better as queueAhead
 * (we are last). Later depth drops burn ahead first; only excess after ahead=0
 * may fill us. Depth adds while resting join behind us (do not increase ahead).
 * Requote / leave-touch resets the queue from the new join depth.
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
  /** Remaining size-ahead queue after this poll's consumption (0 when we can fill). */
  queueAhead?: number
  /** Same as size — explicit for journal/telemetry. */
  fillSize?: number
}

/** Touch tolerance: 0.5¢ = $0.005 */
const TOUCH_TOL = 0.005

export type DetectBookFillsState = {
  /** Mid was above our bid since last bid mid_walk — armed for next down-cross. */
  midWalkBidArmed: boolean
  /** Mid was below our ask since last ask mid_walk — armed for next up-cross. */
  midWalkAskArmed: boolean
  /** Consecutive polls bid quote has been at/inside touch. */
  bidTouchPolls: number
  /** Consecutive polls ask quote has been at/inside touch. */
  askTouchPolls: number
  /** Ms of last mid_walk fill (either side) — used for post-walk cooldown. */
  lastMidWalkAt: number
  /**
   * Bid price we joined the L2 queue at (null = not resting / need rejoin).
   * Requote to a new price or leave-touch clears this.
   */
  bidQueuePrice: number | null
  /** Contracts still ahead of us at/better our bid (FIFO). */
  bidQueueAhead: number
  /** Ask join price (null = not resting). */
  askQueuePrice: number | null
  /** Contracts still ahead of us at/better our ask. */
  askQueueAhead: number
}

export const DEFAULT_DETECT_STATE: DetectBookFillsState = {
  midWalkBidArmed: true,
  midWalkAskArmed: true,
  bidTouchPolls: 0,
  askTouchPolls: 0,
  lastMidWalkAt: 0,
  bidQueuePrice: null,
  bidQueueAhead: 0,
  askQueuePrice: null,
  askQueueAhead: 0,
}

function resetBidQueue(walkState: DetectBookFillsState): void {
  walkState.bidQueuePrice = null
  walkState.bidQueueAhead = 0
}

function resetAskQueue(walkState: DetectBookFillsState): void {
  walkState.askQueuePrice = null
  walkState.askQueueAhead = 0
}

/**
 * Infer fills for resting (or crossing) simulated quotes from consecutive L2 snapshots.
 * Returns at most ONE signal — never buy and sell in the same poll.
 */
export type DetectBookFillsOpts = {
  /**
   * When false (strict realism default), never emit taker_cross fills.
   * Crossing quotes are ignored so paper MM cannot fee-bleed as a taker.
   */
  allowTakerCross?: boolean
  /**
   * When false (strict default), never emit mid_walk fills.
   * Soft/debug may enable; when enabled under harsh opts, still requires
   * full cross + prior uncross + midWalkCooldownMs.
   */
  allowMidWalk?: boolean
  /** Min contracts consumed past the ahead queue to count as book_depth (default 1). */
  minBookDepthConsumed?: number
  /** Min consecutive at-touch polls before book_depth can fire (default 1). */
  minTouchPolls?: number
  /**
   * After a mid_walk fill, refuse another mid_walk until this many ms elapse
   * AND mid has uncrossed (re-armed). Strict research uses a long cooldown.
   */
  midWalkCooldownMs?: number
  /** Now ms — for mid_walk cooldown; defaults to Date.now(). */
  nowMs?: number
}

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
  opts: DetectBookFillsOpts = {},
): BookFillSignal[] {
  if (!quote.active) {
    resetBidQueue(walkState)
    resetAskQueue(walkState)
    walkState.bidTouchPolls = 0
    walkState.askTouchPolls = 0
    return []
  }

  const bid = asDollarPrice(quote.yesBid, 'quote.bid')
  const ask = asDollarPrice(quote.yesAsk, 'quote.ask')
  const size = Math.max(1, Math.round(quote.size))
  const bidOn = quote.bidActive !== false
  const askOn = quote.askActive !== false
  const allowTaker = opts.allowTakerCross === true
  const allowMidWalk = opts.allowMidWalk !== false
  const minDepth = Math.max(1, Math.floor(opts.minBookDepthConsumed ?? 1))
  const minTouch = Math.max(1, Math.floor(opts.minTouchPolls ?? 1))
  const midWalkCd = Math.max(0, Math.floor(opts.midWalkCooldownMs ?? 0))
  const nowMs = opts.nowMs ?? Date.now()

  // Immediate cross → taker. Under strict realism this path is refused entirely
  // (maker-only: book_depth / mid_walk). Per-side must be active.
  if (allowTaker && bidOn && bid >= next.bestAsk - 1e-9 && inventory < maxInventory) {
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
  if (allowTaker && askOn && ask <= next.bestBid + 1e-9 && inventory > -maxInventory) {
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
    walkState.bidTouchPolls = 0
    walkState.askTouchPolls = 0
    resetBidQueue(walkState)
    resetAskQueue(walkState)
    return []
  }

  const prevMid = asDollarPrice(prev.mid, 'prev.mid')
  const nextMid = asDollarPrice(next.mid, 'next.mid')

  // Re-arm when mid is clearly on the safe side of the quote (uncrossed)
  if (nextMid > bid + 1e-9) walkState.midWalkBidArmed = true
  if (nextMid < ask - 1e-9) walkState.midWalkAskArmed = true

  // Track consecutive at-touch polls (must stay at touch across polls)
  const bidJoined =
    Math.abs(bid - next.bestBid) <= TOUCH_TOL + 1e-9 ||
    Math.abs(bid - prev.bestBid) <= TOUCH_TOL + 1e-9
  const askJoined =
    Math.abs(ask - next.bestAsk) <= TOUCH_TOL + 1e-9 ||
    Math.abs(ask - prev.bestAsk) <= TOUCH_TOL + 1e-9

  if (bidOn && bidJoined) walkState.bidTouchPolls = (walkState.bidTouchPolls || 0) + 1
  else walkState.bidTouchPolls = 0
  if (askOn && askJoined) walkState.askTouchPolls = (walkState.askTouchPolls || 0) + 1
  else walkState.askTouchPolls = 0

  // Mid walk through resting quotes — only once per crossing (armed).
  // Strict realism disables this path (allowMidWalk=false). When enabled,
  // still require cooldown since last mid_walk + prior uncross arming.
  const midWalkReady = nowMs - (walkState.lastMidWalkAt || 0) >= midWalkCd
  if (
    allowMidWalk &&
    midWalkReady &&
    bidOn &&
    walkState.midWalkBidArmed &&
    prevMid > bid + 1e-9 &&
    nextMid <= bid + 1e-9 &&
    inventory < maxInventory
  ) {
    walkState.midWalkBidArmed = false
    walkState.lastMidWalkAt = nowMs
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
    allowMidWalk &&
    midWalkReady &&
    askOn &&
    walkState.midWalkAskArmed &&
    prevMid < ask - 1e-9 &&
    nextMid >= ask - 1e-9 &&
    inventory > -maxInventory
  ) {
    walkState.midWalkAskArmed = false
    walkState.lastMidWalkAt = nowMs
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

  // --- Size-ahead queue + book_depth (maker) ---
  // Update both sides' queue state every poll; emit at most one fill.
  let bidFill: BookFillSignal | null = null
  let askFill: BookFillSignal | null = null

  if (bidOn && bidJoined) {
    const depthNext = depthBidAtOrAbove(next, bid)
    const depthPrev = depthBidAtOrAbove(prev, bid)
    const samePrice =
      walkState.bidQueuePrice != null &&
      Math.abs(walkState.bidQueuePrice - bid) <= 1e-9

    if (!samePrice) {
      // First poll at this bid price (join) — we are last; snapshot ahead.
      // Do not attribute prev→next consume on the join poll (we weren't in line).
      walkState.bidQueuePrice = bid
      walkState.bidQueueAhead = Math.max(0, Math.floor(depthNext))
    } else {
      // Depth increase → new contracts join behind us (ahead unchanged).
      const rawConsumed = Math.max(0, depthPrev - depthNext)
      if (rawConsumed > 0) {
        let remaining = rawConsumed
        if (walkState.bidQueueAhead > 0) {
          const burn = Math.min(walkState.bidQueueAhead, remaining)
          walkState.bidQueueAhead -= burn
          remaining -= burn
        }
        const attributed = Math.floor(remaining)
        if (
          walkState.bidQueueAhead <= 0 &&
          walkState.bidTouchPolls >= minTouch &&
          attributed >= minDepth &&
          inventory < maxInventory
        ) {
          const fillSz = Math.min(size, attributed)
          if (fillSz >= 1) {
            bidFill = {
              side: 'buy_yes',
              price: bid,
              size: fillSz,
              reason: 'book_depth',
              taker: false,
              queueAhead: walkState.bidQueueAhead,
              fillSize: fillSz,
            }
          }
        }
      }
    }
  } else {
    resetBidQueue(walkState)
  }

  if (askOn && askJoined) {
    const depthNext = depthAskAtOrBelow(next, ask)
    const depthPrev = depthAskAtOrBelow(prev, ask)
    const samePrice =
      walkState.askQueuePrice != null &&
      Math.abs(walkState.askQueuePrice - ask) <= 1e-9

    if (!samePrice) {
      walkState.askQueuePrice = ask
      walkState.askQueueAhead = Math.max(0, Math.floor(depthNext))
    } else {
      const rawConsumed = Math.max(0, depthPrev - depthNext)
      if (rawConsumed > 0) {
        let remaining = rawConsumed
        if (walkState.askQueueAhead > 0) {
          const burn = Math.min(walkState.askQueueAhead, remaining)
          walkState.askQueueAhead -= burn
          remaining -= burn
        }
        const attributed = Math.floor(remaining)
        if (
          walkState.askQueueAhead <= 0 &&
          walkState.askTouchPolls >= minTouch &&
          attributed >= minDepth &&
          inventory > -maxInventory
        ) {
          const fillSz = Math.min(size, attributed)
          if (fillSz >= 1) {
            askFill = {
              side: 'sell_yes',
              price: ask,
              size: fillSz,
              reason: 'book_depth',
              taker: false,
              queueAhead: walkState.askQueueAhead,
              fillSize: fillSz,
            }
          }
        }
      }
    }
  } else {
    resetAskQueue(walkState)
  }

  // At most one fill per poll — prefer bid if both fire (same as prior depth-first order).
  if (bidFill) return [bidFill]
  if (askFill) return [askFill]
  return []
}
