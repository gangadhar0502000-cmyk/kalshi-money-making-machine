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
- **Done in U2.13:** true NO-primary L2 queue join. Multi-book landed in U2.4.
- Paper-only / read-only; never places live trades.


## U2.4 — multi-book loose portfolio into Start/Stop/Reset

- Start runs **loose multi-book** paper MM via existing `PaperMmPortfolio` (up to 5 books from the continuous feed). Uses `strictRealism: false` / `presetsForMode(false)` / LOOSE knobs — **not** strict/tight.
- Reuses existing portfolio + engines as-is — **no new S1–S5 rules**, scenario titles, or decision-policy logic.
- Session strip shows aggregate cash / inv / realized / unrealized / fills + **`activeBooks`** (e.g. Books 3/5). `quoteBook` stays null in multi (YES/NO badge hidden).
- Fail-loud `U2.4: … — needs …` when feed is empty or portfolio under-fills / sync fails (e.g. needs continuous feed / mm-proxy :8787). App stays idle on empty feed.
- Stop freezes aggregate stats; Reset zeros session (including activeBooks) via `portfolio.resetSession`.
- **Deferred:** optional strict toggle; true NO-primary L2; single-engine YES/NO U2.3 routing remains available for residual paths but Start defaults to multi loose.
- Paper-only / read-only; never places live trades.

## U2.5 — Active books panel

- Apple-clean **Active books** list directly under the Paper MM strip (not inside the market rail).
- Session store gains `books: MmBookRow[]` (slotId, ticker, asset, inventory, realized/unrealized, fills, liveBook, midYes, message). Runner maps `portfolio.getState().books` → rows (skips null tickers); Reset clears to `[]`.
- Each row: asset + truncated ticker, mid ¢, signed inv, realized/unrealized (profit green / danger), fills, quiet live-off chip when `!liveBook`. Click row → `setSelected(ticker)` focuses hero (same selection state as market cards).
- Shown when `status !== 'idle'` or books remain; empty running state shows quiet “Waiting for books…”.
- Paper-only / read-only; never places live trades.

## U2.6 — MM strip metric polish

- Apple-clean **metric grid** in the Paper MM strip: Cash, Inv, Realized, Unrealized, Fills, Fees (when >0), quiet **Mark** (realized + unrealized).
- Hierarchy: larger tabular nums for **Cash** + **Realized**; secondary for the rest. Grouped elevated cells via `.kmm-mm-metrics` / `.kmm-mm-metric` (existing `--color-*` tokens only).
- Drop lone `activeTicker` chip when Active books panel has rows (Books N/5 stays); ticker chip only when books empty.
- Pure helper `formatSignedDollars` (+$ / −$ / $0.00). Status/help + fail-loud error lines unchanged. Books panel / market rail untouched.
- Paper-only / read-only; never places live trades.

## U2.7 — market rail MM highlight (phased UI complete)

- **Open markets** card grid highlights books the multi-book paper MM is quoting: quiet **MM** badge (`.kmm-badge--mm`) + soft left accent (`.kmm-card--mm` via `--color-tint` / separator). Selected (`.kmm-card--on`) still wins; MM badge stays visible when selected.
- While `status !== 'idle'` and `books.length > 0`, quoted tickers **float first** (stable within groups); idle keeps feed order. Section subtitle shows quiet `N quoting`.
- Denser scan: slightly tighter card padding; cleaner YES/NO bid/ask tertiary row; optional tiny `Inv ±N` from matching `mm.books` row when quoting.
- Pure helper `sortMarketsForRail` (+ `fmtMmInvHint`) in `src/v1/marketRail.ts`. MM strip metrics / Active books panel layout untouched (reads `mm.books` only).
- **Phased UI (U2.5–U2.7) complete** for Apple-clean feed + paper MM shell: active books panel, strip metric polish, market-rail highlight.
- Paper-only / read-only; never places live trades.

## U2.8 — shared cash + Start/feed strip fixes

