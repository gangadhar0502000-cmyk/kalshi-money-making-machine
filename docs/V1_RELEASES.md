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

## U1g — YES+NO books + better-book hint

- Feed hero and cards show **YES and NO** bid/ask/mid (complements: YES+NO≈$1 — **same economic outcome**, different queues).
- `midNo` / `spreadCentsYes` / `spreadCentsNo` / `betterBookHint` (tighter touch spread → YES|NO|TIE). True queue-ahead needs L2 sizes on both books (future).
- UI refine: keep void + profit green + gold + KMM ops tone; tone down heavy scanlines / blink / `//` clutter.

## U1h — Apple-clean UI

- Abandon hacker/CRT/toxic-green ops look. **Dark Apple** (iOS dark): `#000` background, `#1c1c1e` grouped cards, `#2c2c2e` separators, label `#f5f5f7`, secondary `#98989d`, tint `#0a84ff`, live/profit `#30d158`, warn `#ff9f0a`.
- System / SF-like stack only (`-apple-system`, BlinkMacSystemFont, SF Pro Text, Segoe UI). Drop Space Grotesk / IBM Plex / Google font links, scanlines, corner brackets, neon glow.
- Header: “Kalshi 15m” + quiet “Paper · v1”; subtle status pills. Hero keeps YES+NO dual books + quiet better-book badge + soft window progress. Market cards: large radius, soft blue selected ring. Single thin tint sparkline.
- Feed functionality unchanged (`midNo`, `betterBookHint`, continuous poll).


## U2.1 — Paper MM Start/Stop/Reset framework

- Apple-clean v1 UI keeps the continuous feed + YES/NO display.
- Neat **Paper MM** control strip: **Start** (primary blue, disabled while running), **Stop** (disabled when not running), **Reset** (always available; soft clear — no confirm required for paper).
- Status pill: Idle / Running (+ elapsed) / Stopped.
- Framework/state only (`src/v1/mm/mmSession.ts` + `useMmSession`): `status`, `startedAt`, `stoppedAt`, `resetCount`; subscribe + React hook. Reset clears session counters / returns to idle; does **not** wipe the feed.
- Placeholder copy: “Quoting engine arrives in a later update.”
- **Out of scope for U2.1:** multi-book quoting, fills, S1–S5 engine, legacy `PaperMmPanel`. Those attach in **U2.2+**.
- Paper-only / read-only; never places live trades.

## U2.2 — Paper MM run + P&L into Start/Stop/Reset

- Reuses `PaperMmEngine` (`src/lib/crypto15m/mm/engine.ts`) with **strict realism** defaults on a **single focused ticker** from the continuous feed (not full 5-book portfolio yet).
- `mmRunner` binds Start → engine start + feed ticks (mid via `onMarketTick`; L2/spot via engine polls); Stop → clean stop (numbers freeze); Reset → `resetSession` + zero session P&L/inventory/fills/errors (feed untouched).
- Session stats in Apple-clean strip: cash, inv, realized, unrealized, fills (+ fees when non-zero).
- Fail-loud `updateError: { code: 'U2.2', message, dependency }` — e.g. `U2.2: orderbook failed — needs mm-proxy :8787` when L2 proxy is down; app does not crash.
- YES-book MM only this update. Complement YES/NO / `betterBookHint` routing → **U2.3**. Multi-book portfolio port deferred.
- Paper-only / read-only; never places live trades.


## U2.3 — betterBookHint YES/NO quote routing

- Single-book paper MM routes to the **better YES or NO book** via `betterBookHint` (tighter touch spread).
- `quoteBook.ts`: `resolveQuoteBook` (sticky while `|inventory| ≥ 1`), `marketForQuoteBook` (feeds YES-oriented engine NO-touch mid/spread when quoting NO).
- Session store tracks `quoteBook: 'YES' | 'NO' | null`; Apple-clean strip shows quiet `Book YES` / `Book NO` badge.
- Fail-loud `U2.3: … — needs …` when the preferred book is one-sided and the other is not a usable two-sided fallback.
- **Keep U2.2 behavior** when hint is YES / TIE defaults to YES.
- **Deferred:** true NO-primary L2 queue join (L2 remains YES-combined this slice); multi-book (5-book) portfolio.
- Paper-only / read-only; never places live trades.

## Upcoming

- **U2.4+** — density / keyboard nav polish if needed; true NO-primary L2; multi-book portfolio into the session shell.
- **U3** — feed + engine observability (richer health, divergence alarms).
- **U4** — Lab/MM shared book path hardening (legacy path).
- **U5** — production readiness checklist (docs, ops, residual risk burn-down).

Paper-only · read-only Kalshi · no live order placement.

## U1f — Money Machine hacker palette

Unique ops console: toxic profit green + hot gold + void black, IBM Plex Mono / Space Grotesk, scanlines, corner brackets, KMM branding. Not a fintech clone.

