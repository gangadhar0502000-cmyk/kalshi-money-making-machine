# U3 Quote Logic Research Brief

**Scope:** Paper-only research for a personal Kalshi-style crypto **15-minute binary** market maker (YES/NO → 0/1). Quoting is paused (U3.0). This document covers **quote logic ideas only** — no trading code, no live placement recipes.

**Date compiled:** 2026-09-22 (America/Chicago). Sources span classics through 2025–2026 working papers and practitioner docs.

**Method note:** Prefer primary papers / official docs. Practitioner blogs are labeled as such. Claims without citation are flagged as open questions, not facts.

---

## 1. Executive summary (≤12 bullets)

1. **CLOB MM ≠ LMSR.** Kalshi/Polymarket are quote-driven CLOBs. LMSR/CPMM literature (Hanson 2003; Chakraborty–Das–Peabody 2015) is useful as contrast — bonding-curve “always quote” is not what a CLOB maker does; makers cancel/replace freely (Polymarket MM docs; Chakraborty et al. 2015).
2. **Fair value for crypto binaries is a digital/cash-or-nothing style probability**, classically \(e^{-r\tau}N(d_2)\) under BS — but several PM papers argue pure BS is a category error for event contracts without a continuous hedgeable underlying (Horacle Capital 2026; Feil–Nendel 2026). For **15m BTC up/down**, a short-horizon digital on spot vs strike *is* closer to BS/digital than election contracts — still need careful vol/τ and settlement-oracle basis.
3. **Reservation-price / AS-style inventory skew remains the backbone**, but must respect **[0,1] bounds**. Logit-space AS (LAS) and latent-belief HJB models are the serious 2025–26 adaptations (Horacle 2026; Feil–Nendel 2026; Guéant–Lehalle–Fernandez-Tapia 2013 for finite-horizon inventory limits).
4. **Hard settlement changes inventory risk.** Holding inventory into resolution is Bernoulli risk \(q^2 p(1-p)\), not mean-reverting mark-to-market. Feil–Nendel (2026) explicitly separate **running MtM penalty** vs **terminal settlement penalty**; Guéant et al. force flat-ish inventory via CARA terminal utility + hard \(Q\) limits.
5. **Near expiry, adverse selection steepens.** Glosten–Milgrom / short-lived information: expected spreads widen when private info dies soon (welfare-cost-of-informed-trade literature). Practitioner PM guides: cancel fast on news; widen or pull near catalysts (Polymarket docs; TradeAlgo / NYCServers practitioner writeups).
6. **Kalshi maker economics matter for edge sizing.** Bürgi–Deng–Whelan (UCD WP 2025): makers lose less than takers (−12% vs −31% avg returns in their sample), favorite–longshot bias exists; makers who buy high-priced contracts show small positive post-fee returns. Fee formula historically ~\(0.07\,p(1-p)\) on many markets; **maker fees are series-dependent** (Kalshi help 2026) — do not assume universal $0 maker.
7. **Complements: YES bid ≡ NO ask at \(1-p\).** Quoting both complementary bids below $1 locks a complete-set edge if both fill (Polymarket docs; StartPolymarket 2026). Partial fill = directional inventory — classic MM failure mode.
8. **15m vs 5m settlement-manipulation risk.** Dai–Jia–Yu (2026): Polymarket **5-minute** BTC up/down shows Binance spot order-flow spikes and reversals at settlement; **15-minute** attenuates the signature. For a 15m Kalshi crypto MM, treat settlement-window toxicity as **material but design-mitigated relative to 5m**, not zero.
9. **Do not copy equity AS blindly:** unbounded mid, soft liquidation at \(T\), infinite-horizon asymptotics, and soft-sim fill assumptions break on binaries with hard 0/1 settlement (Guéant asymptotic ≈ constant quotes far from \(T\) vs AS near-\(T\) expansion; Feil–Nendel terminal \(\Phi\)).
10. **Cancel/replace cadence is first-class risk control**, not an implementation detail: Linnainmaa (2010) (cited in Bürgi et al.) — passive limits get picked off around news unless actively cancelled; Polymarket docs recommend GTD before catalysts.
11. **Candidate quote-logic families** (Section 9) are mutually exclusive design choices for later — **no implementation recommendation here**.
12. **Literature gap:** almost no peer-reviewed, venue-calibrated HJB for **Kalshi 15m crypto CLOB** specifically; Feil–Nendel is generic PM; Horacle is Polymarket-oriented working paper; Bürgi et al. exclude short crypto hourlies from main sample.

