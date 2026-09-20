# Kalshi Crypto 15‑Minute Research Lab

A **private research lab** for discovering, paper-testing, and **killing** trading-rule hypotheses on Kalshi **crypto 15‑minute up/down** markets (BTC, ETH, SOL, …).

> **Brutal honesty:** You have **no proven rules yet**. This app does **not** ship money-printing signals. **No edge until a rule survives paper.** These are hypotheses. Printing money is not guaranteed. You can lose money in prediction markets.

Default landing UI = **Crypto 15m Lab**. The older **Edge Finder** (ESPN / Polymarket / NOAA) remains behind a secondary tab.

## Fully free — no API keys

| Source | Role |
| --- | --- |
| Kalshi public Trade API (proxied) | Open crypto 15m markets, bids/asks, volume |
| Bundled demo fixtures | Offline / rate-limit fallback |

No Odds API, no paid keys, no account required for market data.

## How crypto 15m markets are detected

1. Prefer known series tickers: `KXBTC15M`, `KXETH15M`, `KXSOL15M`, `KXDOGE15M`, `KXADA15M`, `KXBNB15M`, `KXXRP15M`, `KXBCH15M`, `KXTON15M`, `KXNEAR15M`, `KXZEC15M`, `KXHYPE15M`, `KXCRYPTOCOMP15M`, `KXCRYPTOLEAD15M`, …
2. Heuristic: series ends with `15M` **and** looks crypto (asset token / `CRYPTO*`); non-crypto 15m (gold, NDQ, FX, rates) are excluded.
3. Fallback: scan open markets and keep titles like “price up in next 15 mins?” with crypto assets.

Live example titles: “BTC price up in next 15 mins?”

## Experiment rules (candidates — not advice)

All knobs live in **`src/lib/crypto15m/ruleConfig.ts`**. Default stance: **many situations = NO TRADE**.

| Id | Type | Hypothesis (short) |
| --- | --- | --- |
| `wide_spread_block` | veto | Spread wider than X¢ → NO TRADE |
| `thin_book_block` | veto | Tiny size / locked mid → NO TRADE |
| `extreme_late_block` | veto | Little time left + mid extreme → NO TRADE |
| `late_fade` | signal | Last N minutes, fade a sharp mid move (UNPROVEN) |
| `early_momentum` | signal | First N minutes, continue a sharp move (UNPROVEN) |

Paper suggestions only appear when a signal matches **and** no veto fires. Fee estimate uses Kalshi-style `ceil(0.07·C·P·(1−P))` (to the cent).

## Paper journal — kill losing rules

Every taken paper suggestion is logged locally (browser `localStorage`):

- rule id, market, side, entry, time left, estimated fees
- resolve via market result poll when detectable, or **manual** mark (YES/NO/win/loss/void)
- per-rule stats: **n, win rate, net after estimated fees**

**Do not promote a rule** until:

1. Sample size ≥ **50** resolved paper trades (see `PAPER.minSampleToDiscuss` in `ruleConfig.ts`)
2. Net after fees is still positive
3. You have held out / out-of-sample checks (this lab does not do that for you)

Until then: treat every suggestion as an experiment to **falsify**.

## How to use the lab (Mac)

```bash
git clone https://github.com/gangadhar0502000-cmyk/kalshi-money-making-machine.git
cd kalshi-money-making-machine
git pull origin main   # or: git pull origin master

npm install
cp .env.example .env   # optional; no keys required

npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

- Land on **Crypto 15m Lab**
- Watch the feed (title, ticker, time left, YES bid/ask, mid, spread, volume, fee≈1)
- Select a market → live context (countdown, mid trail, thin-book warning)
- Read **EXPERIMENTS** panel — usually **NO TRADE**
- When a paper suggestion appears, log it → resolve later → inspect per-rule stats
- Edit constants in `src/lib/crypto15m/ruleConfig.ts`, restart/refresh, re-test

```bash
npm run build
npm run preview
```

## Project layout

```
src/
  App.tsx                 Tabs: Crypto 15m Lab (default) | Edge Finder
  components/crypto15m/   Lab UI (feed, context, experiments, journal)
  lib/crypto15m/
    detect.ts             Series / market detection
    ruleConfig.ts         ALL experiment knobs
    rules.ts              Rule evaluators (hypotheses)
    fees.ts               Kalshi-style fee estimate
    api.ts                Public API fetch + demo fallback
    journal.ts            Paper journal + per-rule stats
  fixtures/demoCrypto15m.ts
  components/EdgeFinderApp.tsx   Secondary general edge finder
```

## Edge Finder (secondary)

Still available for sports/politics/weather research via free ESPN / Polymarket / NOAA. Same disclaimer: research only, not guaranteed profit.

## License

Local MVP for personal research. Kalshi is a trademark of its owners; this project is unaffiliated.
