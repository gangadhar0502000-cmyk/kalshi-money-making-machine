# Mac Paper MM — U3.2.3 Hour 1 Forensic Dig

**Archive folder:** `data/paper-mm/archive/20260923-mac-u323-hr1/`
**Journal:** `/workspace/kalshi-money-making-machine/data/paper-mm/archive/20260923-mac-u323-hr1/ui-journal.jsonl`
**Meta:** `/workspace/kalshi-money-making-machine/data/paper-mm/archive/20260923-mac-u323-hr1/ui-run-meta.json`
**Fills CSV:** `/workspace/kalshi-money-making-machine/data/paper-mm/archive/20260923-mac-u323-hr1/mac-u323-hr1-fills.csv`
**Journal SHA256:** `dfddc7ace6355cce4c08fa884ef39c37996e14f421f9ed3be9702cc511786cc7`
**Events in session window:** 122 (52 fills + 70 info)
**Pre-session fills excluded (prior tape still in live journal):** 79
**Dug at:** 2026-09-23 19:32:21 CT
**Source:** Mac disk `ui-journal.jsonl` + `ui-run-meta.json` (disk only, no browser, no code changes).
**Rules:** U3.2.3 (hardFlatMinutes=2.0, longOpenMinMid=0.4; tags house_mid/house_cover/house_close/flatten).

## A. Session headline

| Field | Value |
|---|---|
| Start (meta) | 2026-09-23 18:26:48.108 CT (`2026-09-23T23:26:48.108Z`) |
| First fill | 2026-09-23 18:26:54.323 CT |
| Last fill | 2026-09-23 19:28:00.992 CT |
| Duration (start→last fill) | 1h 1m 12s |
| Fills | **52** |
| Round-trips closed | **26** (wins 19 / losses 6 / flat 1) |
| Open lots still open | **0** (net inv units 0) |
| Cash after first fill | $99.28 |
| Cash after last fill | $99.83 |
| UI last snapshot cash | $101.46 |
| UI last snapshot fills/realized | 54 / $2.811 |
| Cash path (snap min→max) | $98.78 → $102.26 |
| Realized (sum fill realizedDelta) | **$3.4600** |
| Realized (UI snapshot) | **$2.811** |
| Realized match UI? | **NO — see reconcile** |
| Round-trip sum PnL | **$2.9810** |
| Unrealized (mark open lots to last mid) | **$0.0000** |
| End inventory by asset | `{'BNB': 0, 'BTC': 0, 'DOGE': 0, 'ETH': 0, 'HYPE': 0, 'NEAR': 0, 'SOL': 0, 'XRP': 0, 'ZEC': 0}` |
| centerMode | `{'mid': 52}` |
| paperOnly | True |

**Plain English:** U3.2.3 session started 2026-09-23 18:26:48.108 CT, ran ~61m, took **52 fills**. Realized **$3.460** (UI last snap $2.811). Closed RTs 19W/6L. Tag mix: {'house_mid': 27, 'flatten': 8, 'house_cover': 17}. **No leftover S3 tags** (0). Late opens (ml≤2.0): 0. Low-mid long opens (mid≤0.4): 0.

**Authoritative realized for this hour: `$2.981`** (UI snapshot `fills=52` + FIFO round-trip sum). `sum(fill.realizedDelta)=$3.460` overstates because settlement fill#12 DOGE `sell_yes@0.001` stamped `realizedDelta=0` while FIFO closed a long for `-$0.479`. A later snapshot with `fills=54;realized=2.811` is inconsistent with the 52-fill flat tape and is ignored.

## B. Reconcile

- `sum(fill.realizedDelta)` = **$3.460000**
- UI last snapshot realized = **$2.811**
- Match? **NO**
- Sum of paired round-trip PnL = **$2.981000**
- Gap (sum_rd − RT PnL) ≈ **$0.479000** — expected if open inventory / settlement paths differ.
- Open inventory (FIFO lots not closed): 0

## C. Every round-trip (open→close)

Total closed RTs: **26**. Wins $4.9900 / Losses $-2.0090 / Flat $0.0000.

