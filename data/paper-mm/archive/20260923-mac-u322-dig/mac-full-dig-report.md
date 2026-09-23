# Mac Paper MM — Full Forensic Dig

**Tape stamp:** `20260923-180136`  
**Journal:** `/workspace/kalshi-money-making-machine/data/paper-mm/mac-full-dig-20260923-180136.jsonl`  
**Meta:** `/workspace/kalshi-money-making-machine/data/paper-mm/mac-full-dig-20260923-180136-meta.json`  
**Fills CSV:** `/workspace/kalshi-money-making-machine/data/paper-mm/mac-full-dig-fills.csv`  
**Journal SHA256:** `b59201b1db3f056134e96059f1bc3bd284eb4572571cf6fc7efafbc1ef44997c`  
**Events:** 134 (50 fills + 84 info)  
**Dug at:** 2026-09-23 18:03:17 CT  
**Source:** Mac disk `ui-journal.jsonl` + `ui-run-meta.json` + local-api journal-status (disk/API only, no browser).

## A. Session headline

| Field | Value |
|---|---|
| Start (meta) | 2026-09-23 16:58:26.338 CT (`2026-09-23T21:58:26.338Z`) |
| First fill | 2026-09-23 17:00:55.706 CT |
| Last fill | 2026-09-23 18:01:28.506 CT |
| Duration (start→last fill) | 1h 3m 2s |
| Fills | **50** |
| Round-trips closed | **23** (wins 16 / losses 7 / flat 0) |
| Open lots still open | **4** (net inv units 2) |
| Cash start (paper) | $100.00 (assumed) |
| Cash after first fill | $100.61 |
| Cash after last fill | $99.79 |
| UI last snapshot cash | $100.42000000000002 |
| Cash path (snap min→max) | $98.57999999999998 → $103.32999999999998 |
| Realized (sum fill realizedDelta) | **$5.6720** |
| Realized (UI snapshot) | **$5.672** |
| Round-trip sum PnL | **$5.6720** |
| Unrealized (mark open lots to last mid) | **$-0.0200** |
| End inventory by asset | `{'BNB': 1, 'BTC': 1, 'DOGE': 1, 'ETH': 0, 'HYPE': 0, 'NEAR': 0, 'SOL': -1, 'XRP': 0, 'ZEC': 0}` |
| UI snapshot inventory | 2 |
| centerMode | {'mid': 50} |
| SHA (meta) | `None` |
| paperOnly | True |

**Plain English:** Session started 2026-09-23 16:58:26.338 CT, ran ~1h 3m 2s, took **50 fills**. Realized **$5.67** (UI agrees at $5.672). Cash drifted from $100 to ~$100.42000000000002 with peak ~$103.32999999999998. End book open risk: BTC buy_yes@0.21, SOL sell_yes@0.5, BNB buy_yes@0.28, DOGE buy_yes@0.48.

## B. Reconcile

- `sum(fill.realizedDelta)` = **$5.672000**
- UI last `ui_session_snapshot.realizedDelta` = **$5.672**
- Match? **YES**
- Sum of paired round-trip PnL (price delta × size) = **$5.672000**
- Gap (sum_rd − RT PnL) ≈ **$0.000000** — expected if open inventory remains; RT PnL only counts closed pairs.
- Open inventory (FIFO lots not closed):
  - **BTC** fill#50 buy_yes @ 0.21 size=1 ticker=`KXBTC15M-26SEP231915-15` scen=`house_mid` reason=`taker_cross` opened 2026-09-23 18:01:28.506 CT mark_mid≈0.20500000000000002 unreal≈$-0.0050
  - **SOL** fill#47 sell_yes @ 0.5 size=1 ticker=`KXSOL15M-26SEP231915-15` scen=`house_mid` reason=`mid_walk` opened 2026-09-23 18:00:24.564 CT mark_mid≈0.5 unreal≈$0.0000
  - **BNB** fill#49 buy_yes @ 0.28 size=1 ticker=`KXBNB15M-26SEP231915-15` scen=`house_mid` reason=`taker_cross` opened 2026-09-23 18:00:56.054 CT mark_mid≈0.275 unreal≈$-0.0050
  - **DOGE** fill#48 buy_yes @ 0.48 size=1 ticker=`KXDOGE15M-26SEP231915-15` scen=`house_mid` reason=`taker_cross` opened 2026-09-23 18:00:56.047 CT mark_mid≈0.47 unreal≈$-0.0100
- Note: cashAfter on fills is path-dependent with inventory financing; do not equate cash−100 to realized while inventory is open.

## C. Every round-trip (open→close)

Total closed RTs: **23**. Wins $7.2700 / Losses $-1.5980 / Flat $0.0000.

