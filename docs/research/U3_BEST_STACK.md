# U3 Best Quote Stack — Research Brief (paper only)

> **Superseded for product** — user chose **house rules / mid-centered maker (U3.2)**, not mismatch/complete-set stack as the shipping target. This brief is retained for research reference only.


**Date:** 2026-09-23 (America/Chicago).  
**Status:** Recommendation only — quoting paused (U3.0 / headless stopped). No S1–S5.

## Bottom line

**Primary edge = complete-set complementary two-bid** (\(b_Y+b_N < 1\) after fees), not external digital \(N(d_2)\). Inventory/unpaired control = Guéant hard \(Q\) + skew around **book mid**. Keep τ flatten + settlement blackout. Add toxicity pull. Do **not** reopen FV-centered directional opens until FV uses **CF Benchmarks RTI** (Kalshi settle), not Binance/Coinbase.

## Why Family E lost money

1. **Settlement basis.** Kalshi crypto settles on a 60s average of CF Benchmarks RTI, not single-exchange spot. Family E FV used free Binance US/Coinbase → systematic FV ≫ mid fake edge (10–20¢).
2. **15m digital math** amplifies bps of \(S/K\) into dimes of \(N(d_2)\). Ranking by `|FV−mid|` selected the worst books.
3. **Adverse selection** (Glosten–Milgrom): quoting off a high external FV while CLOB mid embeds better settle-relevant info = free option to informed flow.
4. Horacle / Feil–Nendel: BS-on-spot is the wrong center for PM MM; center on probability mid / market belief \(p_t\).

U3.1.1 / U3.1.2 patched extremes and blackout flatten only.

## Ranked alternatives

| Rank | Approach | Verdict |
|------|----------|---------|
| #1 | Hybrid: complete-set + inventory/τ + toxicity | Best evidence-backed stack |
| #2 | Complete-set alone (Family C) | Strongest primary edge; incomplete without unpaired unwind |
| #3 | Feil–Nendel / Guéant HJB (Family B) | Best risk control; not ready without \(\Lambda\) calibration |
| #4 | Toxicity-only (Family D) | Defense only |
| #5 | Digital-FV directional (Family E) | Empirically broken until CF-RTI + markout proof |

Bürgi–Deng–Whelan is best Kalshi economics paper but **drops hourly crypto resets** — do not treat FL bias as 15m crypto primary edge.

## Layers

1. **Complete-set** — Polymarket MM docs; StartPolymarket 2026; Horacle CTF.
2. **Inventory** — Guéant 2013; Feil–Nendel 2026; AS 2008. Center on book mid.
3. **τ / settlement** — Dai–Jia–Yu 2026; Kalshi CF 60s settle.
4. **Toxicity** — Glosten–Milgrom 1985; keep U3.1.1 extreme-mid refuse.

## Phased ship (no S1–S5)

| Slice | Goal |
|-------|------|
| **U3.2** | Stop FV directional opens; mid/book-centered quotes; stop rank-by-`|FV−mid|`; markout telemetry |
| **U3.3** | Complete-set YES+NO complementary bids + fee haircut |
| **U3.4** | Unpaired inventory max + timeout flatten + hard \(Q\) |
| **U3.5** | τ/blackout aligned to CF final-minute window |
| **U3.6** | Toxicity v2 (markout / aggressor) |
| **U3.7+** | HJB-lite or CF-RTI FV only after intensity + markout evidence |

## Not ready / open risks

- No venue-calibrated \(\Lambda(t,p,\pi)\) on Kalshi 15m crypto.
- Complete-set fill rate unknown (one-sided books?).
- Maker fees by series must haircut edge.
- 15m Kalshi settlement-push vs Polymarket evidence gap.
- Whether CF-RTI digital FV ever beats mid+complete-set on markout — open.

## Key citations

- Feil–Nendel (2026): https://arxiv.org/abs/2607.17991
- Dai–Jia–Yu (2026): https://arxiv.org/abs/2606.31675
- Bürgi–Deng–Whelan (2025): https://www.ucd.ie/economics/t4media/WP2025_19.pdf
- Guéant et al. (2013): https://arxiv.org/pdf/1105.3115.pdf
- Avellaneda–Stoikov (2008): https://people.orie.cornell.edu/sfs33/LimitOrderBook.pdf
- Horacle LAS WP (2026): https://horaclecapital.com/assets/pdf/polymarket_paper.pdf
- Polymarket MM: https://docs.polymarket.com/trading/market-making
- StartPolymarket MM: https://startpolymarket.com/strategies/market-making/
- Kalshi crypto settlement: https://help.kalshi.com/en/articles/13823838-crypto-markets
