# Kalshi Money Making Machine — Edge Finder v3

A **serious, local research tool** for finding **tradeable edge** on [Kalshi](https://kalshi.com) — not a toy “99¢ sure thing” scanner, and not structure-only vibes dressed up as trades.

> **Disclaimer:** Educational research only. Estimated fair values and edges are **not** financial advice, **not** proof of mispricing, and **never** guaranteed profit. **Printing money is not guaranteed.** You can lose money in prediction markets. Do your own research.

## Fully free — no API keys

Edge Finder v3 uses **only keyless public feeds**:

| Source | Role | Notes |
| --- | --- | --- |
| **ESPN** public scoreboard/odds | Sports fair (MLB / NFL / NBA / NCAAF, NHL when present) | Match by team/title; moneylines, spreads, totals when ESPN embeds book odds. Coverage can be incomplete. |
| **Polymarket** Gamma API | Event-style fair when titles overlap | Politics / macro / crypto-style markets; title-similarity match. Not every Kalshi market has a twin. |
| **NOAA / NWS** | Weather fair | Already keyless via `api.weather.gov`. |
| Kalshi **cross-market structure** | Research-only | Peer blend / ladder / complements stay **UNRANKED** unless combined with a free external above. |

**Honest limits:** Free ESPN and Polymarket feeds can be incomplete, delayed, or rate-limited. Matched titles can be wrong. This remains a **research tool**, not a guaranteed profit machine.

## Strict Mode thesis (default ON)

1. **Liquidity first** — Hard-exclude illiquid / locked books. **Sports** need higher bars: volume ≥ **5,000** *or* (OI ≥ 2,000 + spread ≤ 4¢ + mid 20–80¢).
2. **Free external fair required** — TRADE cards need ESPN, Polymarket, NOAA, or demo external fixtures — not Kalshi-mid structure heuristics alone. Structure-only → **UNRANKED / research-only**, hidden in Strict Mode, never a trade CTA.
3. **Edge pp is the hero metric** — `edge_pp = (fair_prob − kalshi_mid) × 100`. “Rank score” is sorting-only and labeled as such.
4. **Min |edge| ≥ 5pp** in Strict Mode defaults.

Turn Strict Mode off only to inspect UNRANKED research cards.

## Quick start

```bash
git pull origin main
# if your remote default is still master:
# git pull origin master

cd kalshi-money-making-machine   # if needed
npm install

# No paid keys. Optional empty .env:
cp .env.example .env

npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build
npm run preview
```

## How free sports matching works

1. Parse each Kalshi sports market (league, moneyline / spread / total, team hints from title/ticker).
2. Prefetch ESPN scoreboards for leagues present (MLB, NCAAF, NFL, NBA, …) via the Vite proxy (`/api/espn` → `site.api.espn.com`).
3. Match games by team name / abbreviation / title tokens.
4. Convert embedded American odds (moneyline, point spread, total) to implied probabilities → Edge pp vs Kalshi mid.
5. If ESPN has no match, sports stay research-only unless a demo fixture supplies external fair.

Polymarket matching is separate: prefetch active Gamma markets, score title token overlap, and use YES outcome price when similarity is high (skips single-game sports tickets that belong on ESPN).

## Edge methodology

| Step | What happens |
| --- | --- |
| Liquidity gate | Fail illiquid / locked / wide books; **sports** use higher volume / tight-spread rules |
| Structure fair | Peer blend, ladder monotone, complements — **UNRANKED** when alone |
| External fair | **NOAA/NWS** (weather); **ESPN** (sports); **Polymarket** (overlapping events); demo fixtures offline |
| Edge | `edge_pp = (fair − mid) × 100`; TRADE lean YES if positive, NO if negative |
| Confidence | **HIGH** = free external + liquid + \|edge\| ≥ 5pp; structure-only = **UNRANKED** |
| Stake | Quarter-Kelly on TRADE cards only, capped at **5%** paper bankroll |

Demo fixtures still show **HIGH** free-external edges offline. The UI banner appears only when free fetches fail (e.g. rate limit) — never “buy a paid key”.

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
    external/     NOAA + ESPN + Polymarket (all keyless)
  types/          Shared TypeScript types
```

## License

Local MVP for personal research. Kalshi is a trademark of its owners; this project is unaffiliated.