| # | Asset | Dir | Open# | Close# | Open px | Close px | Size | PnL $ | Outcome | Open scen/reason | Close scen/reason | Held (min) | Tickers |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ZEC | long | 1 | 3 | 0.72 | 0.98 | 1 | +0.2600 | win | `house_mid`/`mid_walk` | `flatten`/`mid_walk` | 1.11 | `KXZEC15M-26SEP231930-30` → `KXZEC15M-26SEP231930-30` |
| 2 | HYPE | short | 2 | 4 | 0.14 | 0.56 | 1 | -0.4200 | loss | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 1.07 | `KXHYPE15M-26SEP231930-30` → `KXHYPE15M-26SEP231930-30` |
| 3 | NEAR | long | 6 | 8 | 0.45 | 0.47 | 1 | +0.0200 | win | `house_mid`/`taker_cross` | `house_cover`/`book_depth` | 0.72 | `KXNEAR15M-26SEP231945-45` → `KXNEAR15M-26SEP231945-45` |
| 4 | XRP | short | 7 | 10 | 0.39 | 0.01 | 1 | +0.3800 | win | `house_mid`/`taker_cross` | `house_cover`/`taker_cross` | 10.47 | `KXXRP15M-26SEP231945-45` → `KXXRP15M-26SEP231945-45` |
| 5 | ZEC | short | 5 | 11 | 0.53 | 0.01 | 1 | +0.5200 | win | `house_mid`/`book_depth` | `house_cover`/`taker_cross` | 11.26 | `KXZEC15M-26SEP231945-45` → `KXZEC15M-26SEP231945-45` |
| 6 | DOGE | long | 9 | 12 | 0.48 | 0.001 | 1 | -0.4790 | loss | `house_mid`/`mid_walk` | `house_mid`/`settlement` | 14.00 | `KXDOGE15M-26SEP231945-45` → `KXDOGE15M-26SEP232000-00` |
| 7 | DOGE | short | 13 | 15 | 0.79 | 0.71 | 1 | +0.0800 | win | `house_mid`/`taker_cross` | `house_cover`/`book_depth` | 1.46 | `KXDOGE15M-26SEP232000-00` → `KXDOGE15M-26SEP232000-00` |
| 8 | ZEC | long | 14 | 18 | 0.76 | 0.92 | 1 | +0.1600 | win | `house_mid`/`taker_cross` | `house_cover`/`book_depth` | 1.61 | `KXZEC15M-26SEP232000-00` → `KXZEC15M-26SEP232000-00` |
| 9 | NEAR | short | 17 | 20 | 0.79 | 0.78 | 1 | +0.0100 | win | `house_mid`/`book_depth` | `house_cover`/`book_depth` | 1.34 | `KXNEAR15M-26SEP232000-00` → `KXNEAR15M-26SEP232000-00` |
| 10 | NEAR | short | 21 | 22 | 0.86 | 0.82 | 1 | +0.0400 | win | `house_mid`/`book_depth` | `house_cover`/`book_depth` | 0.08 | `KXNEAR15M-26SEP232000-00` → `KXNEAR15M-26SEP232000-00` |
| 11 | ZEC | long | 19 | 24 | 0.9 | 0.91 | 1 | +0.0100 | win | `house_mid`/`mid_walk` | `house_cover`/`book_depth` | 3.04 | `KXZEC15M-26SEP232000-00` → `KXZEC15M-26SEP232000-00` |
| 12 | XRP | long | 16 | 26 | 0.82 | 0.99 | 1 | +0.1700 | win | `house_mid`/`taker_cross` | `house_cover`/`book_depth` | 7.94 | `KXXRP15M-26SEP232000-00` → `KXXRP15M-26SEP232000-00` |
| 13 | ZEC | long | 25 | 27 | 0.93 | 0.99 | 1 | +0.0600 | win | `house_mid`/`book_depth` | `house_cover`/`book_depth` | 0.82 | `KXZEC15M-26SEP232000-00` → `KXZEC15M-26SEP232000-00` |
| 14 | HYPE | short | 23 | 28 | 0.58 | 0.75 | 1 | -0.1700 | loss | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 5.09 | `KXHYPE15M-26SEP232000-00` → `KXHYPE15M-26SEP232000-00` |
| 15 | HYPE | short | 31 | 32 | 0.63 | 0.62 | 1 | +0.0100 | win | `house_mid`/`mid_walk` | `house_cover`/`book_depth` | 0.52 | `KXHYPE15M-26SEP232015-15` → `KXHYPE15M-26SEP232015-15` |
| 16 | BNB | short | 29 | 36 | 0.47 | 0.01 | 1 | +0.4600 | win | `house_mid`/`taker_cross` | `house_cover`/`book_depth` | 11.03 | `KXBNB15M-26SEP232015-15` → `KXBNB15M-26SEP232015-15` |
| 17 | BTC | short | 34 | 37 | 0.74 | 0.05 | 1 | +0.6900 | win | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 9.89 | `KXBTC15M-26SEP232015-15` → `KXBTC15M-26SEP232015-15` |
| 18 | ETH | long | 30 | 38 | 0.67 | 0.32 | 1 | -0.3500 | loss | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 11.95 | `KXETH15M-26SEP232015-15` → `KXETH15M-26SEP232015-15` |
| 19 | HYPE | long | 35 | 39 | 0.84 | 0.42 | 1 | -0.4200 | loss | `house_mid`/`mid_walk` | `flatten`/`taker_cross` | 2.76 | `KXHYPE15M-26SEP232015-15` → `KXHYPE15M-26SEP232015-15` |
| 20 | DOGE | short | 33 | 40 | 0.57 | 0.08 | 1 | +0.4900 | win | `house_mid`/`mid_walk` | `flatten`/`taker_cross` | 9.91 | `KXDOGE15M-26SEP232015-15` → `KXDOGE15M-26SEP232015-15` |
| 21 | NEAR | long | 42 | 44 | 0.57 | 0.57 | 1 | +0.0000 | flat | `house_mid`/`mid_walk` | `house_cover`/`book_depth` | 1.88 | `KXNEAR15M-26SEP232030-30` → `KXNEAR15M-26SEP232030-30` |
| 22 | DOGE | long | 47 | 48 | 0.83 | 0.99 | 1 | +0.1600 | win | `house_mid`/`mid_walk` | `house_cover`/`book_depth` | 8.20 | `KXDOGE15M-26SEP232030-30` → `KXDOGE15M-26SEP232030-30` |
| 23 | NEAR | short | 46 | 49 | 0.61 | 0.09 | 1 | +0.5200 | win | `house_mid`/`book_depth` | `house_cover`/`book_depth` | 9.36 | `KXNEAR15M-26SEP232030-30` → `KXNEAR15M-26SEP232030-30` |
| 24 | SOL | long | 45 | 50 | 0.8 | 0.99 | 1 | +0.1900 | win | `house_mid`/`taker_cross` | `house_cover`/`book_depth` | 9.86 | `KXSOL15M-26SEP232030-30` → `KXSOL15M-26SEP232030-30` |
| 25 | ETH | short | 43 | 51 | 0.76 | 0 | 1 | +0.7600 | win | `house_mid`/`taker_cross` | `house_cover`/`taker_cross` | 10.99 | `KXETH15M-26SEP232030-30` → `KXETH15M-26SEP232030-30` |
| 26 | BTC | short | 41 | 52 | 0.63 | 0.8 | 1 | -0.1700 | loss | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 12.85 | `KXBTC15M-26SEP232030-30` → `KXBTC15M-26SEP232030-30` |

