/**
 * Free public spot prices (Binance / Coinbase) — no API keys.
 * Used by the paper MM spot guard. Proxied via Vite to avoid CORS.
 */

export type SpotAsset = 'BTC' | 'ETH' | 'SOL' | 'DOGE' | 'ADA' | 'BNB' | 'XRP' | 'BCH'

export interface SpotTick {
  asset: string
  price: number
  source: 'binance' | 'coinbase' | 'demo'
  t: number
}

const BINANCE_SYMBOL: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  DOGE: 'DOGEUSDT',
  ADA: 'ADAUSDT',
  BNB: 'BNBUSDT',
  XRP: 'XRPUSDT',
  BCH: 'BCHUSDT',
}

const COINBASE_PRODUCT: Record<string, string> = {
  BTC: 'BTC-USD',
  ETH: 'ETH-USD',
  SOL: 'SOL-USD',
  DOGE: 'DOGE-USD',
  ADA: 'ADA-USD',
  // BNB / BCH / XRP may 404 on Coinbase — Binance is primary
  XRP: 'XRP-USD',
  BCH: 'BCH-USD',
}

/** Map lab asset codes (from series) onto spotable symbols. */
export function normalizeSpotAsset(asset: string): string {
  const a = asset.toUpperCase()
  if (a === 'BITCOIN') return 'BTC'
  if (a === 'ETHEREUM') return 'ETH'
  if (a === 'SOLANA') return 'SOL'
  if (a === 'DOGECOIN') return 'DOGE'
  if (a === 'CARDANO') return 'ADA'
  if (a === 'RIPPLE') return 'XRP'
  if (BINANCE_SYMBOL[a]) return a
  return 'BTC'
}

const DEMO_BASE: Record<string, number> = {
  BTC: 95_000,
  ETH: 3_400,
  SOL: 180,
  DOGE: 0.18,
  ADA: 0.7,
  BNB: 620,
  XRP: 0.6,
  BCH: 480,
}

/** Deterministic-ish demo walk so offline mode still exercises the guard. */
function demoSpot(asset: string): SpotTick {
  const base = DEMO_BASE[asset] ?? 100
  const t = Date.now()
  // ~0.05% wobble + occasional larger jumps so guard can fire in demo
  const wobble = Math.sin(t / 4000) * 0.0004 + Math.sin(t / 17000) * 0.0008
  const jump = Math.sin(t / 33000) > 0.97 ? 0.0025 * Math.sign(Math.sin(t / 11000)) : 0
  const price = base * (1 + wobble + jump)
  return { asset, price, source: 'demo', t }
}

async function fetchBinance(asset: string, signal?: AbortSignal): Promise<SpotTick | null> {
  const symbol = BINANCE_SYMBOL[asset]
  if (!symbol) return null
  const url = `/api/binance/api/v3/ticker/price?symbol=${symbol}`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`binance ${res.status}`)
  const data = (await res.json()) as { price?: string }
  const price = Number.parseFloat(data.price ?? '')
  if (!Number.isFinite(price) || price <= 0) throw new Error('binance bad price')
  return { asset, price, source: 'binance', t: Date.now() }
}

async function fetchCoinbase(asset: string, signal?: AbortSignal): Promise<SpotTick | null> {
  const product = COINBASE_PRODUCT[asset]
  if (!product) return null
  const url = `/api/coinbase/products/${product}/ticker`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`coinbase ${res.status}`)
  const data = (await res.json()) as { price?: string }
  const price = Number.parseFloat(data.price ?? '')
  if (!Number.isFinite(price) || price <= 0) throw new Error('coinbase bad price')
  return { asset, price, source: 'coinbase', t: Date.now() }
}

/**
 * Poll free public spot. Prefers Binance, falls back to Coinbase, then demo walk.
 */
export async function fetchPublicSpot(
  assetRaw: string,
  signal?: AbortSignal,
): Promise<SpotTick> {
  const asset = normalizeSpotAsset(assetRaw)
  try {
    const b = await fetchBinance(asset, signal)
    if (b) return b
  } catch {
    /* try coinbase */
  }
  try {
    const c = await fetchCoinbase(asset, signal)
    if (c) return c
  } catch {
    /* demo */
  }
  return demoSpot(asset)
}

export interface SpotMoveStats {
  /** Absolute $ move over the window (max-min). */
  dollarRange: number
  /** % move over the window (range / first). */
  pctRange: number
  /** Signed last − first. */
  signedDollar: number
  signedPct: number
  samples: number
  first: number | null
  last: number | null
}

/** Ring-buffer helper for spot guard. */
export class SpotHistory {
  private buf: { t: number; price: number }[] = []
  private readonly maxKeepMs: number

  constructor(maxKeepSec = 120) {
    this.maxKeepMs = maxKeepSec * 1000
  }

  push(price: number, t = Date.now()): void {
    this.buf.push({ t, price })
    const cutoff = t - this.maxKeepMs
    while (this.buf.length > 0 && this.buf[0]!.t < cutoff) this.buf.shift()
  }

  clear(): void {
    this.buf = []
  }

  stats(windowSec: number, now = Date.now()): SpotMoveStats {
    const cutoff = now - windowSec * 1000
    const pts = this.buf.filter((p) => p.t >= cutoff)
    if (pts.length === 0) {
      return {
        dollarRange: 0,
        pctRange: 0,
        signedDollar: 0,
        signedPct: 0,
        samples: 0,
        first: null,
        last: null,
      }
    }
    let min = pts[0]!.price
    let max = pts[0]!.price
    for (const p of pts) {
      if (p.price < min) min = p.price
      if (p.price > max) max = p.price
    }
    const first = pts[0]!.price
    const last = pts[pts.length - 1]!.price
    const dollarRange = max - min
    const pctRange = first > 0 ? (dollarRange / first) * 100 : 0
    const signedDollar = last - first
    const signedPct = first > 0 ? (signedDollar / first) * 100 : 0
    return { dollarRange, pctRange, signedDollar, signedPct, samples: pts.length, first, last }
  }
}