| # | Asset | Dir | Open# | Close# | Open px | Close px | Size | PnL $ | Outcome | Open scen/reason | Close scen/reason | Held (min) | Tickers |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ZEC | short | 1 | 4 | 0.61 | 0.56 | 1 | +0.0500 | win | `house_mid`/`mid_walk` | `S3`/`book_depth` | 1.04 | `KXZEC15M-26SEP231815-15` → `KXZEC15M-26SEP231815-15` |
| 2 | ZEC | short | 6 | 7 | 0.46 | 0.39 | 1 | +0.0700 | win | `house_mid`/`book_depth` | `S3`/`book_depth` | 0.13 | `KXZEC15M-26SEP231815-15` → `KXZEC15M-26SEP231815-15` |
| 3 | ETH | short | 2 | 10 | 0.56 | 0 | 1 | +0.5600 | win | `house_mid`/`taker_cross` | `S3`/`taker_cross` | 7.96 | `KXETH15M-26SEP231815-15` → `KXETH15M-26SEP231815-15` |
| 4 | HYPE | short | 5 | 11 | 0.53 | 0 | 1 | +0.5300 | win | `house_mid`/`mid_walk` | `S3`/`taker_cross` | 7.64 | `KXHYPE15M-26SEP231815-15` → `KXHYPE15M-26SEP231815-15` |
| 5 | XRP | short | 3 | 12 | 0.52 | 0 | 1 | +0.5200 | win | `house_mid`/`taker_cross` | `S3`/`taker_cross` | 9.89 | `KXXRP15M-26SEP231815-15` → `KXXRP15M-26SEP231815-15` |
| 6 | BTC | short | 9 | 13 | 0.24 | 0 | 1 | +0.2400 | win | `house_mid`/`taker_cross` | `S3`/`taker_cross` | 4.92 | `KXBTC15M-26SEP231815-15` → `KXBTC15M-26SEP231815-15` |
| 7 | ZEC | long | 8 | 14 | 0.41 | 0.99 | 1 | +0.5800 | win | `house_mid`/`book_depth` | `S3`/`taker_cross` | 5.27 | `KXZEC15M-26SEP231815-15` → `KXZEC15M-26SEP231815-15` |
| 8 | SOL | short | 15 | 20 | 0.39 | 0.01 | 1 | +0.3800 | win | `house_mid`/`taker_cross` | `S3`/`taker_cross` | 9.45 | `KXSOL15M-26SEP231830-30` → `KXSOL15M-26SEP231830-30` |
| 9 | BNB | short | 19 | 21 | 0.5 | 0.01 | 1 | +0.4900 | win | `house_mid`/`taker_cross` | `S3`/`taker_cross` | 7.46 | `KXBNB15M-26SEP231830-30` → `KXBNB15M-26SEP231830-30` |
| 10 | ETH | short | 17 | 22 | 0.45 | 0.01 | 1 | +0.4400 | win | `house_mid`/`taker_cross` | `S3`/`taker_cross` | 9.55 | `KXETH15M-26SEP231830-30` → `KXETH15M-26SEP231830-30` |
| 11 | XRP | long | 16 | 23 | 0.36 | 0.01 | 1 | -0.3500 | loss | `house_mid`/`taker_cross` | `flatten`/`book_depth` | 10.23 | `KXXRP15M-26SEP231830-30` → `KXXRP15M-26SEP231830-30` |
| 12 | BTC | long | 18 | 24 | 0.34 | 0.01 | 1 | -0.3300 | loss | `house_mid`/`taker_cross` | `flatten`/`book_depth` | 10.38 | `KXBTC15M-26SEP231830-30` → `KXBTC15M-26SEP231830-30` |
| 13 | BTC | long | 29 | 30 | 0.35 | 0.43 | 1 | +0.0800 | win | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 0.30 | `KXBTC15M-26SEP231845-45` → `KXBTC15M-26SEP231845-45` |
| 14 | SOL | long | 25 | 31 | 0.29 | 0.052 | 1 | -0.2380 | loss | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 12.68 | `KXSOL15M-26SEP231845-45` → `KXSOL15M-26SEP231845-45` |
| 15 | DOGE | long | 26 | 32 | 0.3 | 0.01 | 1 | -0.2900 | loss | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 12.66 | `KXDOGE15M-26SEP231845-45` → `KXDOGE15M-26SEP231845-45` |
| 16 | ETH | long | 27 | 33 | 0.23 | 0.01 | 1 | -0.2200 | loss | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 12.13 | `KXETH15M-26SEP231845-45` → `KXETH15M-26SEP231845-45` |
| 17 | HYPE | long | 28 | 34 | 0.16 | 0.01 | 1 | -0.1500 | loss | `house_mid`/`book_depth` | `flatten`/`book_depth` | 11.24 | `KXHYPE15M-26SEP231845-45` → `KXHYPE15M-26SEP231845-45` |
| 18 | BTC | long | 35 | 36 | 0.13 | 0.11 | 1 | -0.0200 | loss | `house_mid`/`taker_cross` | `flatten`/`taker_cross` | 0.10 | `KXBTC15M-26SEP231845-45` → `KXBTC15M-26SEP231845-45` |
| 19 | NEAR | short | 37 | 39 | 0.53 | 0.45 | 1 | +0.0800 | win | `house_mid`/`book_depth` | `S3`/`book_depth` | 0.18 | `KXNEAR15M-26SEP231900-00` → `KXNEAR15M-26SEP231900-00` |
| 20 | NEAR | short | 42 | 43 | 0.92 | 0 | 1 | +0.9200 | win | `house_mid`/`taker_cross` | `S3`/`taker_cross` | 5.97 | `KXNEAR15M-26SEP231900-00` → `KXNEAR15M-26SEP231900-00` |
| 21 | ZEC | short | 38 | 44 | 0.62 | 0 | 1 | +0.6200 | win | `house_mid`/`book_depth` | `S3`/`taker_cross` | 10.25 | `KXZEC15M-26SEP231900-00` → `KXZEC15M-26SEP231900-00` |
| 22 | BNB | short | 41 | 45 | 0.89 | 0 | 1 | +0.8900 | win | `house_mid`/`taker_cross` | `S3`/`taker_cross` | 9.42 | `KXBNB15M-26SEP231900-00` → `KXBNB15M-26SEP231900-00` |
| 23 | XRP | short | 40 | 46 | 0.82 | 0 | 1 | +0.8200 | win | `house_mid`/`taker_cross` | `S3`/`taker_cross` | 10.03 | `KXXRP15M-26SEP231900-00` → `KXXRP15M-26SEP231900-00` |