## D. Why it made money

**Winning RTs: 19 totaling $4.9900**

### Patterns (evidence)
- Close scenario `house_cover`: 16 wins, $3.5500
- Close scenario `flatten`: 3 wins, $1.4400
- Cover/close engine (`house_cover`/`house_close`): 16 wins, $3.5500

### Top winning examples
| Asset | Dir | Open→Close px | PnL | Open | Close | Notes |
|---|---|---|---|---|---|---|
| ETH | short | 0.76→0 | $+0.7600 | #43 `house_mid`/`taker_cross` | #51 `house_cover`/`taker_cross` | held 11.0m ml_open=13.057 |
| BTC | short | 0.74→0.05 | $+0.6900 | #34 `house_mid`/`taker_cross` | #37 `flatten`/`taker_cross` | held 9.9m ml_open=11.881 |
| ZEC | short | 0.53→0.01 | $+0.5200 | #5 `house_mid`/`book_depth` | #11 `house_cover`/`taker_cross` | held 11.3m ml_open=14.738 |
| NEAR | short | 0.61→0.09 | $+0.5200 | #46 `house_mid`/`book_depth` | #49 `house_cover`/`book_depth` | held 9.4m ml_open=12.331 |
| DOGE | short | 0.57→0.08 | $+0.4900 | #33 `house_mid`/`mid_walk` | #40 `flatten`/`taker_cross` | held 9.9m ml_open=11.898 |
| BNB | short | 0.47→0.01 | $+0.4600 | #29 `house_mid`/`taker_cross` | #36 `house_cover`/`book_depth` | held 11.0m ml_open=14.293 |
| XRP | short | 0.39→0.01 | $+0.3800 | #7 `house_mid`/`taker_cross` | #10 `house_cover`/`taker_cross` | held 10.5m ml_open=13.951 |
| ZEC | long | 0.72→0.98 | $+0.2600 | #1 `house_mid`/`mid_walk` | #3 `flatten`/`mid_walk` | held 1.1m ml_open=3.103 |

