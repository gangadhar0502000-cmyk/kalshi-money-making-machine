# Headless 24/7 Paper MM (Grok Bot box)

**PAPER ONLY — never places live Kalshi orders.** The Mac can stay closed; this box runs continuously.

Public spot is **real-only** (Binance.us preferred, then Coinbase). No demo spot walk — if both venues fail, spot polling fails closed and FV stays parked.

## What runs

| Process | Role |
|---------|------|
| `scripts/mm-proxy.mjs` | Read-only Kalshi proxy on `:8787` (credentials from `.env.local`) |
| `scripts/paper-mm-headless.mts` | Node paper MM loop (multi-book, strict realism, FV quoting, S1–S5.1) |
| `scripts/paper-mm-24x7.sh` | Supervisor: starts both, restarts on crash |

## Start / stop

```bash
cd /workspace/kalshi-money-making-machine   # or your clone path
npm run mm:24x7                            # foreground supervisor
# or background:
nohup npm run mm:24x7 >> data/paper-mm/logs/supervisor.log 2>&1 &
```

Stop: `kill $(cat data/paper-mm/paper-mm-24x7.pid)` (sends SIGTERM to children).

One-shot without supervisor (proxy must already be up, or set `SPAWN_PROXY=1`):

```bash
npm run mm:headless
```

## Data layout (`data/paper-mm/`)

| Path | Purpose |
|------|---------|
| `journal.jsonl` | Append-only fill / blocked-close / S5.1 eviction log |
| `digests/YYYY-MM-DD-HH.json` | Hourly per-scenario digest |
| `digest-latest.json` | Most recent digest snapshot |
| `session-storage.json` | File-backed portfolio persist (restart recovery) |
| `runner-health.json` | Runner heartbeat |
| `logs/*.log` | Proxy + headless + supervisor logs |
| `*.pid` | Supervisor / child PIDs |

`data/paper-mm/` is gitignored. Never commit `.env.local`.

## Verify it’s running

```bash
curl -sS http://127.0.0.1:8787/local-api/health
tail -n 30 data/paper-mm/journal.jsonl
tail -n 50 data/paper-mm/logs/paper-mm-headless.log
cat data/paper-mm/runner-health.json
ls data/paper-mm/digests | tail
```

## npm scripts

- `mm:proxy` — proxy only
- `mm:headless` — headless runner
- `mm:24x7` — supervised 24/7 loop

## Measurement (journal + digests)

Paper-only telemetry — does **not** change trading knobs (`openMinEdge`, `markBleed`, `stuckUnwindTicks` threshold, S4.2 floors).

| Field | Where | Purpose |
|-------|-------|---------|
| `fill.scenarioId` | `MmFill` + journal `fill` | Stamped from `evaluateClose` / open quote decision **at fill time**. Post-flat requote often shows S5; do not re-tag lossy flattens from the post-fill quote. |
| `blocked_close.stuckTicks` | journal | Current stuck counter (consecutive S3 profit-bar blocks). Use to see if S3 flicker resets stuck before S4.1/S4.2. |
| `blocked_close.captureGapCents` | journal | `minCloseProfitCents − captureCents` (¢ short of the S3 bar). |
| Digest `openFills` / `closeFills` | `digest-*.json` | Split vs blended `avgCentsPerFill`. |
| Digest `avgCentsPerRoundTrip` | `digest-*.json` | `totalCaptureCents / closeFills` (¢ per completed close / RT). Blended `avgCentsPerFill` kept for backward compatibility. |

See also `src/lib/crypto15m/mm/RULES.md` measurement notes.

