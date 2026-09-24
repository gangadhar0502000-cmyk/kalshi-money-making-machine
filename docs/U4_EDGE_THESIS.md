# U4 Edge Thesis — Kalshi crypto 15m paper market maker

**Date:** 2026-09-24 (America/Chicago)  
**Scope:** Paper-only. Research + thesis. No code changes, no live keys.  
**Inputs:** Mac+box tape archives (`data/paper-mm/archive/`, INDEX + dig reports) + public MM microstructure sources (cited).  
**Non-goals baked in:** no S1–S5, no soft-sim / mid_walk / $0 covers, no FV−mid mismatch trading as the product target.

---

## 1. Executive answer — the ONE primary edge

**Primary edge to build toward:**  
**Toxicity-filtered, mid-centered maker spread capture with forced inventory recycle before settlement.**

**Plain English:**  
We post maker quotes around the live book mid (house rules already do this), get paid when impatient / retail flow crosses us, then **recycle inventory back to flat while the book is still two-sided** — ideally via `house_cover` in a few minutes — **before** the 15m window settles to 0/1. We **refuse** to quote when the book or underlying says we are about to be picked off. We **never** count soft fills as edge.

**Mechanism (how $ is supposed to appear):**

1. **Earn the half-spread** as a maker on L2-realistic fills (`book_depth` / real touch), not by “walking” mid or inventing $0 covers.
2. **Inventory + τ skew** biases the reservation so inventory wants to mean-revert; cover path monetizes shorts (and selective longs) while mid still has depth.
3. **Hard τ gates** (noOpen / hardFlat / blackout) exist so we do not open late and do not hold Bernoulli risk into settlement — but they only help if inventory is actually flat before the window dies.
4. **Toxicity filter** (what we largely lack today): pull or pause the stale side when spot lead / book imbalance says the next fill is informed. That is how real PM makers keep the spread they “earned.”
5. **Scale path:** same engine across many 15m crypto books + (later, paper-modeled) Kalshi liquidity-incentive share for resting two-sided size — not bigger size on one BTC book.

**Why this can scale (in principle):**  
It does not require a proprietary FV that beats the mid. It requires (a) fill realism, (b) recycle speed, (c) not volunteering for toxic flow, (d) multi-market capacity. Funded desks scale the *same* loop with better cancel latency, better toxicity signals, and rebate/LP programs — not by finding a magic FV−mid gap.

**Honesty gate:**  
Under **strict L2**, our longest session (u328) is **session-flat to slightly red**. The cover channel is green; settlement-carry and flatten-long dumps wipe it. **We do not yet have a proven positive edge under strict L2.** U4’s job is to prove or kill this thesis with fail-loud paper metrics — not to ship more curb patches and call it millions.

---

## 2. Evidence from OUR tapes

### 2.1 Session ledger (FIFO, windowed by `ui-run-meta.startedAt`)

| Session | Class | Window (CT) | Fills | Soft % | FIFO $ | ≈$/hr | Short $ | Long $ | Flatten loss $ | Notes |
|---------|-------|-------------|------:|-------:|-------:|------:|--------:|-------:|---------------:|-------|
| u322 | FAKE-LEANING | 16:58–18:01 Sep 23 | 49 | 6.1 | **+5.67** | +5.7 | +6.61 | −0.94 | −1.60 | S3 covers; 10 low-mid longs; mid_walk present |
| u323 | MIXED | 18:26–19:28 | 52 | 17.3 | **+2.98** | +2.9 | +3.20 | −0.22 | −1.53 | curb 0.40 live; house_cover; still mid_walk |
| u324 | MIXED | 19:40–20:05 | 34 | 14.7 | **+0.01** | ~0 | +0.77 | −0.76 | −1.18 | mid>40¢ long → 1¢ flatten |
| u325 | MIXED | 20:14–20:47 | 28 | 14.3 | **−1.26** | −2.4 | +0.66 | −1.92 | −2.43 | curb 0.50 **not** applied (persist 0.40) |
| u326 | **FAKE-PNL** | ~21:00–21:42 | 36 | 11.1 | **+5.20** | +7.5 | +3.95 | +1.25 | 0 | **Do not learn** — see §2.3 |
| u328 | **STRICT** | 22:26 Sep 23 → 15:04 Sep 24 | 83 | **0.0** | **−1.17** | −0.07 | −0.94 | −0.23 | −2.78 | U3.2.8; 0 mid_walk; overnight |

