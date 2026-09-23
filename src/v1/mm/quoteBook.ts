/**
 * U2.3 / U2.13 — Re-export shared quote-book helpers from lib.
 * Paper-only · never places live orders.
 */
export {
  betterBookHint,
  bookHasTwoSidedTouch,
  l2SideToQuoteBook,
  marketForQuoteBook,
  midNo,
  quoteBookToL2Side,
  resolveQuoteBook,
  spreadCentsNo,
  spreadCentsYes,
  type QuoteBook,
  type QuoteBookResolve,
  type QuoteBookResolveError,
} from '../../lib/crypto15m/mm/quoteBook'
