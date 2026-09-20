import type { Crypto15mMarket } from '../../types/crypto15m'
import { recordMid } from './midHistory'

/**
 * Seed synthetic mid history for demo markets so experiment rules can fire offline.
 * Live markets build history via polling only.
 */
export function seedDemoMidHistory(markets: Crypto15mMarket[]): void {
  const now = Date.now()
  for (const m of markets) {
    if (!m.ticker.includes('DEMO')) continue
    // Clear-ish path: push a trail ending at current mid
    if (m.ticker.includes('LATE')) {
      // Sharp rise into late window → late_fade may suggest PAPER_NO
      recordMid(m.ticker, m.midYes - 0.18, now - 80_000)
      recordMid(m.ticker, m.midYes - 0.1, now - 40_000)
      recordMid(m.ticker, m.midYes, now)
    } else if (m.ticker.includes('EARLY')) {
      // Sharp drop early → early_momentum may suggest PAPER_NO
      recordMid(m.ticker, m.midYes + 0.12, now - 45_000)
      recordMid(m.ticker, m.midYes + 0.05, now - 20_000)
      recordMid(m.ticker, m.midYes, now)
    } else {
      recordMid(m.ticker, m.midYes - 0.02, now - 60_000)
      recordMid(m.ticker, m.midYes, now)
    }
  }
}