Sources: `data/paper-mm/archive/INDEX.md`, dig reports, recomputed FIFO in `docs/_u4_tape_meta.json`.

### 2.2 What MADE money (when fills were at least semi-real)

Across u322–u325 (mixed realism, but directionally consistent):

- **Short YES → cover/flatten near low prices** dominated wins. Example tops: NEAR/BNB/XRP shorts covering toward 0 (u322 S3); ETH short 0.76→0 (u323 house_cover +$0.76); BNB short 0.47→0.01 (u324 +$0.46).
- **Open mid bands that paid on shorts:** roughly **50–80¢** and some **>80¢** short opens (u322 short open-mid PnL: 50–60 +$2.18, >80 +$2.63). Low-mid shorts (≤20¢) were mixed/toxic (u323 HYPE short 0.14→0.56 −$0.42).
- **Cover path hold times that worked:** wins often held **~3–10 min** (u323 win hold med ≈7.9m; u328 house_cover hold med ≈**2.5m**). Losses held longer into flatten (loss hold med often **~11–12m**).

### 2.3 What LOST money (recurring mechanisms)

1. **Long → hardFlat @ ~1¢ (“1¢ bleed”)**  
   Dominant closed losses whenever long opens were allowed below ~50–60¢ mid. u322: XRP/BTC/DOGE longs −$0.29 to −$0.35. u324: ZEC 0.49→0.01 (−$0.48), BTC 0.425→0.034 (−$0.40). u325: SOL/XRP longs −$0.52 to −$0.56. u328: BTC long 0.58→0.01 (−$0.57), SOL 0.51→0.01 (−$0.50).

2. **Settlement carry / cross-rotation inventory (u328 killer)**  
   Under strict L2, **settlement closes: n=13, PnL ≈ −$4.06** (almost all shorts). Several holds **~59 minutes** (SOL short 0.25→settle 0.845 −$0.60; HYPE 0.21→0.735 −$0.53). That is not “15m MM” — that is **inventory rolling into the wrong Bernoulli outcome**. Cover channel alone on u328 was **+$2.22 / 18 RTs**; settlement alone wiped more than that.

3. **τ ≤ 2m fill economics**  
   Early sessions: τ≤2 buckets often **net red** (u322 ≤2 rd −$1.52; u324 ≤2 −$1.18; u325 ≤2 −$2.23) — flatten dumps concentrate here. u328’s ≤2 bucket looks less red only because overnight settlement accounting moved losses into the settlement channel.

4. **Coin concentration**  
   No single coin is “the edge.” Under u328 strict: ETH +$0.48, SOL +$0.16, everything else red (BTC −$0.60, XRP −$0.40, HYPE −$0.37). Edge must be **rule-level**, not coin-picking.

### 2.4 Soft vs strict — do not learn from scam tape

| Signal | Soft / mixed | Strict (u328) |
|--------|--------------|---------------|
| mid_walk fills | 3–17% of fills | **0** |
| Session FIFO | Often green | **−$1.17** |
| Cover channel | Inflated by fantasy covers | **+$2.22 real L2 covers** |
| Fake cover signature | u326: buy_yes **px=0.0 with mid≈0.98–0.99** (NEAR/HYPE/SOL) — impossible on real asks | Absent |

**u326 is FAKE-PNL.** Report already flagged it; forensic confirms cover/flatten buys at **$0 while mid ≥ 0.98**. Those “wins” (+$0.72–$0.87) must not enter any edge claim.

**u322** is FAKE-LEANING (S3 + low-mid longs + some mid_walk): useful for **loss mechanisms**, not for claiming $/hr.

**Only u328 is a usable strict-L2 overnight sample** for edge claims — and it is **not green at session level**.

### 2.5 Component that *supports* the thesis under strict L2

On u328, restricting to RTs with open+close reasons in `{book_depth, taker_cross}` (excludes settlement channel):

- **28 RTs, FIFO ≈ +$2.89** (shorts ≈ +$3.15, longs ≈ −$0.26)
- Close mix: house_cover 18 / flatten 10