- **Shared cash** in portfolio aggregate: one `startingCash` bankroll view — `starting + Σ(book.cash − starting)` while books live (not sum of per-book `$100` starts). Idle / no books: `startingCash + sessionLedger.realizedSpreadPnl − feesPaid` (ledger banks P&L on release, not cash). Fail-loud: non-finite → fall back to starting.
- **Start disabled look:** `.kmm-btn--primary:disabled` Apple-clean grey (not faded primary blue) while `mm.status === 'running'`.
- **Feed stale on MM strip:** when Running and `feedTone !== 'ok'`, quiet alert `U2.8: feed stale (age) — needs continuous feed / mm-proxy :8787` (amber/red); existing `updateError` still wins.
- Paper-only / read-only; never places live trades. Loose multi-book rules / fills / metrics grid / books panel / rail untouched.

## U2.9 — feed poll + proxy timeouts (stale freeze)

- **Client continuous feed:** each poll uses `AbortController` + **8s** timeout (`CONTINUOUS_FEED_FETCH_TIMEOUT_MS`). Hung `/local-api/crypto15m` self-aborts so `inFlight` clears; `lastError` like `feed poll timeout (8s) — needs mm-proxy :8787`; **does not** advance `lastSuccessAt`.
- **mm-proxy `kalshiGet`:** **10s** `AbortSignal.timeout` (`KALSHI_FETCH_TIMEOUT_MS`) so orderbook / series fan-out cannot hang forever.
- **Background universe refresh:** timer every `CRYPTO15M_CACHE_TTL_MS` (2.5s) kicks refresh when cache age ≥ TTL or never succeeded — not solely driven by client GETs under L2 storm. Health exposes optional `lastRefreshAttemptAt` (keep-last failures still record attempt; never fake `lastSuccessMs`).
- Stops false multi-minute **Degraded** while Paper MM is running 5/5. Amber threshold unchanged.
- Paper-only / read-only; never places live trades.

## U2.10 — batch L2 polls so feed stays sub-second

- **mm-proxy:** `GET /local-api/orderbooks?tickers=T1,T2,...&depth=25` (max 12, charset-validated) fans out with `kalshiGet` + `mapPool(4)`; response `{ readOnly, depth, fetchedAt, books, errors? }`. Read-only GET only.
- **Client coalescing:** `fetchLiveOrderbook` registers into a pending set and flushes one batch within `LIVE_BOOK_COALESCE_MS` (~60ms). `fetchLiveOrderbooks` hits the batch route; total batch failure falls back to single `/orderbook?ticker=` (fail-loud).
- **Continuous feed:** poll **500ms** (`CONTINUOUS_FEED_POLL_MS`); fetch timeout **4s**; UI amber at **8s** (`FEED_AMBER_AFTER_MS`) so multi-book connection starvation surfaces earlier.
- **Optional spacing:** portfolio loose Start also sets `bookPollMs: 1000` so engines do not stampede pre-coalesce.
- Fixes feed age showing **6–10s ago** with MM Running 5/5 (browser ~6 conn/host queueing crypto15m behind five L2 polls). Success: header age usually **0–2s ago**.
- Paper-only / read-only; never places live trades.

## U2.11 — abort-previous feed poll (age freeze)

- **Root cause after U2.10:** Mac curl to proxy/Vite `/local-api/crypto15m` is 2–5ms, but the browser continuousFeed poller could still show **Degraded · 10s ago**. Skip-if-`inFlight` + unreliable abort left a hung `fetch` holding `inFlight` so `lastSuccessAt` froze while the UI clock aged.
- **Abort-previous:** each poll aborts the prior `AbortController` (reason `superseded`), starts a new one with **2.5s** timeout (`CONTINUOUS_FEED_FETCH_TIMEOUT_MS = 2500`). Late responses from older generations never write the snapshot. Chained `setTimeout` (~`CONTINUOUS_FEED_POLL_MS` 500) replaces `setInterval`.
- **`fetchLocalCrypto15m`:** `cache: 'no-store'`.
- **Visibility kick:** `useContinuousFeed` calls `kickContinuousFeedPoll()` on `visibilitychange` (visible) / `focus`.
- **Strip:** when Running + feedTone ≠ ok, prefer `U2.8: feed stale (age) — {lastError}` when present (timeout vs network).
- Success: MM 5/5 Running keeps feed age **0–2s** in the active tab; failures surface `lastError` within ~2.5s instead of freezing at 10s+.
- Paper-only / read-only; never places live trades. Batch L2 (U2.10) unchanged.

## U2.12 — real feed via :8787 + honest proxy fetchedAt

