#!/bin/sh
set -eu

RESTART_FLAG="/tmp/arche-next-dev-restart"
PID_FILE="/tmp/arche-next-dev.pid"
PNPM_STORE_DIR="${PNPM_STORE_DIR:-/pnpm/store}"
next_pid=""

stop_next() {
  if [ -n "$next_pid" ] && kill -0 "$next_pid" 2>/dev/null; then
    kill -TERM "$next_pid" 2>/dev/null || true
    wait "$next_pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE" "$RESTART_FLAG"
}

trap 'stop_next; exit 0' INT TERM HUP

if command -v apt-get >/dev/null 2>&1 && ! command -v git >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends git
  rm -rf /var/lib/apt/lists/*
fi

if command -v corepack >/dev/null 2>&1; then
  corepack enable
fi

if [ -d "$PNPM_STORE_DIR" ]; then
  pnpm config set store-dir "$PNPM_STORE_DIR" >/dev/null 2>&1 || true
fi

pnpm install --frozen-lockfile --prefer-offline
pnpm prisma generate
pnpm prisma:generate:desktop

while :; do
  rm -f "$RESTART_FLAG"

  pnpm next dev --turbopack -H 0.0.0.0 -p 3000 &
  next_pid="$!"
  printf '%s\n' "$next_pid" > "$PID_FILE"

  set +e
  wait "$next_pid"
  status="$?"
  set -e

  rm -f "$PID_FILE"
  next_pid=""

  if [ -f "$RESTART_FLAG" ]; then
    rm -f "$RESTART_FLAG"
    continue
  fi

  exit "$status"
done
