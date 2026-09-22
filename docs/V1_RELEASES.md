# v1 releases (incremental)

Frozen pre-v1 baseline: git tag `legacy-v0`.

## U1 — continuous feed spine

- **mm-proxy** in-memory cache for `/local-api/crypto15m` (TTL ~2.5s): serve fresh cache immediately; background refresh when stale; never wipe last-good open set on transient refresh failure (`stale` / `cacheAgeMs` / `refreshing`).
- **Continuous feed client** polls proxy every **1s** (proxy-only on the MM path). Shared so Lab + Paper MM stay aligned when legacy is open.
- Honest UI freshness from client `lastSuccessAt` (updates on every successful poll, including cache hits): amber >15s, red >60s.

## U1b — clean feed-only UI (this release)

- **Brand-new** default UI (`src/v1/V1App.tsx`): status row (proxy health, market count, **Feed ok Xs ago**, stale/refreshing, soft last error) + open crypto 15m table (asset/ticker, minutes left, yes bid/ask, mid, optional spot).
- Default `src/App.tsx` mounts **only** V1App — no Discover/test/kill Lab, Edge Finder, Paper MM panel, honesty walls, or playbook banners.
- Old Crypto 15m Lab + Edge Finder demoted to recovery via `?legacy=1` or `#legacy` (`src/v1/LegacyApp.tsx`). Not primary tabs.
- Feed spine unchanged: `continuousFeed` + mm-proxy cache remain infrastructure.

## U1c — polished feed UI

- Product-grade dark trading layout for the feed-only homepage: header with live pulse, metric strip (markets / feed age / proxy / next close), refined markets table (asset badge + name, ticker, time left with urgency, bid/ask/mid/spread/spot), designed empty states, minimal footer.

## U1d — terminal split feed UI

- Distinctive **trading console** layout (not metric-cards + table): full-width top bar (mark + Kalshi 15m + v1 chip; compact Live/age/mkts/proxy pills), **~38% market rail** (sortable compact rows, selection ring/accent) + **~62% focus pane** (huge mid, bid/ask, mm:ss countdown + window progress, spot/spread, mid **sparkline** via `getMidHistory`).
- Continuous feed already normalizes + `recordMid` on each poll so history fills in the focus sparkline.
- Pure helpers: `windowProgress`, `fmtCountdownMmSs`, `sparklinePolylinePoints`, `midDeltaCents`.

## Upcoming

- **U2** — density / keyboard nav polish if needed.
- **U3** — feed + engine observability (richer health, divergence alarms).
- **U4** — Lab/MM shared book path hardening (legacy path).
- **U5** — production readiness checklist (docs, ops, residual risk burn-down).

Paper-only · read-only Kalshi · no live order placement.