---

## 2. Fair value approaches (spot → probability, τ, vol)

### 2.1 Digital / cash-or-nothing (underlying = crypto spot)

Under Black–Scholes with spot \(S\), strike \(K\), vol \(\sigma\), rate \(r\), dividend \(q\), time-to-expiry \(\tau\):

\[
\text{cash-or-nothing call} = e^{-r\tau} N(d_2),\quad
d_2 = \frac{\ln(S/K)+(r-q-\sigma^2/2)\tau}{\sigma\sqrt{\tau}}.
\]

\(N(d_2)\) is the **risk-neutral** ITM probability (standard derivatives texts / Quant SE binary-option threads). For Kalshi-style “BTC above \(K\) at \(T\)” or up/down vs open, this is the natural continuous-time FV center — **if** you accept RN pricing and can estimate \(\sigma\) at 15m horizons.

**Caveats for 15m crypto binaries (cited):**
- **Gamma blow-up / hedge intractability near expiry** when using continuous Greeks (Horacle Capital 2026 §2.3).
- **Oracle / venue settlement ≠ your spot mid** (Dai–Jia–Yu 2026: Chainlink vs Binance basis; Kalshi uses its own settlement rules — verify series docs before trusting any \(S\)).
- **Vol is not equity daily vol**: 15m realized/implied needs high-frequency calibration; flat \(\sigma\) is a modeling choice, not a fact.

### 2.2 Latent belief / logit martingale (event-native)

Feil–Nendel (2026): price \(p_t = f(L_t)\) with \(f\) logistic; choose drift of \(L\) so \(p\) is a **martingale** in \((0,1)\); volatility \(\varsigma(t,p)\) state-dependent (often peaking near \(p=1/2\) and rising as \(t\to T\)).

Horacle (2026): logit \(L=\ln(p/(1-p))\); argue BS-on-spot is inadequate for pure event binaries; recommend probability-native tools + LAS quoting.

**For crypto 15m:** hybrid is coherent — use spot→digital as **signal**, map through logit for **quoting dynamics**, but do not pretend election-style “no underlying” if the contract is explicitly on BTC/ETH.

### 2.3 Market mid as FV (what *not* to default to)

Polymarket MM docs: midpoint describes the book; strategy must decide if it is fair. Practitioner bots (e.g. polybot-AS repos) explicitly center on BS FV rather than stale mid. Bürgi et al. (2025): Kalshi prices are informative and improve toward close, but **biased** (favorite–longshot) — mid ≠ unbiased \(P(Y=1)\).

### 2.4 Fees in “fair”

Break-even for a taker is not \(p=\pi\); Kalshi fee incidence \(\propto p(1-p)\) hits cheap contracts harder as % of stake (Bürgi et al.; Whelan 2023 cited therein). Maker FV for posting should be **edge after expected fees/rebates**, series-specific.

---

## 3. Quoting frameworks (AS reservation, inventory skew, one- vs two-sided)

### 3.1 Classics

| Framework | Core idea | Relevance to 15m binary |
|-----------|-----------|-------------------------|
| **Ho–Stoll (1981)** | Dealer reservation price under inventory + return uncertainty | Ancestor of inventory skew |
| **Avellaneda–Stoikov (2008)** | Reservation mid \(r=s-q\gamma\sigma^2(T-t)\); optimal spread vs intensity \(\kappa\) | Standard inventory MM; mid unbounded |
| **Guéant–Lehalle–Fernandez-Tapia (2013)** | AS + hard inventory limits \(Q\); HJB → linear ODE; asymptotic quotes ≈ constant far from \(T\) | **Finite horizon + inventory caps** — closer to settlement deadline |
| **Glosten–Milgrom (1985)** | Bid/ask = conditional expectations given buy/sell; adverse selection creates spread | Toxicity / informed flow |
| **Kyle (1985)** | Informed trader + noise; price impact λ | Flow → impact; less direct for discrete binary quotes |

