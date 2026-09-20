# Kalshi Crypto 15‑Minute Research Lab

A **private research lab** for discovering, paper-testing, and **killing** trading-rule hypotheses on Kalshi **crypto 15‑minute up/down** markets (BTC, ETH, SOL, …).

> **Brutal honesty:** You have **no proven rules yet**. This app does **not** ship money-printing signals. **No edge until a rule survives paper.** These are hypotheses. Printing money is not guaranteed. You can lose money in prediction markets.

Default landing UI = **Crypto 15m Lab**. The older **Edge Finder** (ESPN / Polymarket / NOAA) remains behind a secondary tab.

## Fully free — no API keys

| Source | Role |
| --- | --- |
| Kalshi public Trade API (proxied) | Open crypto 15m markets, bids/asks, volume |
| Binance / Coinbase public tickers (proxied) | Spot guard for paper MM — no keys |
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



## 15m MM (Paper) — spread capture sim

**Paper only. Live MM needs API keys. On 15m, bots cancel faster — this teaches whether YOUR params survive.**

Open the **15m MM (Paper)** tab (next to Crypto Lab / Backtest). Simulates a two-sided YES bid/ask around mid:

| Knob | Role |
| --- | --- |
| Half-spread (¢) | Distance from mid for bid & ask |
| Size | Contracts per side |
| Max inventory | Position limit (suppresses the crowded side) |
| Spot move % / $ / window | Spot guard thresholds |
| Quote refresh (ms) | Timer requotes (+ requote when mid moves) |

**Spot guard (critical):** polls free public BTC/ETH/… spot via Binance (primary) or Coinbase (fallback) — **no API keys**. If spot moves more than X% **or** $Y within Z seconds → cancel simulated quotes / widen / inventory skew (Avellaneda-lite). Events land in the cancel log.

**Fills are not friendly:** mid-cross when market mid walks through your quote, plus random fills with **toxicity bias** when spot moved against your resting side (adverse selection). Dashboard splits **realized spread P&L** vs **unrealized inventory P&L**.

No live order placement in this build.

## Backtest (settled history)

**Past ≠ future. Kill losers.**

The Crypto 15m Lab includes a **Backtest** panel that replays the same experiment rules on historical windows.

**Default source = REAL** bundled Kalshi snapshot (`src/fixtures/liveSettledCrypto15m.json`): settled `status=settled` markets + **1-minute candlesticks** from the public Trade API. Not synthetic.

| Mode | What it uses |
| --- | --- |
| **REAL bundled (default)** | Committed snapshot of real settled crypto 15m + candles |
| Auto | Same REAL snapshot (avoids live 429 stalls); use Live to refresh |
| Live | Public API `status=settled` + candlesticks (often rate-limited) |
| DEMO | Synthetic paths only — clearly labeled; last resort |

Per rule (signals): n, win rate, net $ after Kalshi-style fees (`ceil(0.07·C·P·(1−P))`), max drawdown, profit factor. Vetoes report fire counts. Quiet windows → **NO TRADE**.

**Honesty:** public history is thin under rate limits. The shipped snapshot is real but small (BTC 15m windows captured at build time). Expand it by re-fetching when the API allows — do not invent fills.

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
- Open **Backtest** → Run backtest (Auto / Live / Bundled / Demo)
- Open **15m MM (Paper)** → pick a market → Start paper MM → watch spot guard + toxic fills
- Edit constants in `src/lib/crypto15m/ruleConfig.ts`, restart/refresh, re-test

```bash
npm run build
npm run preview
```

## Project layout

```
src/
  App.tsx                 Tabs: Crypto 15m Lab (default) | Edge Finder
                         Lab sub-tabs: Crypto Lab | Backtest | 15m MM (Paper)
  components/crypto15m/   Lab UI (feed, context, experiments, journal, paper MM)
  lib/crypto15m/
    detect.ts             Series / market detection
    ruleConfig.ts         ALL experiment knobs
    rules.ts              Rule evaluators (hypotheses)
    fees.ts               Kalshi-style fee estimate
    api.ts                Public API fetch + demo fallback
    journal.ts            Paper journal + per-rule stats
    spot.ts               Free public Binance/Coinbase spot (MM guard)
    mm/                   Paper market maker engine + config
    backtest/             Settled-history rule replay engine
  fixtures/demoCrypto15m.ts
  fixtures/liveSettledCrypto15m.json  Bundled real settled+candles snapshot
  components/EdgeFinderApp.tsx   Secondary general edge finder
```

## Edge Finder (secondary)

Still available for sports/politics/weather research via free ESPN / Polymarket / NOAA. Same disclaimer: research only, not guaranteed profit.

## License

Local MVP for personal research. Kalshi is a trademark of its owners; this project is unaffiliated.
