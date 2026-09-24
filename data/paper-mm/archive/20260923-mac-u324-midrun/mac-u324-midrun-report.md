# Mac Paper MM — U3.2.4 Mid-run Forensic Dig

**Archive folder:** `data/paper-mm/archive/20260923-mac-u324-midrun/`
**Journal:** `data/paper-mm/archive/20260923-mac-u324-midrun/ui-journal.jsonl`
**Meta:** `data/paper-mm/archive/20260923-mac-u324-midrun/ui-run-meta.json`
**Fills CSV:** `data/paper-mm/archive/20260923-mac-u324-midrun/mac-u324-midrun-fills.csv`
**Journal SHA256:** `d8db9fd43b45aaed722556056cbe4a446e3caf863a9b97ed3684cf90dc5a2f3a`
**Events in session window:** 85 (34 fills + 51 info)
**Pre-session fills excluded (prior tape still in live journal):** 135
**Dug at:** 2026-09-23 20:07:23 CT
**Source:** Mac disk `ui-journal.jsonl` + `ui-run-meta.json` (disk only, no browser, no code changes).
**Rules expected:** U3.2.4 `c79f7d9` (`noOpenMinutes=4`, `hardFlatMinutes=2`, `longOpenMinMid=0.4`; tags house_mid/house_cover/flatten).

## Headline (for parent / user)

**Realized +$0.014** on **34 fills** (~25m, 19:40–20:05 CT). **9W / 4L / 2 flat**. Not deeply red at archive time — but UI realized dipped to **−$0.016** right after the 19:58 flatten cascade (ZEC/BTC/SOL), which matches the user’s “all −ve” read mid-run.

**Top 3 loss reasons:**
1. **Flatten dump on ZEC long** mid=0.49 → close 0.01 (−$0.48) — mid>40¢ so long-open curb did not block
2. **Flatten dump on BTC long** mid=0.425 → close 0.034 (−$0.396) — same mid>40¢ long bleed
3. **Flatten adverse on SOL short** 0.46 → 0.75 (−$0.29)

**Revert `noOpenMinutes` 4→2?** **No.** Zero opens taken with τ≤4 (gate looks live). The four opens in (4,5] were **net +$0.12**. Red came from flatten on earlier mid>40¢ longs / adverse short — **same bleed family as U3.2.2/3**, not from the 4m park blocking winners.

**Recommended next action:** **Keep running U3.2.4.** Do **not** revert `noOpenMinutes`. If bleeding continues, next fix is **not** the late-open park — look at **earlier cover / tighter longOpenMinMid / flatten timing on underwater longs** (diagnose-only this task; no ship).

## A. Session headline

| Field | Value |
|---|---|
| Start (meta) | 2026-09-23 19:40:25.948 CT (`2026-09-24T00:40:25.948Z`) |
| First fill | 2026-09-23 19:40:30.163 CT |
| Last fill | 2026-09-23 20:05:03.504 CT |
| Duration (start→last fill) | ~24m 38s |
| Fills | **34** |
| Round-trips closed | **15** (wins 9 / losses 4 / flat 2) |
| Open lots still open | **4** (XRP short@0.62, BTC long@0.50, HYPE short@0.44, DOGE long@0.54) |
| Cash after first fill | $99.52 |
| Cash after last fill | $100.03 |
| UI last snapshot cash | $100.05 |
| UI last snapshot fills/realized | 34 / $0.014 |
| Cash path (snap min→max) | $98.65 → $101.72 |
| Realized (sum fill realizedDelta) | **$0.0140** |
| Realized (UI snapshot) | **$0.014** |
| Realized match UI? | **YES** |
| Round-trip sum PnL | **$0.0140** |
| Unrealized (mark open lots to last mid) | **≈ −$0.02** |
| Tag mix | house_mid 19 / house_cover 9 / flatten 6 |
| centerMode | mid (all) |
| paperOnly | True |
| meta.sha | **null** (UI never stamps SHA — same as U322/U323) |

**Plain English:** U3.2.4 session started 19:40:25 CT (vite + mm-proxy restarted ~19:39 on Mac HEAD `c79f7d9`). Ran ~25m, **34 fills**, FIFO/UI realized **+$0.014**. Cover path **still firing** (9 `house_cover`). Late opens τ≤4: **0 taken**. Low-mid long opens mid≤0.4: **0**. Peak realized mid-session ~+$1.15 before flatten cascade wiped most of it.

**Authoritative realized for this window: `$0.014`** (UI snap fills=34 + FIFO RT sum + sum realizedDelta — all agree).

## B. Reconcile

- `sum(fill.realizedDelta)` = **$0.014000**
- UI last snapshot realized = **$0.014**
- Match? **YES**
- Sum of paired round-trip PnL = **$0.014000**
- Open inventory (FIFO lots not closed): 4
- Unrealized mark-to-last-mid ≈ **−$0.02**