AS reservation vs optimal quotes (Quant SE 66259): reservation = inventory-adjusted “personal mid”; optimal depths also fold in liquidity \(\kappa\) / competition.

### 3.2 Binary / PM adaptations

**Logit Avellaneda–Stoikov (LAS)** — Horacle Capital (2026):
- Work in \(L=\mathrm{logit}(p)\); reservation logit \(\ell = L - q\gamma\sigma_L^2(T-t)\); map back with sigmoid.
- Probability-space spread asymmetric; impose \(\varepsilon \le p_b < p_a \le 1-\varepsilon\).
- **Flag:** working paper / industry research, not peer-reviewed journal as of fetch date.

**Optimal MM in prediction markets** — Feil–Nendel (2026, arXiv:2607.17991):
- Full HJB with quotes in \([0,1]\); running inventory penalty \(\gamma q^2\varsigma^2\); terminal settlement penalty \(\Phi\) (e.g. \(-\gamma_T q^2 p(1-p)\)).
- Optimal quotes from inventory-difference “indifference” prices \(z_b,z_a\).
- Numerical finding: optimal strategy ≈ same mean PnL as myopic spread-max, **much lower** VaR/ES and \(|q_T|\).
- Complements: quoting one contract with shorts ≡ two complementary books.

**Guéant market-impact / adverse-selection extension:** add \(\xi\) jump of mid on fill → wider quotes (adverse selection premium).

### 3.3 One-sided vs two-sided

- **Two-sided** required for rebate/liquidity programs on Polymarket (epoch score uses \(\min(Q_\mathrm{bid},Q_\mathrm{ask})\)) — Kalshi incentive programs differ; check current MM program (CFTC filings exist historically).
- **One-sided** when inventory at hard limit \(Q\) (Guéant; Feil–Nendel): withdraw constrained side.
- **Asymmetric sizes** as soft skew alternative to price skew (practitioner guides).

---

## 4. Adverse selection & toxicity near expiry

### 4.1 Theory

- **Glosten–Milgrom:** informed arrivals widen quotes; prices converge as info is revealed.
- **Short-lived information:** welfare / spread literature finds expected spreads often **wider** when info dies soon (less time for “dynamic efficiency” to offset early toxicity).
- **Feil–Nendel intensities:** activity \(A(t,p)\) can rise toward \(T\); spread sensitivity \(k(t)\) can rise — quotes must sit closer to mid to get fills, while settlement risk rises → **non-monotone** spread vs time (widen near \(T\) at \(p\approx 1/2\) in their numerics).
- **Dai–Jia–Yu (2026):** settlement **manipulation** is a distinct toxicity channel for asset-price binaries — uninformed spot push at close; PM makers face flip risk; longer horizon is the design fix. **15m ≪ 5m** in their evidence.

### 4.2 Practitioner (flag as non-academic)

- Stale quotes + binary jump → catastrophic loss vs small spread income (StartPolymarket 2026: worked \( \$51\) adverse vs \( \$4\) round-trip example).
- Mitigations cited repeatedly: pull near resolution/catalysts; GTD; size caps; prefer diffuse-info markets; monitor news (Polymarket docs; TradeAlgo; NYCServers).
- Bürgi et al.: Makers must cancel when news arrives — otherwise look like Linnainmaa limit-order losers around announcements.

### 4.3 Flow toxicity metrics

VPIN / bulk-volume classifiers are **implementation-sensitive**; prediction-market studies caution tick-rule VPIN can be near-random without aggressor flags (survey hits on Polymarket-v1 / toxicity notes). Prefer venue aggressor flags (Kalshi maker/taker labels are unusually clean — Bürgi et al.).

---

## 5. Complements / YES ↔ NO book choice

**Identity:** In binary markets, buying NO at \(p_\mathrm{NO}\) ≡ selling YES at \(1-p_\mathrm{NO}\) (Polymarket MM docs).

**Complete-set maker pattern** (practitioner + docs):
1. Bid YES at \(b_Y\), bid NO at \(b_N\) with \(b_Y+b_N < 1\) (after fees).
2. If both fill → hold complete set → redeem $1 → locked edge \(1-(b_Y+b_N)\).
3. If only one fills → **directional inventory** until the other fills or you unwind.