## D. Why it made money

**Winning RTs: 16 totaling $7.2700**

### Patterns (evidence)
1. **Non-flatten closes:** 15 wins for $7.1900 — inventory recycled via house_mid/S3 rather than dumped.
2. **Flatten wins (rare):** 1 for $0.0800
3. Close scenario `S3`: 15 wins, $7.1900
3. Close scenario `flatten`: 1 wins, $0.0800
4. Avg open edgeCents: wins -0.37¢ vs losses 15.37¢
5. Opened under `house_mid`: 16 wins $7.2700

### Top winning examples
| Asset | Dir | Open→Close px | PnL | Open | Close | Notes |
|---|---|---|---|---|---|---|
| NEAR | short | 0.92→0 | $+0.9200 | #42 `house_mid`/`taker_cross` | #43 `S3`/`taker_cross` | edgeOpen=10.8¢, capture=92¢ |
| BNB | short | 0.89→0 | $+0.8900 | #41 `house_mid`/`taker_cross` | #45 `S3`/`taker_cross` | capture=89¢ |
| XRP | short | 0.82→0 | $+0.8200 | #40 `house_mid`/`taker_cross` | #46 `S3`/`taker_cross` | capture=82¢ |
| ZEC | short | 0.62→0 | $+0.6200 | #38 `house_mid`/`book_depth` | #44 `S3`/`taker_cross` | capture=62¢ |
| ZEC | long | 0.41→0.99 | $+0.5800 | #8 `house_mid`/`book_depth` | #14 `S3`/`taker_cross` | 1¢/99¢, edgeOpen=5.5¢, capture=58.00000000000001¢ |
| ETH | short | 0.56→0 | $+0.5600 | #2 `house_mid`/`taker_cross` | #10 `S3`/`taker_cross` | capture=56.00000000000001¢ |
| HYPE | short | 0.53→0 | $+0.5300 | #5 `house_mid`/`mid_walk` | #11 `S3`/`taker_cross` | capture=53¢ |
| XRP | short | 0.52→0 | $+0.5200 | #3 `house_mid`/`taker_cross` | #12 `S3`/`taker_cross` | capture=52¢ |

### Narrative
Money came from two evidence patterns:

1. **S3 near-expiry cover of shorts at ~0 / 0.01 while mid≈0.99** — the largest winners (NEAR +$0.92, BNB +$0.89, XRP +$0.82, ZEC +$0.62, ETH/HYPE/XRP/BTC covers earlier). Journal literally prints `buy_yes` @ `price=0` (or 0.01) with large positive `captureCents`/`realizedDelta`, closing short inventory. That is the bulk of the +$5.67 realized.
2. **Smaller house_mid/S3 recycle trades** — ordinary open→close without 1¢ dumps (e.g. ZEC long 0.41→0.99 +$0.58, small ZEC/NEAR covers).

**Losses were almost entirely flatten 1¢ dumps** of longs that never got an S3-style favorable cover. Taker crosses dominate fill count — the bot paid the spread to get filled when edge looked large enough, then either scored an S3 cover or ate flatten.

## E. Why it lost — every losing RT

**Losing RTs: 7 totaling $-1.5980**