- **Root cause after U2.11:** Mac curl to Vite/proxy `/local-api/crypto15m` is 2–5ms, but browser GETs to **same-origin :5173** were starved by L2 traffic (6-conn/host limit) and aborted at the feed timeout forever. Proxy already sends `Access-Control-Allow-Origin: *`.
- **Direct proxy base:** `getLocalApiBase()` / `localApiUrl()` — browser hits `http://127.0.0.1:8787` (or `VITE_MM_PROXY_BASE`) so crypto15m uses a **separate connection pool** from Vite. Node/Vitest keep relative `/local-api`.
- **Honest `lastSuccessAt`:** continuousFeed stamps from proxy `fetchedAt` only (Kalshi universe data time). **Never** `Date.now()` on HTTP 200 / cache hits. Missing `fetchedAt` → leave previous age, `lastError: proxy missing fetchedAt — not claiming fresh`.
- **Fetch timeout** 5s (`CONTINUOUS_FEED_FETCH_TIMEOUT_MS`); poll interval stays 500ms.
- **Single-flight L2 flush:** `liveBook` serializes coalesced batch GETs (`flushInFlight`) so N parallel flushes cannot re-saturate even the :8787 pool.
- **Strip:** `U2.8: feed data stale (age) — … / needs mm-proxy :8787` (clearer; codes unchanged).
- Success: MM 5/5 Running → browser polls `:8787` without timeout storm; header age tracks **proxy fetchedAt**, not HTTP cache-hit time.
- Paper-only / read-only; never places live trades. No soft DEMO feed.

## U2.13 — YES/NO primary L2 queues for paper fills

- True **YES-primary** and **NO-primary** L2 snapshots via `parseOrderbookFp(..., side)`.
- Engines poll `fetchLiveOrderbook(ticker, { side: quoteBookSide })`; coalesce waiters carry side and re-parse the batch raw book.
- Multi portfolio uses `resolveQuoteBook` / `betterBookHint` per slot (sticky while `|inventory| ≥ 1`) and sets `quoteBookSide`; feeds `marketForQuoteBook` into setMarket/onMarketTick.
- **No soft fills when L2 off** (`useLiveBook && !liveBook` → fail-loud `L2 off — no soft fills (U2.13)`). Complements = same economic outcome, different queues.
- Active books row shows quiet `Book YES` / `Book NO`; idle help mentions L2 queue fills on better YES/NO book.
- Aggregate session `quoteBook` stays null in multi; per-row is enough.
- Paper-only · read-only · never places live orders.


## U2.14 — drop & refill when L2 stays off

- Track consecutive `syncMarketUniverse` ticks per active book where `useLiveBook && !liveBook`.
- After **`l2OffDropTicks` (default 10)** ≈ 10–20s at typical feed/sync cadence:
  - **Flat inventory** → evict slot (S5.1-style) with fail-loud `U2.14: dropped TICKER — L2 off` (needs mm-proxy :8787); `rebalanceSlots` refills from ranked open crypto 15m.
  - **Open inventory** → do **not** invent flatten prices; hold with `U2.14: L2 off — holding inv until flat` on the row/strip.
- Extends existing SLOT_EVICT / `syncMarketUniverse` path — no parallel eviction system.
- Active books idle help mentions drop+refill when L2 stays off; quiet `L2 hold` chip when holding inv.
- **U2 complete** with this slice. **U3.0** (landed) removes S1–S5 playbook and pauses quoting — see below.
- Paper-only · read-only · never places live orders.


## U2.14.1 — L2-off drop on hold path, hold message, soft marks

- **A)** `syncMarketUniverse` early-return (`openN === 0` / empty ranked) now still runs `maybeEvictL2Off` when `useLiveBook` — flat L2-off books drop within ~`l2OffDropTicks` even while holding through empty/unranked feed. Refill remains gated on a valid ranked set.
- **B)** Engine `pollBook` null/error and soft-sim fail-loud no longer overwrite `U2.14: L2 off — holding inv until flat` when portfolio has noted open inventory (`holdingInvForL2Off`). Soft-fill gate unchanged.
- **C)** Multi-book under-fill strip must not erase `U2.14: dropped … — L2 off` on the same sync.
- **D)** Soft marks: when `useLiveBook && !liveBook`, freeze mark mid to last live L2 mid (`lastLiveMarkMid`); if never had L2, unrealized displays **0** (do not invent P&L from extreme feed 0¢/100¢). Documented choice — smallest honest fix; no invented fills.
- **E)** Browser L2 path remains **GET** `/local-api/orderbooks?tickers=…` (batch coalesce in `liveBook.ts`) — no POST regression.
- Paper-only · read-only · never places live orders.

