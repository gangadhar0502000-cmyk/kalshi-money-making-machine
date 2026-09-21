/**
 * Free public spot prices (Binance / Coinbase) — no API keys.
 * Used by the paper MM spot guard. Proxied via Vite to avoid CORS.
 *
 * CRITICAL: never default unknown assets to BTC. Unsupported → null / throw.
 */

export type SpotAsset =
  | 'BTC'
  | 'ETH'
  | 'SOL'
  | 'DOGE'
  | 'ADA'
  | 'BNB'
  | 'XRP'
  | 'BCH'
  | 'ZEC'
  | 'NEAR'
  | 'TON'
  | 'HYPE'

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
  ZEC: 'ZECUSDT',
  NEAR: 'NEARUSDT',
  TON: 'TONUSDT',
  HYPE: 'HYPEUSDT',
}

const COINBASE_PRODUCT: Record<string, string> = {
  BTC: 'BTC-USD',
  ETH: 'ETH-USD',
  SOL: 'SOL-USD',
  DOGE: 'DOGE-USD',
  ADA: 'ADA-USD',
  // BNB may 404 on Coinbase — Binance is primary
  XRP: 'XRP-USD',
  BCH: 'BCH-USD',
  ZEC: 'ZEC-USD',
  NEAR: 'NEAR-USD',
  TON: 'TON-USD',
  HYPE: 'HYPE-USD',
}

/** Name aliases only — never invent a different coin. */
const ASSET_ALIASES: Record<string, string> = {
  BITCOIN: 'BTC',
  ETHEREUM: 'ETH',
  SOLANA: 'SOL',
  DOGECOIN: 'DOGE',
  CARDANO: 'ADA',
  RIPPLE: 'XRP',
  ZCASH: 'ZEC',
  'BITCOIN CASH': 'BCH',
  BITCOINCASH: 'BCH',
}

/**
 * Canonical MM asset code for display / one-per-asset keys.
 * Applies name aliases only — does NOT collapse unknowns to BTC.
 */
export function canonicalMmAsset(asset: string): string {
  const raw = asset.trim().toUpperCase()
  if (!raw) return 'UNKNOWN'
  return ASSET_ALIASES[raw] ?? raw
}

/** True when we have a Binance and/or Coinbase symbol for this asset. */
export function isSpotSupported(asset: string): boolean {
  return normalizeSpotAsset(asset) != null
}

/**
 * Map lab asset codes onto spotable symbols.
 * Returns null for unsupported / unknown — NEVER defaults to BTC.
 */
export function normalizeSpotAsset(asset: string): string | null {
  const a = canonicalMmAsset(asset)
  if (BINANCE_SYMBOL[a] || COINBASE_PRODUCT[a]) return a
  return null
}

export const DEMO_SPOT_BASE: Record<string, number> = {
  BTC: 95_000,
  ETH: 3_400,
  SOL: 180,
  DOGE: 0.18,
  ADA: 0.7,
  BNB: 620,
  XRP: 0.6,
  BCH: 480,
  ZEC: 40,
  NEAR: 5,
  TON: 5,
  HYPE: 25,
}

/** Deterministic-ish demo walk so offline mode still exercises the guard. */
function demoSpot(asset: string): SpotTick {
  const base = DEMO_SPOT_BASE[asset]
  if (base == null || !(base > 0)) {
    throw new Error(`no demo spot for unsupported asset: ${asset}`)
  }
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
 * Poll free public spot. Prefers Binance, falls back to Coinbase, then demo walk
 * for *supported* assets only. Unknown assets fail closed (throw) — never BTC.
 */
export async function fetchPublicSpot(
  assetRaw: string,
  signal?: AbortSignal,
): Promise<SpotTick> {
  const asset = normalizeSpotAsset(assetRaw)
  if (!asset) {
    throw new Error(`unsupported spot asset: ${assetRaw}`)
  }
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