**Risks:**
- Partial fill is the dominant failure mode (Predictefy / arb writeups; Polymarket docs inventory section).
- Fee + rounding can erase thin complete-set edges (Bürgi fee incidence discussion).
- Multi-outcome **NegRisk** (Polymarket) changes set math — usually N/A for simple crypto YES/NO.

**Kalshi microstructure note (Bürgi et al.):** Best YES + best NO offers sum to **> $1**; maker posting both sides below $1 seeks the complementary arb but has **no fill guarantee**.

---

## 6. Inventory & hard flat / settlement

| Source | Inventory objective |
|--------|---------------------|
| AS 2008 | CARA utility of \(X_T + q_T S_T\) (soft mark at mid) |
| Guéant 2013 | Same + hard \(\|q\|\le Q\); asymptotic mean-reversion of quotes |
| Feil–Nendel 2026 | \(\mathbb{E}[X_T+q_T Y]\) − running \(\gamma\int q^2\varsigma^2\) − terminal \(\Phi(p_T,q_T)\); natural \(\Phi=-\gamma_T q^2 p(1-p)\) |
| Polymarket docs | Skew prices/sizes; split/merge sets; deliberate exit; redeem after resolution |
| Practitioner PM guides | Time-based inventory decay; hard position limits; “hold and hope” fails because price marches to resolution |

**15m implication:** With \(\tau\le 15\) minutes, **terminal settlement risk dominates** continuous MtM — Feil–Nendel’s \(\gamma_T\) knob is more important than equity-style overnight inventory models. Hard flat before settlement (cancel + aggressive unwind via FAK/FOK) is a **policy choice**, not implied by AS alone.

**Crypto-specific:** Optional delta hedge on perps (polybot-style) is a **separate** risk book; literature split on whether short-dated digital gamma is hedgeable in practice (Horacle argues against naive BS hedging for event markets).

---

## 7. Spread, size, cancel/replace cadence

### Spread
- AS/Guéant: wider with \(\sigma\), \(\gamma\), \((T-t)\); tighter with arrival intensity \(A\) / \(\kappa\).
- LAS: auto-widens in probability space near 0/1 for fixed logit spread — then clamp to tick/ε (Horacle Prop. on boundary saturation).
- Feil–Nendel: spreads often **fall** mid-horizon as \(k(t)\) rises, then **widen** near \(T\) at uncertain \(p\).
- Fees: minimum economic spread must cover adverse selection + fee incidence + rebate opportunity cost.

### Size
- Guéant / Feil–Nendel: discrete trade size \(\Delta\); inventory grid.
- Practitioner: equal two-sided size baseline; reduce size as \(|q|\) or \(\tau\downarrow\); respect venue min size / tick (Polymarket: min shares, tick 0.01 or 0.001).

### Cancel/replace
- Orders not editable in place on Polymarket — cancel+replace (docs). Kalshi similar resting-order model.
- **Cadence research content (logic, not bots):** refresh when FV moves by ≥1 tick, inventory crosses skew bands, or toxicity flags fire; use GTD to expire before known catalysts; kill-switch on position limits (Polymarket best practices).
- Guéant backtest practice: hold quotes for \(\Delta t\) unless fill — discrete time approximation to continuous control.

**Flag:** Exact Hz / ms cadence for Kalshi 15m is an **empirical calibration gap**, not settled in journals.

---

## 8. What failed ideas look like

