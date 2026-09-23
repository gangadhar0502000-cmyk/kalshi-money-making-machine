/**
 * U2.3 — Route single-book paper MM to the better YES or NO book.
 *
 * Uses betterBookHint (tighter touch spread). Feeds the YES-oriented engine a
 * NO-touch mid/spread via marketForQuoteBook so soft mid + decisions follow
 * the tighter book.
 *
 * L2 remains the YES-combined view in U2.3 (true NO-primary L2 queue join
 * deferred). Multi-book portfolio is also out of scope.
 *
 * Paper-only · never places live orders.
 */
import type { Crypto15mMarket } from '../../types/crypto15m'
import {
  betterBookHint,
  midNo,
  spreadCentsNo,
  spreadCentsYes,
} from '../feedStatus'

export { betterBookHint, midNo, spreadCentsNo, spreadCentsYes }

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
 * L2 poll stays YES-combined in U2.3 (NO-primary L2 deferred).
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