## U3.0 — remove S1–S5 scenarios; pause paper quoting

- **Hard decision:** S1–S5 (and S4.1 / S4.2 / S5.1 *scenario naming/playbook*) removed as the quote decision system. Do **not** build on the old scenario path (`64a255a`+).
- **`quotingEnabled: false`** (default) — Start may enter Running for feed / L2 / books / cash observability, but **quotes never arm** (both sides OFF); no soft or L2 fills from quote matching.
- Fail-loud strip: `U3.0: paper quoting paused — needs new quote logic` (v1 `updateError` code `U3.0`).
- `decisionPolicy.decideQuoteSides` no longer opens/closes via S scenarios; `RULES.md` replaced with short pause note.
- Slot ops kept: sanity **SLOT_EVICT** + **U2.14 L2_OFF_EVICT** (user-facing strings renamed away from S5.x). Engine/portfolio/L2/feed/U2.14 stack kept.
- Journal optional `scenarioId` retained for old digests only — does not drive quotes.
- Headless runner: same pause (`quotingEnabled: false`) + log line U3.0 paused.
- **Cancelled:** prior **U3.1 scenario-observability** plan (and prior U3 “feed + engine observability” as next after U2.14) — awaiting user-defined quote logic before any re-arm.
- Paper-only · read-only · never places live orders.

## U3.1 — Family E digital FV quotes with τ-flatten

- **Chosen quote family** (research brief `docs/research/U3_QUOTE_LOGIC_RESEARCH.md` §9): **Family E** — digital `N(d₂)` FV + inventory skew + hard τ-flatten; [0,1] clamp (LAS insight). **No S1–S5** playbook.
- **`quotingEnabled: true`** default for new sessions; v1 Start / headless / legacy panel Start arm Family E (old paused saves enable on Start).
- Knobs: `annualVol` 0.70, `blackoutMinutes` 0.75, `hardFlatMinutes` 2, `quoteClampEpsilon` 0.01, `tauSkewAccel` 1, `inventorySkewCentsPerUnit` 0.15, `halfSpreadCents` 2, `maxInventory` 10.
- Fail-loud: `U3.1: no spot — needs Binance US/Coinbase` / strike / τ / `settlement blackout` (v1 `updateError` code `U3.1`).
- Fills: L2 queue only when live book (U2.13); paper-only.
- UI: quiet FV ¢ on strip/book row; remove U3.0 “paused / S*” copy when E is on.
- Paper-only · read-only · never places live orders.


## U3.1.1 — refuse opens at extreme mid (no last-min 100¢ buys)

- Symmetric open refuse: no new longs when mid ≥ toxicMidHigh; no new shorts when mid ≤ toxicMidLow. Flatten/reduce still allowed. Flat+extreme parks with `U3.1.1: extreme mid — no new opens`. Quote + fill paths. Paper-only.

## U3.1.2 — blackout flatten when inventory (not park-both)

- Bug: blackout parked **both** sides even with inventory, blocking Family E flatten in the last ~45s.
- Fix: `mins ≤ blackoutMinutes` + flat → park both; + inventory → force flatten-only (`blackout_flatten`, strip `U3.1.2: blackout flatten — exit only`). U3.1.1 open refuse still applies; reduce allowed at extreme mid. Paper-only.


## U3.2 — House mid quotes (no FV mismatch opens)

- **Product:** mid-centered maker — quote around **book mid** ± half-spread with inventory skew. **Not** Family E digital FV opens, not S1–S5, not complete-set, not FV–mid gap trading.
- FV still computed for UI/telemetry; does **not** center quotes or rank by `|FV−mid|`.
- Ranking: L2 / mid quality / tighter spread (`U3.2: rank by L2 / mid quality — not |FV−mid|`).
- Retained gates: hardFlatMinutes flatten, blackout + U3.1.2 blackout flatten, U3.1.1 extreme-mid refuse, maxInventory withdraw add-side, L2 queue fills.
- Tags: `house_mid` / `flatten` / `blackout` / `blackout_flatten` / `extreme_mid`. Strip: `U3.2: house mid quotes` when armed; invalid mid → `U3.2: no mid — needs two-sided book`.
- `quotingEnabled` remains the pause switch (headless may stay false until re-enabled).
- **Fill journal tape:** every fill JSONL row records iso/t/ticker/asset/side/price/fillSize/mid/fairValue/edgeCents/yesBid/yesAsk/centerMode/inventoryBefore/inventory/minutesLeft/queueAhead/reason/captureCents/realizedDelta/cashAfter/spot/strike/scenarioId (house tags).
- Paper-only · read-only · never places live orders.


