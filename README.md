# Kalshi Money Making Machine — Edge Finder

A **serious, local research tool** for finding **tradeable edge** on [Kalshi](https://kalshi.com) — not a toy “99¢ sure thing” scanner.

> **Disclaimer:** Educational research only. Estimated fair values and edges are **not** financial advice, **not** proof of mispricing, and **never** guaranteed profit. You can lose money in prediction markets. Do your own research.

## Thesis

1. **Liquidity first** — Hard-exclude illiquid / locked books (near 1¢ or 99¢ with no depth, tiny volume, empty books, absurd spreads). Prefer mid-priced markets (default **15–85¢**) with real volume and tight spreads.
2. **Fair value** — Estimate P(YES) from free signals when possible; otherwise honest **structure / cross-market** heuristics labeled weak.
3. **Edge = fair − Kalshi mid** (percentage points). Surface only above a minimum |edge| threshold. Tag confidence (**HIGH** only when an external fair source was used **and** liquidity passed).
4. **Trade cards** — Market, Kalshi mid, fair estimate, edge %, liquidity score, suggested side, Kelly-lite stake %, and **why** (sources). Paper-trade locally; never auto-routes real orders.

## Quick start

```bash
cd kalshi-money-making-machine
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build
npm run preview
```

Optional sports odds (free tier key — app works without it):

```bash
cp .env.example .env
# edit VITE_ODDS_API_KEY=...
```

## Edge methodology (specific)

| Step | What happens |
| --- | --- |
| Liquidity gate | Fail if no bid/ask, volume &lt; 2k, OI &lt; 500, spread &gt; 8¢, or near-locked mid with thin depth |
| Structure fair | Same-event peer blend, nested threshold monotone fixes, complement mids (`1 − peer`), mild 50¢ shrink — **documented weak** when alone |
| External fair | **NOAA/NWS** (`api.weather.gov`, no key) for detectable weather/temp markets; optional **The Odds API** if `VITE_ODDS_API_KEY` set |
| Edge | `edge_pp = (fair_prob − kalshi_mid) × 100`; suggest YES if positive, NO if negative |
| Confidence | **HIGH** = external source (live NOAA/odds or demo-external fixture) + liquidity OK + |edge| ≥ ~3pp; else MEDIUM/LOW |
| Stake | Quarter-Kelly on estimated edge, capped at **5%** of paper bankroll |

Demo fixtures intentionally include **liquid mid-priced edge examples** and **illiquid junk** so you can prove the filter works offline.

## External sources

| Source | Key required? | Behavior |
| --- | --- | --- |
| Kalshi public Trade API | No | Market list / mids (Vite proxy) |
| Cross-market / structure | No | Always on; weak when sole signal |
| NOAA / NWS forecast | No | Weather-tagged markets via `/api/noaa` proxy |
| The Odds API | Optional | Sports; skipped if no `VITE_ODDS_API_KEY` |

No paid APIs are required. Do not commit secrets (`.env` is gitignored).

## UI filters (defaults hide junk)

- Min liquidity score
- Min |edge| %
- Mid-price band (¢)
- Category + search
- “Hide illiquid / failed gate” (on by default)

## Interpreting a HIGH edge card

**HIGH** means: the book passed the liquidity gate **and** at least one external fair source contributed (NOAA, Odds API, or an explicit demo-external fixture offline). It does **not** mean the trade is safe, arb’d, or profitable. Always read the source details on the card and size with Kelly-lite / flat % paper rules.

## Project layout

```
src/
  components/     Edge filters, trade cards, paper bankroll
  fixtures/       Demo markets (edges + junk)
  lib/
    liquidity.ts  Hard liquidity gate
    fairValue.ts  Fair blend + prefetch
    scoring.ts    Edge, confidence, Kelly-lite
    external/     NOAA + optional Odds API
  types/          Shared TypeScript types
```

## License

Local MVP for personal research. Kalshi is a trademark of its owners; this project is unaffiliated.