## C. Every round-trip (open→close)

Total closed RTs: **15**. Wins $1.1900 / Losses $-1.1760 / Flat $0.0000.

| # | Asset | Dir | Open# | Close# | Open px | Close px | Size | PnL $ | Outcome | Open scen/reason | Close scen/reason | Held (min) | open mid | open τ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | XRP | long | 1 | 3 | 0.48 | 0.49 | 1 | +0.0100 | win | `house_mid`/`taker_cross` | `house_cover`/`book_depth` | 0.09 | 0.475 | 4.504 |
| 2 | NEAR | long | 2 | 5 | 0.87 | 0.93 | 1 | +0.0600 | win | `house_mid`/`mid_walk` | `house_cover`/`book_depth` | 0.12 | 0.870 | 4.453 |
| 3 | NEAR | short | 6 | 7 | 0.95 | 0.89 | 1 | +0.0600 | win | `house_mid`/`book_depth` | `flatten`/`book_depth` | 0.37 | 0.925 | 4.153 |
| 4 | BNB | short | 4 | 8 | 0.14 | 0.15 | 1 | -0.0100 | loss | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 2.39 | 0.145 | 4.385 |
| 5 | ZEC | short | 9 | 10 | 0.51 | 0.44 | 1 | +0.0700 | win | `house_mid`/`book_depth` | `house_cover`/`book_depth` | 0.20 | 0.490 | 14.431 |
| 6 | ZEC | long | 11 | 12 | 0.52 | 0.57 | 1 | +0.0500 | win | `house_mid`/`mid_walk` | `house_cover`/`book_depth` | 0.17 | 0.520 | 13.899 |
| 7 | ZEC | short | 15 | 16 | 0.67 | 0.49 | 1 | +0.1800 | win | `house_mid`/`book_depth` | `house_cover`/`book_depth` | 0.42 | 0.660 | 13.378 |
| 8 | ZEC | long | 17 | 18 | 0.52 | 0.52 | 1 | +0.0000 | flat | `house_mid`/`taker_cross` | `house_cover`/`book_depth` | 0.38 | 0.505 | 12.506 |
| 9 | BNB | short | 14 | 22 | 0.47 | 0.01 | 1 | +0.4600 | win | `house_mid`/`taker_cross` | `house_cover`/`taker_cross` | 7.01 | 0.475 | 13.412 |
| 10 | ETH | short | 20 | 23 | 0.28 | 0.01 | 1 | +0.2700 | win | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 8.02 | 0.285 | 11.822 |
| 11 | SOL | short | 13 | 24 | 0.46 | 0.75 | 1 | -0.2900 | loss | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 11.65 | 0.465 | 13.644 |
| 12 | BTC | long | 21 | 25 | 0.43 | 0.034 | 1 | -0.3960 | loss | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 7.83 | 0.425 | 9.801 |
| 13 | ZEC | long | 19 | 26 | 0.49 | 0.01 | 1 | -0.4800 | loss | `house_mid`/`mid_walk` | `flatten`/`book_depth` | 10.02 | 0.490 | 11.942 |
| 14 | NEAR | long | 30 | 31 | 0.55 | 0.55 | 1 | +0.0000 | flat | `house_mid`/`taker_cross` | `house_cover`/`book_depth` | 0.25 | 0.545 | 13.732 |
| 15 | NEAR | short | 33 | 34 | 0.23 | 0.20 | 1 | +0.0300 | win | `house_mid`/`mid_walk` | `house_cover`/`book_depth` | 0.49 | 0.230 | 10.436 |

## D. Every closed loser (detail asked)

| Asset | Dir | Open mid | τ at open | Open tag | Close tag/price | PnL | Held | Cause |
|---|---|---|---|---|---|---|---|---|
| ZEC | long | **0.490** | 11.942m | house_mid/mid_walk | flatten/book_depth @ **0.01** | **−$0.480** | 10.02m | FLATTEN; yes dumped against long; mid>0.40 curb miss |
| BTC | long | **0.425** | 9.801m | house_mid/taker_cross | flatten/taker_cross @ **0.034** | **−$0.396** | 7.83m | FLATTEN; yes dumped against long; mid>0.40 curb miss |
| SOL | short | 0.465 | 13.644m | house_mid/taker_cross | flatten/taker_cross @ **0.75** | **−$0.290** | 11.65m | FLATTEN; yes rose against short |
| BNB | short | 0.145 | 4.385m | house_mid/taker_cross | flatten/taker_cross @ 0.15 | **−$0.010** | 2.39m | FLATTEN scratch; near-late (4,5] open |