| Asset | Dir | Open→Close | PnL | Held min | Open | Close | Cause (evidence) |
|---|---|---|---|---|---|---|---|
| XRP | long | 0.36→0.01 | $-0.3500 | 10.23 | #16 `house_mid`/`taker_cross` @ 2026-09-23 17:17:54.137 CT | #23 `flatten`/`book_depth` @ 2026-09-23 17:28:08.102 CT | FLATTEN exit; 1¢/99¢ dump; book_depth fill; capture=-35¢; thin open edge -0.7¢; yes price fell against long |
| BTC | long | 0.34→0.01 | $-0.3300 | 10.38 | #18 `house_mid`/`taker_cross` @ 2026-09-23 17:18:03.988 CT | #24 `flatten`/`book_depth` @ 2026-09-23 17:28:27.002 CT | FLATTEN exit; 1¢/99¢ dump; book_depth fill; capture=-33¢; yes price fell against long |
| DOGE | long | 0.3→0.01 | $-0.2900 | 12.66 | #26 `house_mid`/`taker_cross` @ 2026-09-23 17:30:21.436 CT | #32 `flatten`/`taker_cross` @ 2026-09-23 17:43:01.164 CT | FLATTEN exit; 1¢/99¢ dump; capture=-28.999999999999996¢; yes price fell against long |
| SOL | long | 0.29→0.052 | $-0.2380 | 12.68 | #25 `house_mid`/`taker_cross` @ 2026-09-23 17:30:20.614 CT | #31 `flatten`/`taker_cross` @ 2026-09-23 17:43:01.164 CT | FLATTEN exit; capture=-23.799999999999997¢; yes price fell against long |
| ETH | long | 0.23→0.01 | $-0.2200 | 12.13 | #27 `house_mid`/`taker_cross` @ 2026-09-23 17:30:54.240 CT | #33 `flatten`/`taker_cross` @ 2026-09-23 17:43:02.036 CT | FLATTEN exit; 1¢/99¢ dump; capture=-22¢; yes price fell against long |
| HYPE | long | 0.16→0.01 | $-0.1500 | 11.24 | #28 `house_mid`/`book_depth` @ 2026-09-23 17:31:49.066 CT | #34 `flatten`/`book_depth` @ 2026-09-23 17:43:03.201 CT | FLATTEN exit; 1¢/99¢ dump; book_depth fill; capture=-15¢; yes price fell against long |
| BTC | long | 0.13→0.11 | $-0.0200 | 0.10 | #35 `house_mid`/`taker_cross` @ 2026-09-23 17:43:22.482 CT | #36 `flatten`/`taker_cross` @ 2026-09-23 17:43:28.243 CT | FLATTEN exit; capture=-2.0000000000000004¢; opened with only 1.6m left; yes price fell against long |

## F. Why fills taken — tags / reasons breakdown

### By reason
| reason | n | % | sum realizedDelta |
|---|---|---|---|
| `taker_cross` | 36 | 72.0% | $6.3020 |
| `book_depth` | 11 | 22.0% | $-0.6300 |
| `mid_walk` | 3 | 6.0% | $0.0000 |

### By scenarioId
| scenarioId | n | % | sum realizedDelta |
|---|---|---|---|
| `house_mid` | 27 | 54.0% | $0.0000 |
| `S3` | 15 | 30.0% | $7.1900 |
| `flatten` | 8 | 16.0% | $-1.5180 |

### By side
- `buy_yes`: 26
- `sell_yes`: 24

### centerMode
- {'mid': 50}

**Read:** Almost all aggression is `taker_cross` (pay the ask/hit the bid). `book_depth` appears especially on flatten 1¢ exits. `mid_walk` is rare. Scenarios are only `house_mid`, `S3`, and `flatten` — no blackout tags in this tape.

## G. Flatten / blackout / extreme_mid / late opens / 1¢ dumps

### Flatten fills: 8
| # | CT | Asset | Side | Price | capture¢ | realizedΔ | reason | minutesLeft | inv before→after |
|---|---|---|---|---|---|---|---|---|---|
| 23 | 2026-09-23 17:28:08.102 CT | XRP | sell_yes | 0.01 | -35 | -0.35 | `book_depth` | 1.879 | 1→0 |
| 24 | 2026-09-23 17:28:27.002 CT | BTC | sell_yes | 0.01 | -33 | -0.33 | `book_depth` | 1.563 | 1→0 |
| 30 | 2026-09-23 17:43:01.163 CT | BTC | sell_yes | 0.43 | 8.000000000000002 | 0.08000000000000002 | `taker_cross` | 1.991 | 1→0 |
| 31 | 2026-09-23 17:43:01.164 CT | SOL | sell_yes | 0.052 | -23.799999999999997 | -0.238 | `taker_cross` | 1.991 | 1→0 |
| 32 | 2026-09-23 17:43:01.164 CT | DOGE | sell_yes | 0.01 | -28.999999999999996 | -0.29 | `taker_cross` | 1.991 | 1→0 |
| 33 | 2026-09-23 17:43:02.036 CT | ETH | sell_yes | 0.01 | -22 | -0.22 | `taker_cross` | 1.974 | 1→0 |
| 34 | 2026-09-23 17:43:03.201 CT | HYPE | sell_yes | 0.01 | -15 | -0.15 | `book_depth` | 1.957 | 1→0 |
| 36 | 2026-09-23 17:43:28.243 CT | BTC | sell_yes | 0.11 | -2.0000000000000004 | -0.020000000000000004 | `taker_cross` | 1.538 | 1→0 |

