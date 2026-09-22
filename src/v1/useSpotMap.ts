import { useEffect, useState } from 'react'
import { fetchPublicSpot, normalizeSpotAsset } from '../lib/crypto15m/spot'

const SPOT_POLL_MS = 5_000

/** Light optional spot map keyed by canonical asset (e.g. BTC). */
export function useSpotMap(assets: string[]): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>({})
  const key = [...new Set(assets.map((a) => normalizeSpotAsset(a)).filter(Boolean))]
    .sort()
    .join(',')

  useEffect(() => {
    if (!key) return
    const list = key.split(',')
    let cancelled = false
    const ac = new AbortController()

    async function tick() {
      const next: Record<string, number> = {}
      await Promise.all(
        list.map(async (asset) => {
          try {
            const tick = await fetchPublicSpot(asset, ac.signal)
            if (tick) next[asset] = tick.price
          } catch {
            /* optional — leave blank */
          }
        }),
      )
      if (!cancelled && Object.keys(next).length > 0) {
        setPrices((prev) => ({ ...prev, ...next }))
      }
    }

    void tick()
    const id = setInterval(() => void tick(), SPOT_POLL_MS)
    return () => {
      cancelled = true
      ac.abort()
      clearInterval(id)
    }
  }, [key])

  return prices
}
