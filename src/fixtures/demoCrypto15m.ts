import type { KalshiMarketRaw } from '../types/kalshi'

/**
 * Offline crypto 15m samples when live API is unavailable / rate-limited.
 *
 * floor_strike is REQUIRED so estimateYesFairValue runs offline.
 * Strikes sit slightly off DEMO_FIXTURE_SPOTS / DEMO_SPOT_BASE (fixture-only; not live spot) so |FV−mid| is non-trivial.
 * Window times are regenerated on every call so markets stay open across refresh.
 */

/** Align with fixture-only DEMO_SPOT_BASE in spot.ts — unit tests only, never live MM. */
export const DEMO_FIXTURE_SPOTS: Record<string, number> = {
  BTC: 95_000,
  ETH: 3_400,
  SOL: 180,
  DOGE: 0.18,
  BNB: 620,
}

function windowAroundNow(openOffsetMin: number, closeOffsetMin: number) {
  const now = Date.now()
  return {
    open_time: new Date(now + openOffsetMin * 60_000).toISOString(),
    close_time: new Date(now + closeOffsetMin * 60_000).toISOString(),
  }
}

/**
 * Fresh demo universe — call on every offline fetch so close_time stays ahead of now.
 */
export function getDemoCrypto15m(): KalshiMarketRaw[] {
  const w1 = windowAroundNow(-6, 9) // mid-window
  const w2 = windowAroundNow(-12, 3) // late window
  const w3 = windowAroundNow(-1, 14) // early window
  const w4 = windowAroundNow(-7, 8)
  const w5 = windowAroundNow(-4, 11)

  return [
    {
      ticker: 'KXBTC15M-DEMO-MID-45',
      event_ticker: 'KXBTC15M-DEMO-MID',
      title: 'BTC price up in next 15 mins?',
      status: 'active',
      category: 'Crypto',
      open_time: w1.open_time,
      close_time: w1.close_time,
      yes_bid_dollars: '0.4800',
      yes_ask_dollars: '0.5100',
      no_bid_dollars: '0.4900',
      no_ask_dollars: '0.5200',
      last_price_dollars: '0.5000',
      volume_fp: '420000',
      volume_24h_fp: '2100000',
      open_interest_fp: '88000',
      yes_bid_size_fp: '1200',
      yes_ask_size_fp: '980',
      // Slightly below demo spot → mild ITM YES → FV > mid ≈ 0.495
      floor_strike: 94_200,
      rules_primary:
        'Demo: YES if BTC RTI average at end ≥ floor_strike (reference at window open).',
    } as KalshiMarketRaw,
    {
      ticker: 'KXETH15M-DEMO-LATE-45',
      event_ticker: 'KXETH15M-DEMO-LATE',
      title: 'ETH price up in next 15 mins?',
      status: 'active',
      category: 'Crypto',
      open_time: w2.open_time,
      close_time: w2.close_time,
      yes_bid_dollars: '0.7200',
      yes_ask_dollars: '0.7500',
      no_bid_dollars: '0.2500',
      no_ask_dollars: '0.2800',
      last_price_dollars: '0.7400',
      volume_fp: '155000',
      volume_24h_fp: '800000',
      open_interest_fp: '22000',
      yes_bid_size_fp: '400',
      yes_ask_size_fp: '350',
      // Spot 3400 vs strike 3450 → OTM; mid is rich → ask-side edge
      floor_strike: 3_450,
      rules_primary: 'Demo late-window ETH up/down.',
    } as KalshiMarketRaw,
    {
      ticker: 'KXSOL15M-DEMO-EARLY-45',
      event_ticker: 'KXSOL15M-DEMO-EARLY',
      title: 'SOL price up in next 15 mins?',
      status: 'active',
      category: 'Crypto',
      open_time: w3.open_time,
      close_time: w3.close_time,
      yes_bid_dollars: '0.3800',
      yes_ask_dollars: '0.4100',
      no_bid_dollars: '0.5900',
      no_ask_dollars: '0.6200',
      last_price_dollars: '0.4000',
      volume_fp: '62000',
      volume_24h_fp: '310000',
      open_interest_fp: '11000',
      yes_bid_size_fp: '220',
      yes_ask_size_fp: '180',
      floor_strike: 176,
      rules_primary: 'Demo early-window SOL up/down.',
    } as KalshiMarketRaw,
    {
      ticker: 'KXDOGE15M-DEMO-WIDE-45',
      event_ticker: 'KXDOGE15M-DEMO-WIDE',
      title: 'DOGE price up in next 15 mins?',
      status: 'active',
      category: 'Crypto',
      open_time: w4.open_time,
      close_time: w4.close_time,
      yes_bid_dollars: '0.3000',
      yes_ask_dollars: '0.4200',
      no_bid_dollars: '0.5800',
      no_ask_dollars: '0.7000',
      last_price_dollars: '0.3600',
      volume_fp: '8000',
      volume_24h_fp: '40000',
      open_interest_fp: '1500',
      yes_bid_size_fp: '20',
      yes_ask_size_fp: '15',
      floor_strike: 0.175,
      rules_primary: 'Demo wide/thin book — should veto.',
    } as KalshiMarketRaw,
    {
      ticker: 'KXBNB15M-DEMO-EXTREME-45',
      event_ticker: 'KXBNB15M-DEMO-EXTREME',
      title: 'BNB price up in next 15 mins?',
      status: 'active',
      category: 'Crypto',
      open_time: w5.open_time,
      close_time: w5.close_time,
      yes_bid_dollars: '0.9600',
      yes_ask_dollars: '0.9800',
      no_bid_dollars: '0.0200',
      no_ask_dollars: '0.0400',
      last_price_dollars: '0.9700',
      volume_fp: '90000',
      volume_24h_fp: '400000',
      open_interest_fp: '15000',
      yes_bid_size_fp: '500',
      yes_ask_size_fp: '400',
      floor_strike: 610,
      rules_primary: 'Demo extreme late mid — should veto.',
    } as KalshiMarketRaw,
  ]
}

/** @deprecated Prefer getDemoCrypto15m() so windows stay open. */
export const DEMO_CRYPTO_15M: KalshiMarketRaw[] = getDemoCrypto15m()