## E. Why it lost — every losing RT

**Losing RTs: 6 totaling $-2.0090**

| Asset | Dir | Open→Close | PnL | Held min | Open | Close | Cause (evidence) |
|---|---|---|---|---|---|---|---|
| DOGE | long | 0.48→0.001 | $-0.4790 | 14.00 | #9 `house_mid`/`mid_walk` @ 2026-09-23 18:31:28.520 CT | #12 `house_mid`/`settlement` @ 2026-09-23 18:45:28.442 CT | 1¢/near-0 dump; yes price fell against long |
| HYPE | short | 0.14→0.56 | $-0.4200 | 1.07 | #2 `house_mid`/`taker_cross` @ 2026-09-23 18:26:56.324 CT | #4 `flatten`/`taker_cross` @ 2026-09-23 18:28:00.750 CT | FLATTEN exit; yes price rose against short |
| HYPE | long | 0.84→0.42 | $-0.4200 | 2.76 | #35 `house_mid`/`mid_walk` @ 2026-09-23 19:10:15.649 CT | #39 `flatten`/`taker_cross` @ 2026-09-23 19:13:01.353 CT | FLATTEN exit; yes price fell against long |
| ETH | long | 0.67→0.32 | $-0.3500 | 11.95 | #30 `house_mid`/`taker_cross` @ 2026-09-23 19:01:04.231 CT | #38 `flatten`/`taker_cross` @ 2026-09-23 19:13:01.352 CT | FLATTEN exit; yes price fell against long |
| HYPE | short | 0.58→0.75 | $-0.1700 | 5.09 | #23 `house_mid`/`taker_cross` @ 2026-09-23 18:52:55.461 CT | #28 `flatten`/`taker_cross` @ 2026-09-23 18:58:01.115 CT | FLATTEN exit; yes price rose against short |
| BTC | short | 0.63→0.8 | $-0.1700 | 12.85 | #41 `house_mid`/`taker_cross` @ 2026-09-23 19:15:09.707 CT | #52 `flatten`/`taker_cross` @ 2026-09-23 19:28:00.992 CT | FLATTEN exit; yes price rose against short |

## F. Why fills taken — tags / reasons breakdown

### By reason
| reason | n | % | sum realizedDelta |
|---|---|---|---|
| `taker_cross` | 23 | 44.2% | $1.3100 |
| `book_depth` | 19 | 36.5% | $1.8900 |
| `mid_walk` | 9 | 17.3% | $0.2600 |
| `settlement` | 1 | 1.9% | $0.0000 |

### By scenarioId
| scenarioId | n | % | sum realizedDelta |
|---|---|---|---|
| `house_mid` | 27 | 51.9% | $0.0000 |
| `house_cover` | 17 | 32.7% | $3.5500 |
| `flatten` | 8 | 15.4% | $-0.0900 |

### By side
- `buy_yes`: 26
- `sell_yes`: 26

### centerMode
- {'mid': 52}

**Leftover S3/S* tags:** 0 — NONE (U3.2.3 house_cover/house_close clean)

## G. Flatten / blackout / late opens / low-mid longs

