/**
 * YES/NO quote-book routing (U2.3 / U2.13).
 *
 * Uses betterBookHint (tighter touch spread). Feeds the YES-oriented engine a
 * NO-touch mid/spread via marketForQuoteBook.
 * U2.13: engines poll true YES- or NO-primary L2 via quoteBookSide.
 *
 * Paper-only · never places live orders.
 */
import type { Crypto15mMarket } from '../../../types/crypto15m'

export type QuoteBook = 'YES' | 'NO'

export type QuoteBookResolveError = {
  message: string
  dependency: string
}

export type QuoteBookResolve = {
  book: QuoteBook
  switched: boolean
  error: QuoteBookResolveError | null
}

/** Mid for the NO book (complement of YES when NO touch missing). YES+NO ≈ $1. */
export function midNo(
  m: Pick<Crypto15mMarket, 'noBid' | 'noAsk' | 'midYes'>,
): number {
  if (m.noBid > 0 && m.noAsk > 0) return (m.noBid + m.noAsk) / 2
  if (m.noBid > 0) return m.noBid
  if (m.noAsk > 0) return m.noAsk
  if (Number.isFinite(m.midYes)) return Math.max(0, Math.min(1, 1 - m.midYes))
  return 0.5
}

/** YES touch spread in cents (uses market.spreadCents when book is two-sided). */
export function spreadCentsYes(
  m: Pick<Crypto15mMarket, 'yesBid' | 'yesAsk' | 'spreadCents'>,
): number {
  if (m.yesBid > 0 && m.yesAsk > 0) {
    if (Number.isFinite(m.spreadCents) && m.spreadCents >= 0) return m.spreadCents
    return Math.max(0, (m.yesAsk - m.yesBid) * 100)
  }
  return Number.POSITIVE_INFINITY
}

/** NO touch spread in cents. */
export function spreadCentsNo(
  m: Pick<Crypto15mMarket, 'noBid' | 'noAsk'>,
): number {
  if (m.noBid > 0 && m.noAsk > 0) return Math.max(0, (m.noAsk - m.noBid) * 100)
  return Number.POSITIVE_INFINITY
}

/**
 * Better book by tighter touch spread (proxy for queue until L2 sizes exist on both).
 * Same economic outcome either side (complements); different queues → fill rates.
 */
export function betterBookHint(
  m: Pick<Crypto15mMarket, 'yesBid' | 'yesAsk' | 'noBid' | 'noAsk' | 'spreadCents'>,
): 'YES' | 'NO' | 'TIE' {
  const ys = spreadCentsYes(m)
  const ns = spreadCentsNo(m)
  const yOk = Number.isFinite(ys)
  const nOk = Number.isFinite(ns)
  if (!yOk && !nOk) return 'TIE'
  if (!yOk) return 'NO'
  if (!nOk) return 'YES'
  const yr = Math.round(ys * 100) / 100
  const nr = Math.round(ns * 100) / 100
  if (yr < nr) return 'YES'
  if (nr < yr) return 'NO'
  return 'TIE'
}

/** YES needs yesBid+yesAsk > 0; NO needs noBid+noAsk > 0. */
export function bookHasTwoSidedTouch(
  m: Pick<Crypto15mMarket, 'yesBid' | 'yesAsk' | 'noBid' | 'noAsk'>,
  book: QuoteBook,
): boolean {
  if (book === 'YES') return m.yesBid > 0 && m.yesAsk > 0
  return m.noBid > 0 && m.noAsk > 0
}

function bookHasAnyTouch(
  m: Pick<Crypto15mMarket, 'yesBid' | 'yesAsk' | 'noBid' | 'noAsk'>,
  book: QuoteBook,
): boolean {
  if (book === 'YES') return m.yesBid > 0 || m.yesAsk > 0
  return m.noBid > 0 || m.noAsk > 0
}

/**
 * Pick which book to quote.
 * - Open inventory + sticky → keep sticky (no mid-position flip).
 * - Else betterBookHint: YES→YES, NO→NO, TIE→ sticky ?? 'YES'.
 * - Preferred one-sided → try other if two-sided; else fail-loud and still
 *   return a book (any touch preferred, else YES).
 */
export function resolveQuoteBook(
  m: Pick<
    Crypto15mMarket,
    'yesBid' | 'yesAsk' | 'noBid' | 'noAsk' | 'spreadCents'
  >,
  sticky: QuoteBook | null,
  inventory: number,
): QuoteBookResolve {
  if (Math.abs(inventory) >= 1 && sticky != null) {
    const ok = bookHasTwoSidedTouch(m, sticky)
    return {
      book: sticky,
      switched: false,
      error: ok
        ? null
        : {
            message: `${sticky} book one-sided`,
            dependency: 'two-sided YES and NO touch on feed',
          },
    }
  }

  const hint = betterBookHint(m)
  const preferred: QuoteBook =
    hint === 'YES' ? 'YES' : hint === 'NO' ? 'NO' : (sticky ?? 'YES')
  const other: QuoteBook = preferred === 'YES' ? 'NO' : 'YES'

  if (bookHasTwoSidedTouch(m, preferred)) {
    return {
      book: preferred,
      switched: sticky != null && sticky !== preferred,
      error: null,
    }
  }

  if (bookHasTwoSidedTouch(m, other)) {
    return {
      book: other,
      switched: sticky != null && sticky !== other,
      error: null,
    }
  }

  let book: QuoteBook = 'YES'
  if (bookHasAnyTouch(m, preferred)) book = preferred
  else if (bookHasAnyTouch(m, other)) book = other

  return {
    book,
    switched: sticky != null && sticky !== book,
    error: {
      message: `${preferred} book one-sided`,
      dependency: 'two-sided YES and NO touch on feed',
    },
  }
}

/**
 * Map market fields so the YES-oriented engine quotes the chosen book.
 * When NO: swap NO touch into yesBid/yesAsk/midYes/spreadCents.
 * Ticker/asset/strike left intact so spot/FV still target the same event.
 */
export function marketForQuoteBook(
  m: Crypto15mMarket,
  book: QuoteBook,
): Crypto15mMarket {
  if (book === 'YES') return m
  const noSpread = spreadCentsNo(m)
  return {
    ...m,
    yesBid: m.noBid,
    yesAsk: m.noAsk,
    midYes: midNo(m),
    spreadCents: Number.isFinite(noSpread) ? noSpread : m.spreadCents,
  }
}

/** Config / L2 side for a QuoteBook. */
export function quoteBookToL2Side(book: QuoteBook): 'yes' | 'no' {
  return book === 'NO' ? 'no' : 'yes'
}

export function l2SideToQuoteBook(side: 'yes' | 'no'): QuoteBook {
  return side === 'no' ? 'NO' : 'YES'
}