### 1¢ / 99¢ prints: 9
- fill#14 ZEC sell_yes @ 0.99 scen=`S3` reason=`taker_cross` capture=58.00000000000001¢ rd=0.5800000000000001 @ 2026-09-23 17:11:42.119 CT
- fill#20 SOL buy_yes @ 0.01 scen=`S3` reason=`taker_cross` capture=38¢ rd=0.38 @ 2026-09-23 17:25:42.163 CT
- fill#21 BNB buy_yes @ 0.01 scen=`S3` reason=`taker_cross` capture=49¢ rd=0.49 @ 2026-09-23 17:26:31.566 CT
- fill#22 ETH buy_yes @ 0.01 scen=`S3` reason=`taker_cross` capture=44¢ rd=0.44 @ 2026-09-23 17:27:35.808 CT
- fill#23 XRP sell_yes @ 0.01 scen=`flatten` reason=`book_depth` capture=-35¢ rd=-0.35 @ 2026-09-23 17:28:08.102 CT
- fill#24 BTC sell_yes @ 0.01 scen=`flatten` reason=`book_depth` capture=-33¢ rd=-0.33 @ 2026-09-23 17:28:27.002 CT
- fill#32 DOGE sell_yes @ 0.01 scen=`flatten` reason=`taker_cross` capture=-28.999999999999996¢ rd=-0.29 @ 2026-09-23 17:43:01.164 CT
- fill#33 ETH sell_yes @ 0.01 scen=`flatten` reason=`taker_cross` capture=-22¢ rd=-0.22 @ 2026-09-23 17:43:02.036 CT
- fill#34 HYPE sell_yes @ 0.01 scen=`flatten` reason=`book_depth` capture=-15¢ rd=-0.15 @ 2026-09-23 17:43:03.201 CT

### Blackout events: 0
- none in journal text

### Extreme mid (mid≤0.15 or ≥0.85): 22
- fill#10 ETH mid=0.992 px=0 scen=`S3` reason=`taker_cross` ml=5.56
- fill#11 HYPE mid=0.987 px=0 scen=`S3` reason=`taker_cross` ml=4.15
- fill#12 XRP mid=0.99 px=0 scen=`S3` reason=`taker_cross` ml=3.63
- fill#13 BTC mid=0.99 px=0 scen=`S3` reason=`taker_cross` ml=3.58
- fill#14 ZEC mid=0.99 px=0.99 scen=`S3` reason=`taker_cross` ml=3.32
- fill#20 SOL mid=0.0115 px=0.01 scen=`S3` reason=`taker_cross` ml=4.30
- fill#21 BNB mid=0.011 px=0.01 scen=`S3` reason=`taker_cross` ml=3.49
- fill#22 ETH mid=0.0115 px=0.01 scen=`S3` reason=`taker_cross` ml=2.42
- fill#23 XRP mid=0.006 px=0.01 scen=`flatten` reason=`book_depth` ml=1.88
- fill#24 BTC mid=0.007 px=0.01 scen=`flatten` reason=`book_depth` ml=1.56
- fill#31 SOL mid=0.051000000000000004 px=0.052 scen=`flatten` reason=`taker_cross` ml=1.99
- fill#32 DOGE mid=0.01 px=0.01 scen=`flatten` reason=`taker_cross` ml=1.99
- fill#33 ETH mid=0.01 px=0.01 scen=`flatten` reason=`taker_cross` ml=1.97
- fill#34 HYPE mid=0.006 px=0.01 scen=`flatten` reason=`book_depth` ml=1.96
- fill#35 BTC mid=0.125 px=0.13 scen=`house_mid` reason=`taker_cross` ml=1.64
- fill#36 BTC mid=0.11499999999999999 px=0.11 scen=`flatten` reason=`taker_cross` ml=1.54
- fill#41 BNB mid=0.895 px=0.89 scen=`house_mid` reason=`taker_cross` ml=12.80
- fill#42 NEAR mid=0.9299999999999999 px=0.92 scen=`house_mid` reason=`taker_cross` ml=11.69
- fill#43 NEAR mid=0.991 px=0 scen=`S3` reason=`taker_cross` ml=5.73
- fill#44 ZEC mid=0.991 px=0 scen=`S3` reason=`taker_cross` ml=4.19
- fill#45 BNB mid=0.998 px=0 scen=`S3` reason=`taker_cross` ml=3.36
- fill#46 XRP mid=0.959 px=0 scen=`S3` reason=`taker_cross` ml=2.76


**Note on extreme mids:** Most ≥0.85 mid prints are **profitable S3 covers** (buy_yes @ 0/0.01 with mid≈0.99), not toxic opens. Toxic extreme prints are mainly **flatten sells @ 0.01** with mid≈0.01.

### Late opens (|inv| increased with minutesLeft<5, non-flatten): 2
- fill#29 BTC buy_yes @ 0.35 ml=2.29 inv 0→1 scen=`house_mid`
- fill#35 BTC buy_yes @ 0.13 ml=1.64 inv 0→1 scen=`house_mid`

### Flatten $ impact
- Sum realizedDelta on flatten fills: **$-1.5180**
- Losing RTs closed by flatten: 7 totaling $-1.5980

## H. By-asset table