**Flatten losses sum: −$1.176.** Cover wins: 7 totaling **+$0.86**. Flatten wins: 2 totaling +$0.33.

## E. Late-open gate (noOpenMinutes=4) — blocked vs taken

Journal has **no park/skip/block events** (UI tape only logs fills + snapshots). Inference from opens taken:

| Open τ bucket | Opens taken | Notes |
|---|---|---|
| τ ≤ 2m | **0** | HardFlat park (U3.2.3+) |
| (2, 4] | **0** | **U3.2.4 noOpen park — none taken** |
| (4, 5] | **4** | XRP/NEAR/BNB/NEAR — net RT **+$0.12** |
| > 5m | **15** | Normal |

→ Gate appears **active** (no τ≤4 opens across ~25m / many assets). Cannot count “blocked” attempts without park logs. Reverting to 2 would re-allow (2,4] opens; this tape gives **no evidence** those would have been winners (none observed), and the (4,5] band was already net green.

## F. Cover path still firing?

**YES.** 9 `house_cover` fills; 7 cover-closed wins (+$0.86). Tags healthy: house_mid 19 / house_cover 9 / flatten 6. **0 S3** leftovers.

## G. SHA / session freshness

| Check | Result |
|---|---|
| `ui-run-meta.json` startedAt | 19:40:25.948 CT — **new session** after U3.2.4 ship |
| `ui-run-meta.json` sha | **null** (UI does not stamp SHA; same as prior hours) |
| Mac `git rev-parse HEAD` | **`c79f7d9`** U3.2.4 |
| Mac processes | vite + `mm-proxy.mjs` + `dev-real.mjs` started **~19:39 CT** |
| Behavior vs rules | 0 opens τ≤4, 0 low-mid longs, house_cover tags — **consistent with U3.2.4 live** |

**Not** an old session. SHA mismatch only in the sense meta.sha is always null; checkout + process restart + behavior all say U3.2.4.

## H. Compare vs prior two hours

| Session | CT window | Fills | Realized (auth) | W/L | Late≤N | Low-mid longs | Cover wins $ | Flatten loss $ |
|---|---|---|---|---|---|---|---|---|
| U3.2.2 dig | ~16:58–18:01 | 50 | **+$5.67** | 16/7 | ≤2: 1 | 10 | ~+$7.19 (w/ S3 mix) | −$1.60 |
| U3.2.3 hr1 | ~18:26–19:28 | 52 | **+$2.98** | 19/6 | ≤2: 0 | 0 | +$3.55 | −$1.53 |
| **U3.2.4 mid** | **19:40–20:05** | **34** | **+$0.014** | **9/4** | **≤4: 0** | **0** | **+$0.86** | **−$1.18** |

U324 mid-run is **~flat after 25m** vs prior hours making ~$3–5.7/hr. Fill rate is high (~83/hr) but **edge collapsed**: one flatten window (~19:58) erased ~$1.17 and wiped the +$1.15 peak. Pattern of losers = **flatten-long bleed on mid>40¢** (ZEC/BTC) + one adverse short — **not** “U3.2.4 parked the winners.”

## I. Honest verdict

1. **Is U3.2.4 causing the red?** **Mostly no.** The 4m park did not produce observable blocked-winner damage this window; (4,5] opens were net green. Cover still works.
2. **What caused the red feel?** **Bad path into hardFlat** — two mid>40¢ longs (ZEC 0.49, BTC 0.425) rode to ~0 and flattened for −$0.88 combined, plus SOL short flatten −$0.29. Same disease family as pre-U324 (flatten-long bleed), now on mids the 0.40 curb intentionally still allows.
3. **Forced flatten?** Yes — all 4 losers closed via `flatten`. That’s the exit mechanism, not a U324 regression.
4. **Revert noOpenMinutes→2?** **No** on this evidence.
5. **Next action:** **Keep running.** Re-dig after a full hour. If longs keep dumping through flat, consider a **different** fix (earlier cover / raise `longOpenMinMid` / soft-exit before hardFlat) — out of scope to ship here.

## J. Open lots at dig time

| Asset | Side | Px | Mid@open | τ@open | Opened CT |
|---|---|---|---|---|---|
| HYPE | sell_yes (short) | 0.44 | 0.445 | 14.64m | 20:00:22 CT |
| DOGE | buy_yes (long) | 0.54 | 0.530 | 14.40m | 20:00:36 CT |
| BTC | buy_yes (long) | 0.50 | 0.500 | 14.40m | 20:00:36 CT |
| XRP | sell_yes (short) | 0.62 | 0.625 | 12.93m | 20:02:04 CT |

Mark-to-last-mid unreal ≈ −$0.02 (noise).

---
PAPER ONLY. Diagnose-only; no code changes shipped.
