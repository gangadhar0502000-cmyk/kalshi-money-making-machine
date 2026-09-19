# Kalshi Money Making Machine

Zero-cost **research + opportunity scanner** for [Kalshi](https://kalshi.com) prediction markets. Runs entirely on your machine with `npm` — no paid APIs, no paid hosting, no real-money auto-trading.

> **Disclaimer:** This is an educational research tool. Edge scores are transparent heuristics for scanning markets — **not** financial advice, **not** guaranteed profit, and **not** proof of mispricing. Prediction markets can lose money. Do your own research.

## Quick start

```bash
cd kalshi-money-making-machine
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

## What you get

1. **Live market scanner** — fetches open markets from Kalshi’s free public Trade API (`/trade-api/v2/markets`) via a Vite dev proxy (avoids browser CORS). If live fetch fails (rate limit, network, etc.), the app **falls back to bundled demo fixtures** and shows a banner.
2. **Edge scoring** — composite 0–100 score from liquidity/volume, bid–ask spread, distance from 50¢, time-to-expiry, and recent volume momentum. Each card shows a short rationale + score breakdown.
3. **Trade ideas board** — ranked opportunities with YES/NO quotes, volume, suggested side, suggested stake % of paper bankroll, and a link toward the Kalshi market page.
4. **Paper bankroll** — `localStorage` portfolio: configurable starting cash, open/close paper trades, mark-to-market P&L. **No real orders.**
5. **Dashboard UI** — dark theme, filters (category, min volume, min score, search), refresh, last-updated.

## Free / zero-cost notes

| Piece | Cost |
| --- | --- |
| Kalshi public market endpoints | Free, no API key for market list |
| This app (Vite static SPA) | Free to run locally |
| Hosting | Optional — any static host; not required |
| Paid data / LLM APIs | **Not used** |

No secrets are required. There is no `.env` by default. If you add private keys later for authenticated trading, keep them in `.env` (gitignored) — this MVP does **not** place real trades.

## How scoring works

Weights (approximate):

| Signal | Weight | Idea |
| --- | --- | --- |
| Liquidity (log volume + open interest) | 28% | Can you actually trade size? |
| Bid–ask spread | 27% | Tight books waste less edge |
| Distance from 50¢ | 15% | Less “coin-flip” noise for scanning |
| Time to expiry | 15% | Prefer days–weeks over minutes or years |
| 24h volume momentum | 15% | Recent activity vs stale books |

**Suggested side** leans toward the cheaper side when the mid is skewed (heuristic scan cue only).

**Suggested stake** uses a *tiny* assumed edge inside a **quarter-Kelly**-style formula, capped at **5%** of bankroll — deliberately conservative so the UI never implies huge bets. You can switch the paper panel to a flat % instead.

## API details

Dev proxy (see `vite.config.ts`):

- `/api/kalshi/*` → `https://api.elections.kalshi.com/trade-api/v2/*`
- `/api/kalshi-ext/*` → `https://external-api.kalshi.com/trade-api/v2/*`

Docs: [Kalshi market data quick start](https://docs.kalshi.com/getting_started/quick_start_market_data).

## Project layout

```
src/
  components/     UI (board, filters, paper bankroll, banner)
  fixtures/       Demo markets for offline / rate-limit fallback
  lib/            API client, scoring, paper portfolio, formatters
  types/          Shared TypeScript types
```

## License

Built as a local MVP for personal research. Kalshi is a trademark of its owners; this project is unaffiliated.