| Asset | Fills | Buy/Sell | Σ realizedΔ | RT PnL | W/L/F | End inv | Flatten | taker/book/mid_walk | avg edge¢ | avg minLeft |
|---|---|---|---|---|---|---|---|---|---|---|
| BNB | 5 | 3/2 | $1.3800 | $1.3800 | 2/0/0 | 1 | 0 | 5/0/0 | -5.31 | 8.94 |
| BTC | 9 | 5/4 | $-0.0300 | $-0.0300 | 2/2/0 | 1 | 3 | 8/1/0 | 20.18 | 5.18 |
| DOGE | 3 | 2/1 | $-0.2900 | $-0.2900 | 0/1/0 | 1 | 1 | 3/0/0 | 8.93 | 10.25 |
| ETH | 6 | 3/3 | $0.7800 | $0.7800 | 2/1/0 | 0 | 1 | 6/0/0 | 8.36 | 8.25 |
| HYPE | 4 | 2/2 | $0.3800 | $0.3800 | 1/1/0 | 0 | 1 | 1/2/1 | 2.14 | 7.77 |
| NEAR | 4 | 2/2 | $1.0000 | $1.0000 | 2/0/0 | 0 | 0 | 2/2/0 | 13.47 | 11.60 |
| SOL | 5 | 2/3 | $0.1420 | $0.1420 | 1/1/0 | -1 | 1 | 4/0/1 | 11.93 | 9.86 |
| XRP | 6 | 3/3 | $0.9900 | $0.9900 | 2/1/0 | 0 | 1 | 5/1/0 | -1.01 | 7.78 |
| ZEC | 8 | 4/4 | $1.3200 | $1.3200 | 4/0/0 | 0 | 0 | 2/5/1 | -0.50 | 9.74 |

**Totals:** Σ realizedΔ $5.6720; RT PnL $5.6720

## I. Chronological fills (full list → CSV)

All **50** fills are in `/workspace/kalshi-money-making-machine/data/paper-mm/mac-full-dig-fills.csv`. Compact chronological list:

| # | CT | Asset | Side | Px | Mid | FV | Edge¢ | Inv | Scen | Reason | Cap¢ | rd | Cash | ml |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-09-23 17:00:55.706 CT | ZEC | sell_yes | 0.61 | 0.615 | 0.534 | -5.6 | 0→-1 | `house_mid` | `mid_walk` | 0 | 0 | 100.61 | 14.09 |
| 2 | 2026-09-23 17:01:29.485 CT | ETH | sell_yes | 0.56 | 0.565 | 0.498 | -4.2 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.56 | 13.52 |
| 3 | 2026-09-23 17:01:29.486 CT | XRP | sell_yes | 0.52 | 0.525 | 0.492 | 0.7 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.52 | 13.52 |
| 4 | 2026-09-23 17:01:58.080 CT | ZEC | buy_yes | 0.56 | 0.5800000000000001 | 0.536 | -4.4 | -1→0 | `S3` | `book_depth` | 4.999999999999993 | 0.04999999999999993 | 100.05 | 13.05 |
| 5 | 2026-09-23 17:03:13.738 CT | HYPE | sell_yes | 0.53 | 0.53 | 0.375 | -13.5 | 0→-1 | `house_mid` | `mid_walk` | 0 | 0 | 100.53 | 11.78 |
| 6 | 2026-09-23 17:04:49.523 CT | ZEC | sell_yes | 0.46 | 0.44 | 0.505 | 6.5 | 0→-1 | `house_mid` | `book_depth` | 0 | 0 | 100.50999999999999 | 10.19 |
| 7 | 2026-09-23 17:04:57.380 CT | ZEC | buy_yes | 0.39 | 0.405 | 0.505 | 9.5 | -1→0 | `S3` | `book_depth` | 7.000000000000001 | 0.07 | 100.11999999999999 | 10.06 |
| 8 | 2026-09-23 17:06:25.623 CT | ZEC | buy_yes | 0.41 | 0.42 | 0.505 | 5.5 | 0→1 | `house_mid` | `book_depth` | 0 | 0 | 99.71 | 8.59 |
| 9 | 2026-09-23 17:06:30.860 CT | BTC | sell_yes | 0.24 | 0.245 | 0.421 | 20.6 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.24 | 8.50 |
| 10 | 2026-09-23 17:09:27.170 CT | ETH | buy_yes | 0 | 0.992 | 0.990 | 0.0 | -1→0 | `S3` | `taker_cross` | 56.00000000000001 | 0.56 | 100.56 | 5.56 |
| 11 | 2026-09-23 17:10:51.906 CT | HYPE | buy_yes | 0 | 0.987 | 0.990 | 0.2 | -1→0 | `S3` | `taker_cross` | 53 | 0.53 | 100.53 | 4.15 |
| 12 | 2026-09-23 17:11:22.710 CT | XRP | buy_yes | 0 | 0.99 | 0.990 | 0.0 | -1→0 | `S3` | `taker_cross` | 52 | 0.52 | 100.52 | 3.63 |
| 13 | 2026-09-23 17:11:26.046 CT | BTC | buy_yes | 0 | 0.99 | 0.869 | -12.0 | -1→0 | `S3` | `taker_cross` | 24 | 0.24 | 100.24 | 3.58 |
| 14 | 2026-09-23 17:11:42.119 CT | ZEC | sell_yes | 0.99 | 0.99 | 0.990 | 0.0 | 1→0 | `S3` | `taker_cross` | 58.00000000000001 | 0.5800000000000001 | 100.69999999999999 | 3.32 |
| 15 | 2026-09-23 17:16:15.176 CT | SOL | sell_yes | 0.39 | 0.395 | 0.368 | 1.3 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.39 | 13.76 |
| 16 | 2026-09-23 17:17:54.137 CT | XRP | buy_yes | 0.36 | 0.355 | 0.383 | -0.7 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.64 | 12.11 |
| 17 | 2026-09-23 17:18:03.089 CT | ETH | sell_yes | 0.45 | 0.455 | 0.435 | 2.0 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.45 | 11.95 |
| 18 | 2026-09-23 17:18:03.988 CT | BTC | buy_yes | 0.34 | 0.335 | 0.511 | 15.6 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.89999999999999 | 11.94 |
| 19 | 2026-09-23 17:19:04.034 CT | BNB | sell_yes | 0.5 | 0.51 | 0.428 | -3.2 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.5 | 10.95 |
| 20 | 2026-09-23 17:25:42.163 CT | SOL | buy_yes | 0.01 | 0.0115 | 0.131 | 11.2 | -1→0 | `S3` | `taker_cross` | 38 | 0.38 | 100.38 | 4.30 |
| 21 | 2026-09-23 17:26:31.566 CT | BNB | buy_yes | 0.01 | 0.011 | 0.260 | 24.3 | -1→0 | `S3` | `taker_cross` | 49 | 0.49 | 100.49 | 3.49 |
| 22 | 2026-09-23 17:27:35.808 CT | ETH | buy_yes | 0.01 | 0.0115 | 0.263 | 24.6 | -1→0 | `S3` | `taker_cross` | 44 | 0.44 | 100.44 | 2.42 |
| 23 | 2026-09-23 17:28:08.102 CT | XRP | sell_yes | 0.01 | 0.006 | 0.010 | 0.4 | 1→0 | `flatten` | `book_depth` | -35 | -0.35 | 99.65 | 1.88 |
| 24 | 2026-09-23 17:28:27.002 CT | BTC | sell_yes | 0.01 | 0.007 | 0.187 | 18.0 | 1→0 | `flatten` | `book_depth` | -33 | -0.33 | 99.91 | 1.56 |
| 25 | 2026-09-23 17:30:20.614 CT | SOL | buy_yes | 0.29 | 0.28500000000000003 | 0.437 | 11.7 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.71 | 14.67 |
| 26 | 2026-09-23 17:30:21.436 CT | DOGE | buy_yes | 0.3 | 0.295 | 0.410 | 8.5 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.7 | 14.65 |
| 27 | 2026-09-23 17:30:54.240 CT | ETH | buy_yes | 0.23 | 0.225 | 0.381 | 13.6 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.77 | 14.11 |
| 28 | 2026-09-23 17:31:49.066 CT | HYPE | buy_yes | 0.16 | 0.175 | 0.380 | 20.5 | 0→1 | `house_mid` | `book_depth` | 0 | 0 | 99.84 | 13.19 |
| 29 | 2026-09-23 17:42:43.006 CT | BTC | buy_yes | 0.35 | 0.345 | 0.503 | 13.8 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.56 | 2.29 |
| 30 | 2026-09-23 17:43:01.163 CT | BTC | sell_yes | 0.43 | 0.435 | 0.562 | 19.7 | 1→0 | `flatten` | `taker_cross` | 8.000000000000002 | 0.08000000000000002 | 99.99000000000001 | 1.99 |
| 31 | 2026-09-23 17:43:01.164 CT | SOL | sell_yes | 0.052 | 0.051000000000000004 | 0.334 | 25.7 | 1→0 | `flatten` | `taker_cross` | -23.799999999999997 | -0.238 | 99.762 | 1.99 |
| 32 | 2026-09-23 17:43:01.164 CT | DOGE | sell_yes | 0.01 | 0.01 | 0.017 | 0.2 | 1→0 | `flatten` | `taker_cross` | -28.999999999999996 | -0.29 | 99.71000000000001 | 1.99 |
| 33 | 2026-09-23 17:43:02.036 CT | ETH | sell_yes | 0.01 | 0.01 | 0.148 | 14.1 | 1→0 | `flatten` | `taker_cross` | -22 | -0.22 | 99.78 | 1.97 |
| 34 | 2026-09-23 17:43:03.201 CT | HYPE | sell_yes | 0.01 | 0.006 | 0.020 | 1.4 | 1→0 | `flatten` | `book_depth` | -15 | -0.15 | 99.85000000000001 | 1.96 |
| 35 | 2026-09-23 17:43:22.482 CT | BTC | buy_yes | 0.13 | 0.125 | 0.568 | 38.3 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.86000000000001 | 1.64 |
| 36 | 2026-09-23 17:43:28.243 CT | BTC | sell_yes | 0.11 | 0.11499999999999999 | 0.571 | 45.6 | 1→0 | `flatten` | `taker_cross` | -2.0000000000000004 | -0.020000000000000004 | 99.97000000000001 | 1.54 |
| 37 | 2026-09-23 17:45:26.062 CT | NEAR | sell_yes | 0.53 | 0.505 | 0.677 | 18.2 | 0→-1 | `house_mid` | `book_depth` | 0 | 0 | 100.53 | 14.58 |
| 38 | 2026-09-23 17:45:34.767 CT | ZEC | sell_yes | 0.62 | 0.61 | 0.434 | -15.6 | 0→-1 | `house_mid` | `book_depth` | 0 | 0 | 100.62 | 14.43 |
| 39 | 2026-09-23 17:45:36.652 CT | NEAR | buy_yes | 0.45 | 0.47 | 0.723 | 24.8 | -1→0 | `S3` | `book_depth` | 8.000000000000002 | 0.08000000000000002 | 100.08 | 14.40 |
| 40 | 2026-09-23 17:47:13.824 CT | XRP | sell_yes | 0.82 | 0.825 | 0.779 | -1.6 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.82 | 12.80 |
| 41 | 2026-09-23 17:47:13.828 CT | BNB | sell_yes | 0.89 | 0.895 | 0.448 | -41.7 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 100.89 | 12.80 |
| 42 | 2026-09-23 17:48:18.809 CT | NEAR | sell_yes | 0.92 | 0.9299999999999999 | 0.968 | 10.8 | 0→-1 | `house_mid` | `taker_cross` | 0 | 0 | 101 | 11.69 |
| 43 | 2026-09-23 17:54:17.035 CT | NEAR | buy_yes | 0 | 0.991 | 0.990 | 0.0 | -1→0 | `S3` | `taker_cross` | 92 | 0.92 | 101 | 5.73 |
| 44 | 2026-09-23 17:55:49.513 CT | ZEC | buy_yes | 0 | 0.991 | 0.990 | 0.0 | -1→0 | `S3` | `taker_cross` | 62 | 0.62 | 100.62 | 4.19 |
| 45 | 2026-09-23 17:56:38.892 CT | BNB | buy_yes | 0 | 0.998 | 0.769 | -22.0 | -1→0 | `S3` | `taker_cross` | 89 | 0.89 | 100.89 | 3.36 |
| 46 | 2026-09-23 17:57:15.438 CT | XRP | buy_yes | 0 | 0.959 | 0.915 | -4.9 | -1→0 | `S3` | `taker_cross` | 82 | 0.82 | 100.82 | 2.76 |
| 47 | 2026-09-23 18:00:24.564 CT | SOL | sell_yes | 0.5 | 0.5 | 0.571 | 9.6 | 0→-1 | `house_mid` | `mid_walk` | 0 | 0 | 100.5 | 14.60 |
| 48 | 2026-09-23 18:00:56.047 CT | DOGE | buy_yes | 0.48 | 0.47 | 0.676 | 18.1 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.52 | 14.09 |
| 49 | 2026-09-23 18:00:56.054 CT | BNB | buy_yes | 0.28 | 0.275 | 0.505 | 16.0 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 100.61 | 14.09 |
| 50 | 2026-09-23 18:01:28.506 CT | BTC | buy_yes | 0.21 | 0.20500000000000002 | 0.445 | 22.0 | 0→1 | `house_mid` | `taker_cross` | 0 | 0 | 99.79 | 13.53 |