## U3.2.1 — last-τ flatten actually exits (hit bid / fail-loud stuck)

- **Bug:** hardFlat / blackout_flatten armed the exit side but stayed **maker-only**, so long YES at mid≈1¢ sat on an ask nobody lifted through the final ~40s.
- **Fix:** flatten / blackout_flatten prices the exit **through the touch** (long → sell at best bid; short → buy at best ask). Strict paper still refuses taker **opens**; flatten reduces may `taker_cross`. No bid/ask to exit → fail-loud `U3.2.1: stuck inventory, no bid/ask`.
- Rate caps skipped for flatten exits; fill tags prefer `flatten` / `blackout_flatten` over S3/S4 labels. No S1–S5 / no FV-centering reopen.
- Paper-only · read-only · never places live orders.


## U3.2.2 — UI disk journal (never lose the Mac tape)

- **Problem:** Browser paper fills lived only in `localStorage` (`kalshi-paper-mm-session-v1`). Safari/Chrome TCC can lock agents out; Reset / profile wipe zeros the tape with no on-disk copy under the repo.
- **Fix:** mm-proxy accepts local-only `POST /local-api/paper-mm/journal` (append JSONL → `data/paper-mm/ui-journal.jsonl`) and `POST /local-api/paper-mm/run-meta` (`ui-run-meta.json` with startedAt/sha). Browser UI fire-and-forget POSTs each new fill (same rich tape fields as headless) and stamps run-meta on Start. **localStorage persist unchanged.**
- Fail-loud strip `U3.2.2: disk journal POST failed ×N` after repeated proxy failures. Quiet strip metric **Tape: N** = fills on disk.
- Headless `journal.jsonl` path untouched. Kalshi upstream remains GET-only — journal POSTs never leave the box.
- Paper-only · read-only · never places live orders.



## U3.2.3 — no late opens + curb low-mid longs + house_cover + rules archive

- **Evidence (Mac dig):** shorts→near-expiry cover won; all flatten@1¢ losses were low-mid `house_mid` longs; late open with ~1.6m left then flatten.
- **No late opens:** flat + `τ ≤ hardFlatMinutes` (default 2) → park both (`U3.2.3: no new opens — hardFlat τ`); inventory still flattens (U3.2.1).
- **Long-open curb:** no NEW long YES when `mid ≤ longOpenMinMid` (default **0.40**); shorts/covers OK (`U3.2.3: long open curb — mid too low`).
- **Tags:** new fills use `house_cover` / `house_close` instead of leftover S3/S4*; digests still read historical S*.
- **Archive forever:** `docs/rules-history/` (RULES snapshots) + `data/paper-mm/archive/` (dig tapes + INDEX). Journals never auto-purged.
- Paper-only · read-only · never places live orders.


## U3.2.4 — no new opens when flat ≤4m (soft reduce 2–4m)

- **Knob:** `noOpenMinutes` default **4**; `hardFlatMinutes` remains **2** (U3.2.1 touch flatten).
- **Flat + τ ≤ 4m** → park both (`U3.2.4: no new opens — τ≤4m`).
- **Inv ≠ 0 + 2m < τ ≤ 4m** → reduce-only (maker); **τ ≤ 2m** → existing flatten-to-touch.
- Retains U3.2.3 long-open curb (`mid ≤ 0.40`), `house_cover` tags, disk journal, rules archive.
- Paper-only · read-only · never places live orders.

## Upcoming

- **U2.5+ residual** — optional strict toggle; keyboard nav if needed.
- **U4** — Lab/MM shared book path hardening (legacy path).
- **U5** — production readiness checklist (docs, ops, residual risk burn-down).

Paper-only · read-only Kalshi · no live order placement.

## U1f — Money Machine hacker palette

Unique ops console: toxic profit green + hot gold + void black, IBM Plex Mono / Space Grotesk, scanlines, corner brackets, KMM branding. Not a fintech clone.

