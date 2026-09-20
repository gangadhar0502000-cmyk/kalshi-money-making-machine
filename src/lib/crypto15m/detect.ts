/**
 * Detect Kalshi crypto 15-minute style series/markets.
 *
 * Live series (public Trade API, series_ticker):
 *   KXBTC15M, KXETH15M, KXSOL15M, KXDOGE15M, KXADA15M, KXBNB15M,
 *   KXXRP15M, KXBCH15M, KXTON15M, KXNEAR15M, KXZEC15M, KXHYPE15M,
 *   KXCRYPTOCOMP15M, KXCRYPTOLEAD15M, …
 *
 * Pattern: event/series ticker starts with KX… and ends with 15M,
 * plus a crypto asset token (or CRYPTO*). Non-crypto 15M (gold, NDQ, FX)
 * are excluded.
 */

/** Known crypto 15-minute series tickers (prefer fetching these). */
export const CRYPTO_15M_SERIES: readonly string[] = [
  'KXBTC15M',
  'KXETH15M',
  'KXSOL15M',
  'KXDOGE15M',
  'KXADA15M',
  'KXBNB15M',
  'KXXRP15M',
  'KXBCH15M',
  'KXTON15M',
  'KXNEAR15M',
  'KXZEC15M',
  'KXHYPE15M',
  'KXCRYPTOCOMP15M',
  'KXCRYPTOLEAD15M',
] as const

const CRYPTO_ASSET_RE =
  /\b(BTC|BITCOIN|ETH|ETHEREUM|SOL|SOLANA|DOGE|DOGECOIN|ADA|CARDANO|BNB|XRP|RIPPLE|BCH|BITCOIN.?CASH|TON|NEAR|ZEC|ZCASH|HYPE|AVAX|LINK|LTC|DOT|MATIC|PEPE|SHIB|CRYPTO)\b/i

/** Non-crypto 15M series we explicitly skip. */
const NON_CRYPTO_15M_RE =
  /^(KX)?(GOLD|SILVER|PLATINUM|PALLADIUM|COPPER|WTI|NATGAS|NDQ|INX|GBPUSD|USDJPY|10YRRATE|30YRRATE|5YRRATE)/i

export function seriesTickerFromEvent(eventTicker: string): string {
  // Event: KXBTC15M-26SEP192045 → series KXBTC15M
  const base = eventTicker.split('-')[0] ?? eventTicker
  return base.toUpperCase()
}

export function extractAsset(seriesOrEvent: string, title?: string): string {
  const s = seriesOrEvent.toUpperCase()
  if (s.includes('CRYPTOCOMP') || s.includes('CRYPTOLEAD') || s.includes('CRYPTO')) {
    return 'CRYPTO'
  }
  const m = s.match(/^KX([A-Z0-9]+?)15M/)
  if (m?.[1]) return m[1]
  const fromTitle = title?.match(CRYPTO_ASSET_RE)
  if (fromTitle) return fromTitle[1]!.toUpperCase()
  return 'CRYPTO'
}

export function isCrypto15mSeriesTicker(seriesTicker: string): boolean {
  const s = seriesTicker.toUpperCase()
  if (NON_CRYPTO_15M_RE.test(s)) return false
  if (CRYPTO_15M_SERIES.includes(s)) return true
  // Generic: …15M and crypto token in the ticker
  if (!/15M$/.test(s)) return false
  if (/CRYPTO/.test(s)) return true
  return CRYPTO_ASSET_RE.test(s.replace(/^KX/, ''))
}

export function isCrypto15mMarket(raw: {
  ticker?: string
  event_ticker?: string
  title?: string
}): boolean {
  const event = (raw.event_ticker ?? '').toUpperCase()
  const ticker = (raw.ticker ?? '').toUpperCase()
  const series = seriesTickerFromEvent(event || ticker)
  if (isCrypto15mSeriesTicker(series)) return true

  // Fallback: title says "15 min" / "15 mins" + crypto
  const title = raw.title ?? ''
  const looks15 =
    /15\s*min/i.test(title) ||
    /next\s*15/i.test(title) ||
    /15M/.test(series) ||
    /15M/.test(ticker)
  if (!looks15) return false
  if (NON_CRYPTO_15M_RE.test(series)) return false
  return CRYPTO_ASSET_RE.test(`${title} ${ticker} ${event}`)
}