## J. Evidence-only next house rules

Derived only from this tape (no S1–S5 pitch, no FV-mismatch theory-selling):

1. **Stop 1¢ flatten dumps when capture would be ≤ −20¢** — this tape had 5 flatten fills with capture≤−20¢ contributing $-1.43 realized. Prefer resting exit / wider flatten band earlier.
2. **No new risk when minutesLeft < 5** — 2 late |inv|-increasing fills observed.
3. **Distinguish extreme-mid covers vs dumps:** 22 extreme-mid fills — S3 covers at mid≥0.85 were the profit engine; flatten sells at mid≤0.15 @ 0.01 were the sink. Do not blanket-ban extreme mids; ban **opening** into mid≤0.15 and ban **flatten dumping longs at 1¢** when an S3-style cover path exists.
4. **Track scenario attribution:** this tape `house_mid` Σrd=$0.0000 (27 fills), `S3` Σrd=$7.1900 (15 fills), `flatten` Σrd=$-1.5180 (8 fills). Flatten is the clear PnL sink.
5. **Taker-heavy (36/50)** — require larger edgeCents threshold before `taker_cross` when spread is wide; several losses opened via taker then flattened.
6. **Session still has open inventory** (BTC, SOL, BNB, DOGE) — do not declare final PnL until flat or expiry settle; mark-to-mid unreal≈$-0.0200.

---

### Meta raw
```json
{
  "paperOnly": true,
  "source": "ui",
  "startedAt": 1790200706338,
  "startedAtIso": "2026-09-23T21:58:26.338Z",
  "sha": null,
  "note": "ui session start",
  "writtenAt": "2026-09-23T21:58:26.344Z"
}
```

### Last UI snapshot
```json
{
  "type": "info",
  "t": 1790204488508,
  "iso": "2026-09-23T23:01:28.508Z",
  "scenarioId": "ui_session_snapshot",
  "reason": "fills=50;cash=100.42;realized=5.6720",
  "inventory": 2,
  "cashAfter": 100.42000000000002,
  "realizedDelta": 5.672,
  "source": "ui"
}
```

*Prior unrecovered Mac LS session note exists on disk (`MAC_SESSION_NOT_RECOVERED.txt`: 105 fills / +$9.71) — **not** included in this dig; this dig is the live disk tape only.*