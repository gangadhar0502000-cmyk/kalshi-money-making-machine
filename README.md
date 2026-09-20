# Kalshi Money Making Machine — Edge Finder v2

A **serious, local research tool** for finding **tradeable edge** on [Kalshi](https://kalshi.com) — not a toy “99¢ sure thing” scanner, and not structure-only vibes dressed up as trades.

> **Disclaimer:** Educational research only. Estimated fair values and edges are **not** financial advice, **not** proof of mispricing, and **never** guaranteed profit. **Printing money is not guaranteed.** You can lose money in prediction markets. Do your own research.

## Strict Mode thesis (default ON)

1. **Liquidity first** — Hard-exclude illiquid / locked books. **Sports** need higher bars: volume ≥ **5,000** *or* (OI ≥ 2,000 + spread ≤ 4¢ + mid 20–80¢). No more “Suggest YES @ 7–13¢” on thin totals with volume &lt; 500.
2. **External fair value required** — TRADE cards need NOAA, The Odds API (or demo external fixtures), not Kalshi-mid structure heuristics alone. Structure-only → **UNRANKED / research-only**, hidden in Strict Mode, never a trade CTA.
3. **Edge pp is the hero metric** — `edge_pp = (fair_prob − kalshi_mid) × 100`. “Rank score” is sorting-only and labeled as such — not confused with edge.
4. **Min |edge| ≥ 5pp** in Strict Mode defaults.

Turn Strict Mode off only to inspect UNRANKED research cards.

## Quick start (pull + env)

```bash
git pull origin main
# if your remote default is still master:
# git pull origin master

cd kalshi-money-making-machine   # if needed
npm install

cp .env.example .env
# Edit .env — get a free key at https://the-odds-api.com
# VITE_ODDS_API_KEY=your_key_here

npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build
npm run preview
```

## Odds API setup (sports edge)

Strict sports edges need **The Odds API** free key:

1. Create a free account at [https://the-odds-api.com](https://the-odds-api.com)
2. Copy the API key into `.env`:

```bash
VITE_ODDS_API_KEY=your_key_here
```

3. Restart `npm run dev` (Vite only reads env at startup)

The app matches Kalshi **MLB / NCAAF / NFL / NBA / NHL** moneylines, spreads, and totals to sportsbook consensus implied probabilities and computes Edge pp.

**Keyless fallback:** Without a key, a weak ESPN scoreboard fallback may fill a few moneylines (marked `odds_fallback`, not HIGH). Demo fixtures still show HIGH external-edge cards offline. The UI banner states how many sports markets are blocked for lacking external fair.

## Edge methodology

| Step | What happens |
| --- | --- |
| Liquidity gate | Fail illiquid / locked / wide books; **sports** use higher volume / tight-spread rules |
| Structure fair | Peer blend, ladder monotone, complements — **UNRANKED** when alone |
| External fair | **NOAA/NWS** (weather, no key); **Odds API** (sports, `VITE_ODDS_API_KEY`); ESPN keyless fallback (weak) |
| Edge | `edge_pp = (fair − mid) × 100`; TRADE lean YES if positive, NO if negative |
| Confidence | **HIGH** = external (Odds/NOAA/demo) + liquid + \|edge\| ≥ 5pp; structure-only = **UNRANKED** |
| Stake | Quarter-Kelly on TRADE cards only, capped at **5%** paper bankroll |

## Card layout

Each TRADE card shows: **Fair % · Kalshi mid % · Edge pp · Confidence · Sources**. Paper trade is disabled on UNRANKED cards.

## Project layout

```
src/
  components/     Filters (Strict Mode), trade cards, paper bankroll
  fixtures/       Demo HIGH-edge + junk
  lib/
    liquidity.ts  Hard gate (sports-aware)
    fairValue.ts  Fair blend + prefetch
    scoring.ts    Edge pp, TRADE vs RESEARCH
    external/     NOAA + Odds API + ESPN fallback
  types/          Shared TypeScript types
```

## License

Local MVP for personal research. Kalshi is a trademark of its owners; this project is unaffiliated.