| Failed idea | Why it fails (cited / reasoned from sources) |
|-------------|-----------------------------------------------|
| **Equity AS with mid = soft terminal** | Binary settles 0/1; marking leftover \(q\) at mid understates Bernoulli risk (Feil–Nendel vs AS terminal). |
| **LMSR bonding curve on CLOB** | Wrong microstructure; LMSR is dealer/AMM; CLOB makers cancel (Chakraborty et al. 2015; Hanson LMSR). |
| **Infinite soft fills / simulator optimism** | Partial complete-set fills; queue priority; adverse cancel races (Bürgi; Polymarket latency notes). |
| **Churn closes / mid-fallback** | Quoting mid without edge = free option to informed; “always join mid” maximizes adverse selection (GM). |
| **Hold inventory hoping mean reversion** | PM prices march to resolution; trending book = information, not noise (practitioner inventory pathology essays; Feil–Nendel settlement). |
| **Copy 5m crypto MM blindly on 15m** | Dai–Jia–Yu: manipulation / settlement toxicity much worse at 5m; 15m is safer but not identical product. |
| **Ignore favorite–longshot** | Cheap contracts systematically overpriced for buyers in Kalshi sample (Bürgi et al.) — naive FV = last trade hurts makers posting to sell cheap YES. |
| **Assume $0 maker fee everywhere** | Kalshi: maker fees series-dependent (Help Center 2026). |

---

## 9. Candidate quote-logic families (no implementation pick)

### Family A — **Logit / bounded Avellaneda–Stoikov (LAS-lite)**
- **Core idea:** Center quotes on FV probability; transform to logit; AS reservation + spread; sigmoid back; clamp to \((\varepsilon,1-\varepsilon)\) and ticks.
- **Knobs:** \(\gamma\), \(\sigma_L\) (or mapped from spot vol), \(\kappa\)/\(A\), \(q\) skew, \(\varepsilon\), \(\tau\)-schedule.
- **Risks:** Mis-estimated \(\sigma_L\); boundary clamp dead-zones; still soft on settlement unless \(\gamma(\tau)\) ramps; Horacle paper is not peer-reviewed.
- **Citations:** Avellaneda–Stoikov 2008; Guéant et al. 2013; Horacle Capital 2026; Comillas TFM AS-on-Polymarket (Bernoulli variance variant).

### Family B — **Settlement-penalized HJB / Feil–Nendel-style**
- **Core idea:** Explicit running MtM variance penalty + terminal \(\Phi=-\gamma_T q^2 p(1-p)\); intensities \(\Lambda(t,p,\pi)\); solve/approximate HJB for \(\pi^{b*},\pi^{a*}\).
- **Knobs:** \(\gamma\), \(\gamma_T\), \(Q\), \(\Delta\), intensity shape \((A_0,A_1,k_0,k_1,\nu)\), vol-of-belief \(\sigma(t,p)\).
- **Risks:** Heavy calibration; misspecified \(\Lambda\); computational; still abstract vs Kalshi fee/tick microstructure.
- **Citations:** Feil–Nendel 2026; Guéant 2013 (ODE reduction cousin); Cartea–Jaimungal risk metrics.

### Family C — **Complete-set / complementary two-bid maker**
- **Core idea:** Primary edge = \(1-(b_Y+b_N)\) when both resting bids fill; inventory skew only manages unpaired legs; optional merge/redeem.
- **Knobs:** Target sum \(b_Y+b_N\), imbalance skew, max unpaired \(q\), timeout to unwind unpaired, fee haircut.
- **Risks:** Chronic one-sided markets; unpaired Bernoulli blowups; fee/tick erase edge; low fill rate if too tight sum.
- **Citations:** Polymarket MM docs; StartPolymarket 2026 worked example; Bürgi et al. on YES+NO>$1 offers; CTF split/merge docs.

### Family D — **Glosten–Milgrom / toxicity-aware quoting**
- **Core idea:** Quotes = conditional expectations given hit direction; widen with estimated informed arrival rate \(\mu\); pull when short-lived info risk spikes (news, settlement window).
- **Knobs:** \(\mu\) prior, uninformed intensity, settlement-window blackout, markout horizon for online \(\mu\) update.
- **Risks:** Hard to estimate \(\mu\) on thin books; over-widen → no fills; under-widen → adverse selection; manipulation channel needs separate detector (Dai–Jia–Yu).
- **Citations:** Glosten–Milgrom 1985; Kyle 1985; Dai–Jia–Yu 2026; short-horizon informed-trade welfare papers.