So: **the maker+cover loop can print under strict fills**; **settlement-carry and long-flatten dumps destroy the session**. That is the exact shape of a real MM problem (spread earned, inventory mismanaged), not “no mechanism exists.”

### 2.6 What the tape does *not* show

- No evidence that FV−mid gap trading is the money (and user rejected it).
- No evidence S1–S5 are needed.
- No evidence that more mid-band curb patches alone create a scalable edge.
- **No proof yet** that toxicity filters or LP incentives work for *us* — those are competitor gaps / U4 experiments.

---

## 3. What million-$ / serious PM-crypto MMs do that we currently ignore

Concrete gaps (mechanisms, not slogans). Paper framing only.

### Gap 1 — Adverse-selection / pickoff control as first-class

Practitioners treat **stale quote lifetime** as the P&L: shrink the window between underlying move and cancel ([99 Francs anti-pickoff](https://www.99francs.agency/blog/market-making-polymarket-anti-pickoff); [Polymarket MM docs](https://docs.polymarket.com/market-makers/trading)). We have τ parks and extreme-mid refuse; we do **not** yet have **spot-lead or book-imbalance cancel** that pulls the abandoned leg in near-real time.

Reddit lead-lag work on crypto UP/DOWN: passive side markout collapses when Binance-derived fair moves against the resting bid/ask ([r/PredictionsMarkets measurement thread](https://www.reddit.com/r/PredictionsMarkets/comments/1udy02s/measuring_binancetopolymarket_leadlag_on_5minute/)). That is a **toxicity filter**, not an FV−mid open signal.

### Gap 2 — Inventory half-life / markout KPIs (not session cash)

TierZero: watch **realized spread per RT** and **inventory half-life**; if half-life climbs in vol, skew is too weak; if RT spread < 0, you’re picked off ([TierZero CLOB MM guide](https://tierzero.dev/blog/polymarket-clob-market-making-bot-guide)).  
Our u328 cover half-life (~2.5m) looks healthy; settlement holds (~20–60m) are the failure mode. We journal fills but do not yet **gate the strategy on markout / half-life**.

### Gap 3 — Queue position (join vs improve)

Improving one tick buys fills and adverse selection; joining BBO sits behind size ([TierZero](https://tierzero.dev/blog/polymarket-clob-market-making-bot-guide); [queue estimation under partial depth](https://dev.to/mateosoul/queue-position-estimation-under-partial-order-book-visibility-for-a-polymarket-trading-bot-13d6)). U3.2.8 added usable strict L2 / BBO join — good direction — but we still lack **explicit join-vs-improve policy tied to inventory need**.

### Gap 4 — Order-book imbalance / stop buying the abandoned leg

Anti-pickoff systems **pause bids on the leg the book has left** rather than “sell faster” ([99 Francs](https://www.99francs.agency/blog/market-making-polymarket-anti-pickoff)). Our loss tape is full of adding into a mid that then ran to 1¢ or settled against us.

### Gap 5 — Venue economics: resting liquidity rewards (scale lever)

Kalshi’s [Liquidity Incentive Program](https://help.kalshi.com/en/articles/13823851-liquidity-incentive-program) pays for **resting** size near a reference price on two-sided books (snapshot scoring). Crypto 15m appears in designated LP / incentivized series discussions ([LP program](https://help.kalshi.com/en/articles/15410219-liquidity-provider-program)). Serious desks treat rebate/LP share as part of edge after adverse selection ([r/PredictionsMarkets MM start FAQ](https://www.reddit.com/r/PredictionsMarkets/comments/1uarqic/how_does_someone_get_started_as_a_market_maker_in/); poly-maker regime machine for reward farming in quiet regimes — [warproxxx/poly-maker](https://github.com/warproxxx/poly-maker)).  
We currently optimize **fill PnL only** and ignore “get paid to rest.” Paper should **model** incentive score; not assume live keys fix economics.

### Kalshi 15m microstructure notes (constraints on the edge)

- Settlement: 60s average of CF Benchmarks BRTI around the window close; ties resolve Yes on “at least” style rules ([settlement explainer](https://predictionmarketspicks.com/articles/how-kalshi-settles-bitcoin); [BRTI](https://www.cfbenchmarks.com/data/indices/BRTI)). Last-minute books pin or thin — **holding into that window is a different bet than making markets at τ=10m**.
- YES/NO duality: book returns bids on both sides; YES bid ↔ NO ask at 1−p ([Kalshi orderbook docs](https://docs.kalshi.com/getting_started/orderbook_responses.md)). Complementary two-sided resting is both MM craft and LP scoring input.
- Spreads: BTC 15m can be ~1¢; wider alts (e.g. DOGE cited ~3–4¢) are where passive capture is larger if toxicity is controlled ([Kalshi BackTest DOGE note](https://kalshibacktest.com/resources/market-making-kalshi-doge-15m) — treat as practitioner claim, not gospel).
- Tick / depth: sub-cent possible; depth is thin near extremes — matches our extreme-mid refuse house rule.

---

## 4. Kill list — looks lucrative on soft tape, dies under real L2

| Strategy / artifact | Why it looks good | Why it dies |
|---------------------|-------------------|-------------|
| **mid_walk / fillMidFallback / soft covers** | Instant fills, fat “covers” | Not executable; invents PnL |
| **u326-style px≈0 cover with mid≈0.98** | +$5 / 44m, 17W/1L | Buying YES at 0 when ask is ~0.99 is fantasy |
| **Learning $/hr from u322 S3 jackpots** | +$5.7/hr | Mix of soft + path luck + low-mid long bleed still present |
| **S1–S5 scenario zoo** | Narrative fill tags | User rejected; not the house mid product |
| **FV−mid mismatch / gap opens** | Academic “mispricing” story | User rejected; not our center |
| **Holding inventory across rotations into settlement** | Avoids paying the touch to flatten | u328: −$4 settlement channel; 59m holds |
| **Long opens mid ≤ ~50–60¢ “for balance”** | More two-sided looking book | Systematic 1¢ flatten bleed on tape |
| **Chasing fill count** | Busy journal | u323: same fills, worse $; quality ≫ count |
| **Soft-sim backtests as go-live evidence** | Pretty equity curves | Touch-based fills overstate edge (PM MM consensus) |

---

## 5. U4 phased build plan (3–5 small shippable slices, fail-loud)

Each slice ships only if the **journal metric** clears. Paper-only. No live keys.

### Slice U4.1 — Settlement-flat invariant (kill cross-rotation carry)

**Build:** Fail-loud if any book still has `|q|>0` when the contract enters settlement / roll; force flatten path; **never** open on a new window while old inventory exists; journal `settlement_carry_violation` if it happens.  
**Success metric (paper journal):**  
- `settlement_close_n = 0` over ≥ 8 consecutive 15m rotations, **or**  
- settlement-channel FIFO PnL ≥ 0 **and** max hold_min of any RT ≤ 14m.  
**Fail:** any RT hold > 20m or settlement PnL < −$1 on a 2h dig → stop and dig, do not proceed to U4.2 size.

### Slice U4.2 — Strict-L2 cover-channel proof (isolate the edge)

**Build:** Already mostly on U3.2.8; add dig report that **separates** house_cover vs flatten vs settlement PnL and soft% (must be 0). Soft fill ⇒ fail-loud session invalid.  
**Success metric:** Over ≥ 3 hours strict paper:  
- soft% = 0  
- house_cover RT PnL > 0  
- session FIFO > 0 **after** U4.1  
- cover hold med ≤ 5m  
**Fail:** cover green but session red only from flatten → go to U4.3, not “more opens.”

### Slice U4.3 — Soft-exit / mark-bleed before hardFlat (cut 1¢ long dumps)

**Build:** Underwater inventory reduces **before** τ≤2 hardFlat dump when mid moves against by X¢ or markBleed threshold (house_soft_exit path, strict L2 prices only).  
**Success metric:**  
- long flatten loss $ / hour ≤ 50% of u325/u328 baseline (e.g. target flatten-long ≤ −$0.40/hr on similar activity)  
- adverse long rate (close_mid < open_mid − 0.05) declining  
**Fail:** soft-exit itself shows mid_walk or px incompatible with L2 → slice invalid.

### Slice U4.4 — Toxicity pause (spot lead + book imbalance), paper telemetry first

**Build:** Paper-only signals: (1) underlying spot move vs strike / open over last N seconds; (2) YES vs NO depth imbalance. When toxic → pause **adding** side (imbalance guard), allow reduce. **Do not** use as FV−mid open trigger.  
**Success metric:**  
- Post-fill 30s/60s mid markout on paused-regime avoided fills ≥ improvement vs control hour  
- Adverse selection rate (markout < 0) down ≥ 20% relative on equal fill count  
**Fail:** pause kills fill rate to ~0 with no markout improvement → simplify thresholds or kill slice.

### Slice U4.5 — Scale readiness: multi-book + LP-score model (still paper)

**Build:** Quote N books with shared inventory/risk budget; log hypothetical Kalshi LP snapshot score (two-sided, size, distance to reference).  
**Success metric:**  
- Per-book cover-channel ≥ 0 under strict L2  
- Portfolio $/hr ≥ single-book after U4.1–4  
- LP-score model shows non-zero resting reward **without** requiring toxic fills  
**Fail:** only the widest alt prints and BTC is structurally −EV under our latency → concentrate universe (honest), do not fantasize BTC 1¢ books pay retail makers.

---

## 6. Explicit non-goals

- **S1–S5** scenario engines / tags as quote drivers (house tags only).
- **Soft-sim:** mid_walk, random, fillMidFallback, $0 covers, any fill not supported by live L2 depth/touch.
- **FV−mid mismatch / gap trading** as the primary open selector or ranker (FV may stay telemetry only).
- **Academic “best stack” bibliography** as a substitute for tape + mechanism (user rejected).
- **Live API keys / going live** as the fix for missing edge.
- **Optimizing U3.2 curb patches** as if they alone produce million-$ desk outcomes.
- **Treating u326 (or any soft%) as proof of edge.**

---

## 7. One-page verdict

| Question | Answer |
|----------|--------|
| Is there a coherent edge to pursue? | **Yes:** mid-centered maker + recycle-before-settlement + toxicity filter. |
| Does our strict tape prove it yet? | **No.** u328 session ≈ −$1.17; cover +$2.22 wiped by settlement −$4 and flatten longs. |
| What would falsify the thesis? | After U4.1–U4.2, still session FIFO ≤ 0 over ≥ 6 strict hours with soft%=0 and no settlement carry. |
| What would confirm it? | Soft%=0, settlement carry=0, cover-channel > 0, session FIFO > 0, inventory half-life stable, markout not deeply adverse. |
| Biggest competitor gap vs us | Pickoff control (spot/imbalance cancel) + markout/half-life ops + LP resting economics. |

---

## 8. Source index (URLs)

**Our tape:** `data/paper-mm/archive/INDEX.md` and session folders `20260923-mac-u322-dig` … `20260924-mac-u328-midrun`; supporting numbers in `docs/_u4_tape_meta.json`.

**Competitor / venue (mechanism-bearing):**

- https://docs.polymarket.com/market-makers/trading  
- https://tierzero.dev/blog/polymarket-clob-market-making-bot-guide  
- https://www.99francs.agency/blog/market-making-polymarket-anti-pickoff  
- https://github.com/warproxxx/poly-maker  
- https://www.reddit.com/r/PredictionsMarkets/comments/1udy02s/measuring_binancetopolymarket_leadlag_on_5minute/  
- https://www.reddit.com/r/PredictionsMarkets/comments/1uarqic/how_does_someone_get_started_as_a_market_maker_in/  
- https://help.kalshi.com/en/articles/13823851-liquidity-incentive-program  
- https://help.kalshi.com/en/articles/15410219-liquidity-provider-program  
- https://docs.kalshi.com/getting_started/orderbook_responses.md  
- https://predictionmarketspicks.com/articles/how-kalshi-settles-bitcoin  
- https://www.cfbenchmarks.com/data/indices/BRTI  
- https://kalshibacktest.com/resources/market-making-kalshi-doge-15m  
- https://concxpt.substack.com/p/adaptive-optionality-market-makers  

---

PAPER ONLY. Green paper ≠ live edge. No live keys in this thesis.