### Flatten fills: 8
| # | CT | Asset | Side | Price | capture¢ | realizedΔ | reason | minutesLeft | inv before→after |
|---|---|---|---|---|---|---|---|---|---|
| 3 | 2026-09-23 18:28:00.746 CT | ZEC | sell_yes | 0.98 | 26 | 0.26 | `mid_walk` | 1.998 | 1→0 |
| 4 | 2026-09-23 18:28:00.750 CT | HYPE | buy_yes | 0.56 | -42.00000000000001 | -0.42000000000000004 | `taker_cross` | 1.998 | -1→0 |
| 28 | 2026-09-23 18:58:01.115 CT | HYPE | buy_yes | 0.75 | -17.000000000000004 | -0.17000000000000004 | `taker_cross` | 1.990 | -1→0 |
| 37 | 2026-09-23 19:13:01.350 CT | BTC | buy_yes | 0.05 | 69 | 0.69 | `taker_cross` | 1.985 | -1→0 |
| 38 | 2026-09-23 19:13:01.352 CT | ETH | sell_yes | 0.32 | -35 | -0.35000000000000003 | `taker_cross` | 1.985 | 1→0 |
| 39 | 2026-09-23 19:13:01.353 CT | HYPE | sell_yes | 0.42 | -42 | -0.42 | `taker_cross` | 1.985 | 1→0 |
| 40 | 2026-09-23 19:13:01.355 CT | DOGE | buy_yes | 0.08 | 48.99999999999999 | 0.48999999999999994 | `taker_cross` | 1.985 | -1→0 |
| 52 | 2026-09-23 19:28:00.992 CT | BTC | buy_yes | 0.8 | -17.000000000000004 | -0.17000000000000004 | `taker_cross` | 1.996 | -1→0 |

### Blackout events: 0 fills / 0 infos
- none in journal text

### Late opens (minutesLeft≤hardFlat=2.0, |inv|↑): **0**
- none

### Late opens (prior dig def ml<5, |inv|↑, non-flatten): **4** (for apples-to-apples vs prior report’s 2)
- fill#1 ZEC buy_yes @ 0.72 ml=3.103 scen=`house_mid`
- fill#2 HYPE sell_yes @ 0.14 ml=3.069 scen=`house_mid`
- fill#25 ZEC buy_yes @ 0.93 ml=3.375 scen=`house_mid`
- fill#35 HYPE buy_yes @ 0.84 ml=4.748 scen=`house_mid`

### Low-mid long opens (buy_yes NEW long, mid≤0.4): **0**
- none

### Flatten $ impact
- Sum realizedDelta on flatten fills: **$-0.0900**
- Losing RTs closed by flatten: 5 totaling $-1.5300

## H. By-asset table

| Asset | Fills | Buy/Sell | Σ realizedΔ | RT PnL | W/L/F | End inv | Flatten | taker/book/mid_walk/settlement |
|---|---|---|---|---|---|---|---|---|
| BNB | 2 | 1/1 | $0.4600 | $0.4600 | 1/0/0 | 0 | 0 | 1/1/0/0 |
| BTC | 4 | 2/2 | $0.5200 | $0.5200 | 1/1/0 | 0 | 2 | 4/0/0/0 |
| DOGE | 8 | 4/4 | $0.7300 | $0.2510 | 3/1/0 | 0 | 1 | 2/2/3/1 |
| ETH | 4 | 2/2 | $0.4100 | $0.4100 | 1/1/0 | 0 | 1 | 4/0/0/0 |
| HYPE | 8 | 4/4 | $-1.0000 | $-1.0000 | 1/3/0 | 0 | 3 | 5/1/2/0 |
| NEAR | 10 | 5/5 | $0.5900 | $0.5900 | 4/0/1 | 0 | 0 | 1/8/1/0 |
| SOL | 2 | 1/1 | $0.1900 | $0.1900 | 1/0/0 | 0 | 0 | 1/1/0/0 |
| XRP | 4 | 2/2 | $0.5500 | $0.5500 | 2/0/0 | 0 | 0 | 3/1/0/0 |
| ZEC | 10 | 5/5 | $1.0100 | $1.0100 | 5/0/0 | 0 | 1 | 2/5/3/0 |

## I. Chronological fills (full list → CSV)

All **52** fills are in `mac-u323-hr1-fills.csv`. Compact chronological list:

