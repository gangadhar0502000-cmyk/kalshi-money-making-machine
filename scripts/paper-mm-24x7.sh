#!/usr/bin/env bash
# Supervise mm-proxy + headless paper MM 24/7 on the Grok Bot box.
# PAPER ONLY — never places live Kalshi orders. Mac can be closed.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${PAPER_MM_DATA_DIR:-$REPO/data/paper-mm}"
LOG_DIR="$DATA/logs"
PID_DIR="$DATA"
PROXY_PORT="${MM_PROXY_PORT:-8787}"
mkdir -p "$LOG_DIR" "$DATA/digests"

PROXY_PID_FILE="$PID_DIR/mm-proxy.pid"
RUNNER_PID_FILE="$PID_DIR/paper-mm-headless.pid"
SUPERVISOR_PID_FILE="$PID_DIR/paper-mm-24x7.pid"

echo $$ > "$SUPERVISOR_PID_FILE"

ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }

is_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

start_proxy() {
  if [[ -f "$PROXY_PID_FILE" ]]; then
    local old
    old="$(cat "$PROXY_PID_FILE" 2>/dev/null || true)"
    if is_alive "$old"; then
      echo "[$(ts)] mm-proxy already running pid=$old"
      return 0
    fi
  fi
  # Also detect listener on port
  if curl -fsS "http://127.0.0.1:${PROXY_PORT}/local-api/health" >/dev/null 2>&1; then
    echo "[$(ts)] mm-proxy health OK (external) — not spawning"
    return 0
  fi
  echo "[$(ts)] starting mm-proxy on ${PROXY_PORT}"
  (
    cd "$REPO"
    exec /usr/bin/env MM_PROXY_PORT="$PROXY_PORT" node scripts/mm-proxy.mjs
  ) >>"$LOG_DIR/mm-proxy.log" 2>&1 &
  echo $! > "$PROXY_PID_FILE"
  echo "[$(ts)] mm-proxy pid=$(cat "$PROXY_PID_FILE")"
}

start_runner() {
  if [[ -f "$RUNNER_PID_FILE" ]]; then
    local old
    old="$(cat "$RUNNER_PID_FILE" 2>/dev/null || true)"
    if is_alive "$old"; then
      echo "[$(ts)] headless runner already running pid=$old"
      return 0
    fi
  fi
  echo "[$(ts)] starting paper-mm-headless (SPAWN_PROXY=0)"
  (
    cd "$REPO"
    exec /usr/bin/env \
      SPAWN_PROXY=0 \
      MM_PROXY_PORT="$PROXY_PORT" \
      MM_PROXY_URL="http://127.0.0.1:${PROXY_PORT}" \
      PAPER_MM_DATA_DIR="$DATA" \
      ./node_modules/.bin/vite-node scripts/paper-mm-headless.mts
  ) >>"$LOG_DIR/paper-mm-headless.log" 2>&1 &
  echo $! > "$RUNNER_PID_FILE"
  echo "[$(ts)] headless pid=$(cat "$RUNNER_PID_FILE")"
}

stop_children() {
  echo "[$(ts)] supervisor shutting down"
  for f in "$RUNNER_PID_FILE" "$PROXY_PID_FILE"; do
    if [[ -f "$f" ]]; then
      pid="$(cat "$f" 2>/dev/null || true)"
      if is_alive "$pid"; then
        kill -TERM "$pid" 2>/dev/null || true
      fi
      rm -f "$f"
    fi
  done
  rm -f "$SUPERVISOR_PID_FILE"
  exit 0
}

trap stop_children SIGINT SIGTERM

echo "[$(ts)] paper-mm-24x7 supervisor start repo=$REPO data=$DATA"
echo "[$(ts)] PAPER ONLY — never places live orders"

while true; do
  start_proxy
  # wait briefly for health
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS "http://127.0.0.1:${PROXY_PORT}/local-api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
  start_runner

  # Monitor; restart whichever died
  sleep 5
  if [[ -f "$PROXY_PID_FILE" ]]; then
    ppid="$(cat "$PROXY_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$ppid" ]] && ! is_alive "$ppid"; then
      # Only restart if health also down (might be external proxy)
      if ! curl -fsS "http://127.0.0.1:${PROXY_PORT}/local-api/health" >/dev/null 2>&1; then
        echo "[$(ts)] mm-proxy died — restarting"
        rm -f "$PROXY_PID_FILE"
      fi
    fi
  elif ! curl -fsS "http://127.0.0.1:${PROXY_PORT}/local-api/health" >/dev/null 2>&1; then
    echo "[$(ts)] mm-proxy missing — restarting"
  fi

  if [[ -f "$RUNNER_PID_FILE" ]]; then
    rpid="$(cat "$RUNNER_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$rpid" ]] && ! is_alive "$rpid"; then
      echo "[$(ts)] headless runner died — restarting"
      rm -f "$RUNNER_PID_FILE"
    fi
  else
    echo "[$(ts)] headless runner missing — restarting"
  fi
done