### Family E — **Digital FV + inventory skew + hard τ-flatten (practitioner hybrid)**
- **Core idea:** FV = digital \(N(d_2)\) from spot+IV; reservation skew linear in \(q\) and accelerating as \(\tau\to 0\); hard rules: max \(|q|\), flatten by \(\tau^*\), GTD before settlement, no quotes in final \(N\) seconds.
- **Knobs:** vol source, skew \(\alpha q\), \(\tau^*\) flatten clock, final blackout \(N\), size(\(\tau,q\)).
- **Risks:** Ad hoc (not HJB-optimal); vol errors near expiry; blackout cedes flow; hedge optional and slippery.
- **Citations:** Digital option pricing standards; AS skew intuition; Guéant inventory limits; Polymarket GTD/catalyst guidance; Dai–Jia–Yu horizon evidence for blackout near settlement.

---

## 10. Open questions / gaps for Kalshi 15m specifically

1. **No public HJB calibrated to Kalshi 15m crypto CLOB** (fees, ticks, queue, maker/taker labels, settlement oracle).
2. Bürgi–Deng–Whelan (2025) **explicitly drop** Kalshi markets that reset every hour (crypto/index) — so favorite–longshot / maker–taker results may **not** transfer to 15m crypto.
3. Empirical **order-arrival intensity** \(\Lambda(\delta,t,p)\) on Kalshi crypto binaries — Feil–Nendel note this is largely unstudied.
4. **Settlement reference** for each Kalshi crypto series (index, exchange, TWAP?) vs spot used for FV — basis risk undocumented in academic MM papers.
5. Interaction of **maker fee schedules by series** (2026 fee PDF) with optimal spread — needs series-level schedule, not a single \(\theta\).
6. Whether **15m Kalshi** shows Dai–Jia–Yu-style settlement flow on the underlying (their evidence is Polymarket/Binance/Chainlink).
7. Optimal **cancel/replace rate** under Kalshi matching/queue priority — engineering empirics, not theory.
8. Multi-market inventory (BTC 15m ladder of strikes) — Guéant multi-asset exists for equities; not adapted to Kalshi strike grids in published work found here.
9. Regulatory / MM-program quoting obligations if user later joins official MM programs (CFTC rule filings) — out of scope for paper logic but relevant later.

---

## 11. Full source list with links

### Academic / working papers / journals

1. Avellaneda, M. & Stoikov, S. (2008). *High-frequency trading in a limit order book.* Quantitative Finance 8(3), 217–224. https://people.orie.cornell.edu/sfs33/LimitOrderBook.pdf · https://math.nyu.edu/~avellane/HighFrequencyTrading.pdf
2. Guéant, O., Lehalle, C.-A. & Fernandez-Tapia, J. (2013). *Dealing with the Inventory Risk: A solution to the market making problem.* Mathematics and Financial Economics. https://arxiv.org/pdf/1105.3115.pdf
3. Ho, T. & Stoll, H. (1981). *Optimal dealer pricing under transactions and return uncertainty.* Journal of Financial Economics 9(1), 47–73. https://doi.org/10.1016/0304-405X(81)90020-9
4. Glosten, L. & Milgrom, P. (1985). *Bid, ask and transaction prices in a specialist market with heterogeneously informed traders.* Journal of Financial Economics 14(1), 71–100.
5. Kyle, A. (1985). *Continuous Auctions and Insider Trading.* Econometrica 53(6), 1315–1335.
6. Hanson, R. (2002/2007). *Logarithmic Market Scoring Rules for Modular Combinatorial Information Aggregation.* https://mason.gmu.edu/~rhanson/mktscore.pdf
7. Chakraborty, M., Das, S. & Peabody, J. (2015). *Price Evolution in a Continuous Double Auction Prediction Market With a Scoring-Rule Based Market Maker.* AAAI. https://ojs.aaai.org/index.php/AAAI/article/download/9313/9172
8. Heidari, H., Lahaie, S., Pennock, D. & Vaughan, J. (2015). *Integrating Market Makers, Limit Orders, and Continuous Trade in Prediction Markets.* http://www.cs.cmu.edu/~hheidari/heidari2015integrating.pdf
9. Bürgi, C., Deng, W. & Whelan, K. (2025). *Makers and Takers: The Economics of the Kalshi Prediction Market.* UCD WP25/19. https://www.ucd.ie/economics/t4media/WP2025_19.pdf
10. Feil, D. & Nendel, M. (2026). *Optimal Market Making in Prediction Markets.* arXiv:2607.17991. https://arxiv.org/abs/2607.17991 · https://arxiv.org/html/2607.17991v1
11. Dai, H., Jia, R. & Yu, S. (2026). *Settlement Manipulation in Prediction Markets.* arXiv:2606.31675. https://arxiv.org/html/2606.31675v1
12. Horacle Capital Research (2026). *Microstructure, Market Making, and Algorithmic Arbitrage on Decentralised Prediction Markets* (working paper). https://horaclecapital.com/assets/pdf/polymarket_paper.pdf
13. Parshant (2025). *Market Making Mechanisms and Liquidity Dynamics in Blockchain-Based Prediction Markets* (TUM MA thesis). https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf
14. Comillas ICAI TFM (n.d.). *El Oráculo Algorítmico: Creación de Mercado en Plataformas de Predicción (Polymarket)* — AS adapted to [0,1] with Bernoulli variance. https://repositorio.comillas.edu/items/a780adff-a550-476d-8241-ace07a505ffc