| # | CT | Asset | Side | Px | Mid | Edge¢ | Inv | Scen | Reason | Cap¢ | rd | Cash | ml |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-09-23 18:26:54.323 CT | ZEC | buy_yes | 0.72 | 0.72 | -17.5 | 0→1 | `house_mid` | `mid_walk` | 0 | 0 | 99.28 | 3.10 |
| 2 | 2026-09-23 18:26:56.324 CT | HYPE | sell_yes | 0.14 | 0.15500000000000003 | 64.5 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.14 | 3.07 |
| 3 | 2026-09-23 18:28:00.746 CT | ZEC | sell_yes | 0.98 | 0.9835 | 1.1 | 1→0 | `flatten` | `mid_walk` | 26 | 0.26 | 100.26 | 2.00 |
| 4 | 2026-09-23 18:28:00.750 CT | HYPE | buy_yes | 0.56 | 0.555 | 25.3 | -1→0 | `flatten` | `taker_cross` | -42.00000000000001 | -0.42000000000000004 | 99.58 | 2.00 |
| 5 | 2026-09-23 18:30:16.191 CT | ZEC | sell_yes | 0.53 | 0.515 | 2.0 | 0→-1 | `house_mid` | `book_depth` | 0 | 0 | 100.79 | 14.74 |
| 6 | 2026-09-23 18:30:32.262 CT | NEAR | buy_yes | 0.45 | 0.445 | 18.0 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.55 | 14.47 |
| 7 | 2026-09-23 18:31:03.482 CT | XRP | sell_yes | 0.39 | 0.395 | 14.9 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.39 | 13.95 |
| 8 | 2026-09-23 18:31:15.445 CT | NEAR | sell_yes | 0.47 | 0.44999999999999996 | 21.3 | 1→0 | `house_cover` | `book_depth` | 1.9999999999999962 | 0.019999999999999962 | 100.02 | 13.75 |
| 9 | 2026-09-23 18:31:28.520 CT | DOGE | buy_yes | 0.48 | 0.48 | -2.1 | 0→1 | `house_mid` | `mid_walk` | 0 | 0 | 99.52 | 13.53 |
| 10 | 2026-09-23 18:41:31.615 CT | XRP | buy_yes | 0.01 | 0.011 | 29.0 | -1→0 | `house_cover` | `taker_cross` | 38 | 0.38 | 100.38 | 11.79 |
| 11 | 2026-09-23 18:41:31.619 CT | ZEC | buy_yes | 0.01 | 0.008 | -9.9 | -1→0 | `house_cover` | `taker_cross` | 52 | 0.52 | 100.78 | 11.79 |
| 12 | 2026-09-23 18:45:28.442 CT | DOGE | sell_yes | 0.001 | 0.001 | — | None→0 | `house_mid` | `settlement` | None | None | 99.521 | 14.53 |
| 13 | 2026-09-23 18:47:44.783 CT | DOGE | sell_yes | 0.79 | 0.8 | -5.3 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.311 | 12.87 |
| 14 | 2026-09-23 18:48:43.401 CT | ZEC | buy_yes | 0.76 | 0.755 | 5.3 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 100.02 | 11.88 |
| 15 | 2026-09-23 18:49:12.530 CT | DOGE | buy_yes | 0.71 | 0.725 | -1.1 | -1→0 | `house_cover` | `book_depth` | 8.000000000000007 | 0.08000000000000007 | 99.60100000000001 | 10.80 |
| 16 | 2026-09-23 18:49:12.531 CT | XRP | buy_yes | 0.82 | 0.815 | -17.3 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.56 | 10.80 |
| 17 | 2026-09-23 18:49:12.532 CT | NEAR | sell_yes | 0.79 | 0.77 | 11.2 | 0→-1 | `house_mid` | `book_depth` | 0 | 0 | 100.81 | 10.80 |
| 18 | 2026-09-23 18:50:19.757 CT | ZEC | sell_yes | 0.92 | 0.905 | -4.7 | 1→0 | `house_cover` | `book_depth` | 16.000000000000004 | 0.16000000000000003 | 100.94 | 9.68 |
| 19 | 2026-09-23 18:50:28.775 CT | ZEC | buy_yes | 0.9 | 0.895 | -6.0 | 0→1 | `house_mid` | `mid_walk` | 0 | 0 | 100.03999999999999 | 9.53 |
| 20 | 2026-09-23 18:50:32.822 CT | NEAR | buy_yes | 0.78 | 0.8 | 8.3 | -1→0 | `house_cover` | `book_depth` | 1.0000000000000009 | 0.010000000000000009 | 100.03 | 9.46 |
| 21 | 2026-09-23 18:51:35.481 CT | NEAR | sell_yes | 0.86 | 0.84 | 6.6 | 0→-1 | `house_mid` | `book_depth` | 0 | 0 | 100.89 | 8.42 |
| 22 | 2026-09-23 18:51:40.552 CT | NEAR | buy_yes | 0.82 | 0.835 | 5.7 | -1→0 | `house_cover` | `book_depth` | 4.0000000000000036 | 0.040000000000000036 | 100.07000000000001 | 8.33 |
| 23 | 2026-09-23 18:52:55.461 CT | HYPE | sell_yes | 0.58 | 0.585 | 20.0 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.16 | 7.09 |
| 24 | 2026-09-23 18:53:31.300 CT | ZEC | sell_yes | 0.91 | 0.895 | 1.4 | 1→0 | `house_cover` | `book_depth` | 1.0000000000000009 | 0.010000000000000009 | 100.94999999999999 | 6.50 |
| 25 | 2026-09-23 18:56:37.742 CT | ZEC | buy_yes | 0.93 | 0.9475 | 4.0 | 0→1 | `house_mid` | `book_depth` | 0 | 0 | 100.01999999999998 | 3.37 |
| 26 | 2026-09-23 18:57:09.104 CT | XRP | sell_yes | 0.99 | 0.989 | -3.6 | 1→0 | `house_cover` | `book_depth` | 17.000000000000004 | 0.17000000000000004 | 100.55 | 2.86 |
| 27 | 2026-09-23 18:57:26.991 CT | ZEC | sell_yes | 0.99 | 0.9884999999999999 | 0.2 | 1→0 | `house_cover` | `book_depth` | 5.999999999999995 | 0.05999999999999994 | 101.00999999999998 | 2.56 |
| 28 | 2026-09-23 18:58:01.115 CT | HYPE | buy_yes | 0.75 | 0.74 | 10.9 | -1→0 | `flatten` | `taker_cross` | -17.000000000000004 | -0.17000000000000004 | 99.41 | 1.99 |
| 29 | 2026-09-23 19:00:43.123 CT | BNB | sell_yes | 0.47 | 0.48 | 7.8 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.47 | 14.29 |
| 30 | 2026-09-23 19:01:04.231 CT | ETH | buy_yes | 0.67 | 0.665 | -10.3 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.33 | 13.94 |
| 31 | 2026-09-23 19:01:31.355 CT | HYPE | sell_yes | 0.63 | 0.63 | -1.8 | 0→-1 | `house_mid` | `mid_walk` | 0 | 0 | 100.03999999999999 | 13.49 |
| 32 | 2026-09-23 19:02:02.447 CT | HYPE | buy_yes | 0.62 | 0.625 | -5.6 | -1→0 | `house_cover` | `book_depth` | 1.0000000000000009 | 0.010000000000000009 | 99.41999999999999 | 12.97 |
| 33 | 2026-09-23 19:03:06.786 CT | DOGE | sell_yes | 0.57 | 0.575 | 1.2 | 0→-1 | `house_mid` | `mid_walk` | 0 | 0 | 100.171 | 11.90 |
| 34 | 2026-09-23 19:03:07.750 CT | BTC | sell_yes | 0.74 | 0.745 | -12.0 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.74 | 11.88 |
| 35 | 2026-09-23 19:10:15.649 CT | HYPE | buy_yes | 0.84 | 0.84 | 13.5 | 0→1 | `house_mid` | `mid_walk` | 0 | 0 | 98.57999999999998 | 4.75 |
| 36 | 2026-09-23 19:11:44.923 CT | BNB | buy_yes | 0.01 | 0.0125 | 55.1 | -1→0 | `house_cover` | `book_depth` | 46 | 0.45999999999999996 | 100.46 | 3.26 |
| 37 | 2026-09-23 19:13:01.350 CT | BTC | buy_yes | 0.05 | 0.0505 | 34.2 | -1→0 | `flatten` | `taker_cross` | 69 | 0.69 | 100.69 | 1.98 |
| 38 | 2026-09-23 19:13:01.352 CT | ETH | sell_yes | 0.32 | 0.325 | 19.2 | 1→0 | `flatten` | `taker_cross` | -35 | -0.35000000000000003 | 99.64999999999999 | 1.98 |
| 39 | 2026-09-23 19:13:01.353 CT | HYPE | sell_yes | 0.42 | 0.425 | 9.3 | 1→0 | `flatten` | `taker_cross` | -42 | -0.42 | 98.99999999999999 | 1.98 |
| 40 | 2026-09-23 19:13:01.355 CT | DOGE | buy_yes | 0.08 | 0.07300000000000001 | 1.2 | -1→0 | `flatten` | `taker_cross` | 48.99999999999999 | 0.48999999999999994 | 100.09100000000001 | 1.98 |
| 41 | 2026-09-23 19:15:09.707 CT | BTC | sell_yes | 0.63 | 0.635 | -8.9 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.63 | 14.84 |
| 42 | 2026-09-23 19:15:18.792 CT | NEAR | buy_yes | 0.57 | 0.56 | 20.9 | 0→1 | `house_mid` | `mid_walk` | 0 | 0 | 99.43 | 14.69 |
| 43 | 2026-09-23 19:16:57.297 CT | ETH | sell_yes | 0.76 | 0.765 | -9.5 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.76 | 13.06 |
| 44 | 2026-09-23 19:17:11.380 CT | NEAR | sell_yes | 0.57 | 0.5449999999999999 | 37.2 | 1→0 | `house_cover` | `book_depth` | 0 | 0 | 100 | 12.82 |
| 45 | 2026-09-23 19:17:26.344 CT | SOL | buy_yes | 0.8 | 0.795 | -12.8 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.2 | 12.57 |
| 46 | 2026-09-23 19:17:40.409 CT | NEAR | sell_yes | 0.61 | 0.585 | 33.6 | 0→-1 | `house_mid` | `book_depth` | 0 | 0 | 100.61 | 12.33 |
| 47 | 2026-09-23 19:18:00.494 CT | DOGE | buy_yes | 0.83 | 0.83 | -3.3 | 0→1 | `house_mid` | `mid_walk` | 0 | 0 | 99.17 | 12.00 |
| 48 | 2026-09-23 19:26:12.568 CT | DOGE | sell_yes | 0.99 | 0.989 | -3.4 | 1→0 | `house_cover` | `book_depth` | 16.000000000000004 | 0.16000000000000003 | 100.16 | 3.80 |
| 49 | 2026-09-23 19:27:01.776 CT | NEAR | buy_yes | 0.09 | 0.109 | 87.8 | -1→0 | `house_cover` | `book_depth` | 52 | 0.52 | 100.52 | 2.98 |
| 50 | 2026-09-23 19:27:17.885 CT | SOL | sell_yes | 0.99 | 0.986 | -7.0 | 1→0 | `house_cover` | `book_depth` | 18.999999999999993 | 0.18999999999999995 | 100.19 | 2.71 |
| 51 | 2026-09-23 19:27:56.990 CT | ETH | buy_yes | 0 | 0.986 | -19.0 | -1→0 | `house_cover` | `taker_cross` | 76 | 0.76 | 100.76 | 2.06 |
| 52 | 2026-09-23 19:28:00.992 CT | BTC | buy_yes | 0.8 | 0.795 | -14.9 | -1→0 | `flatten` | `taker_cross` | -17.000000000000004 | -0.17000000000000004 | 99.83 | 2.00 |