### Official / industry docs

15. Polymarket Docs — Market Making. https://docs.polymarket.com/trading/market-making
16. Kalshi Help — Fees (Apr 19, 2026). https://help.kalshi.com/en/articles/13823805-fees
17. Kalshi Fee Schedule PDF. https://kalshi.com/docs/kalshi-fee-schedule.pdf
18. Kalshi Fee Schedule page. https://kalshi.com/fee-schedule

### Forums / Q&A (high-signal)

19. Quant StackExchange — AS reservation vs optimal quotes. https://quant.stackexchange.com/questions/66259/in-avellaneda-stoikov-market-making-what-is-the-difference-between-reservation
20. Quant StackExchange — Pricing binary options. https://quant.stackexchange.com/questions/63167/pricing-binary-options
21. Quant StackExchange — Avellaneda–Stoikov model. https://quant.stackexchange.com/questions/36400/avellaneda-stoikov-market-making-model

### Practitioner posts (use cautiously)

22. StartPolymarket — *Market Making on Polymarket: Spreads, Rebates & Risk* (updated Sep 15, 2026). https://startpolymarket.com/strategies/market-making/
23. TradeAlgo — Prediction Market Maker Strategies. https://www.tradealgo.com/trading-guides/prediction-markets/prediction-market-maker-strategies-how-to-provide-liquidity-and-profit-from-event-contracts
24. NYCServers — Market Making on Prediction Markets: Complete 2026 Guide. https://newyorkcityservers.com/blog/prediction-market-making-guide
25. CasaTrick Substack — Polymarket arbitrage bot strategies. https://casatrick.substack.com/p/polymarket-arbitrage-bot-5-strategies-explained

### Code / illustrative (not citations for facts)

26. YISOWAK/polybot-market-maker — AS + BS binary FV on Polymarket (illustrative). https://github.com/YISOWAK/polybot-market-maker
27. holypolyfoundation/bs-p — Logit AS kernel (illustrative). https://github.com/holypolyfoundation/bs-p

---

## Appendix A — LMSR vs CLOB MM (one-paragraph reminder)

LMSR sets a global cost function \(C(q)\) and always trades as the dealer with bounded loss (Hanson). CLOB MMs post discretionary limits, cancel on news, and bear inventory + settlement risk without an automatic loss bound. Chakraborty–Das–Peabody (2015) show even *integrating* LMSR into a CDA (as another book participant) improves spreads/surplus but **need not** improve price discovery. For Kalshi quote logic, treat LMSR as **what not to copy** as the primary quoting engine.

## Appendix B — Research method honesty

Fetched in depth: UCD Kalshi WP PDF; Horacle Polymarket WP PDF; Guéant arXiv PDF; Feil–Nendel HTML; Dai–Jia–Yu HTML; AAAI 2015 PDF; Polymarket MM docs; StartPolymarket guide; Quant SE AS thread; Kalshi fees help. Parallel WebSearch covered AS descendants, PM MM, toxicity, complements, Kalshi fees. Some practitioner “inventory pathology” pages failed to load content (moltbook). Elite Trader / Reddit high-signal threads were thin vs academic+docs for this query — deprioritized.