## J. Evidence-only notes for next rules

1. Tag migration clean: **zero S3** on this tape; covers stamp `house_cover`.
2. Late opens ml≤2.0: **0** (prior hour same def: 1; prior dig’s ml<5 def was 2, this hour ml<5: 4).
3. Low-mid long opens mid≤0.4: **0** (prior hour: 10).
4. Cover engine kept: 16 cover/close wins $3.5500 (prior S3/cover wins: 15 $7.1900).
5. Flatten still sinks: flatten fill Σrd=$-0.0900; flatten-closed losses $-1.5300.
6. Fill count 52 vs prior 50 — see COMPARE doc.

---

### Meta raw
```json
{
  "paperOnly": true,
  "source": "ui",
  "startedAt": 1790206008108,
  "startedAtIso": "2026-09-23T23:26:48.108Z",
  "sha": null,
  "note": "ui session start",
  "writtenAt": "2026-09-23T23:26:48.120Z"
}
```

### Last UI snapshot
```json
{
  "type": "info",
  "t": 1790209808255,
  "iso": "2026-09-24T00:30:08.255Z",
  "scenarioId": "ui_session_snapshot",
  "reason": "fills=54;cash=101.46;realized=2.8110",
  "inventory": 0,
  "cashAfter": 101.45999999999998,
  "realizedDelta": 2.811,
  "source": "ui"
}
```

*Session filter: events with t ≥ meta.startedAt (1790206008108 / 2026-09-23T23:26:48.108Z). Pre-session 79 fills left in live journal were excluded from this-hour numbers.*
