#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_COMPOSE_FILE="$ROOT_DIR/infra/deploy/.compose-local-dev.yml"
DEPLOY_ENV_FILE="$ROOT_DIR/infra/deploy/.env.local-dev"
ROOT_COMPOSE_FILE="$ROOT_DIR/infra/compose/compose.yaml"
PROJECT_NAME="${ARCHE_LOCAL_DEV_PROJECT:-arche}"

if ! command -v podman >/dev/null 2>&1; then
  echo "ERROR: podman not found in PATH." >&2
  exit 1
fi

if [[ -f "$DEPLOY_COMPOSE_FILE" && -f "$DEPLOY_ENV_FILE" ]]; then
  if ! grep -q 'scripts/dev-server.sh' "$DEPLOY_COMPOSE_FILE"; then
    echo "ERROR: generated local-dev compose is stale: $DEPLOY_COMPOSE_FILE" >&2
    echo "Run 'cd infra/deploy && ./deploy.sh --local-dev' once to regenerate it." >&2
    exit 1
  fi

  COMPOSE_ARGS=(-f "$DEPLOY_COMPOSE_FILE" --env-file "$DEPLOY_ENV_FILE" -p "$PROJECT_NAME")
else
  COMPOSE_ARGS=(-f "$ROOT_COMPOSE_FILE")
fi

RESTART_NEXT='if [ -s /tmp/arche-next-dev.pid ] && kill -0 "$(cat /tmp/arche-next-dev.pid)" 2>/dev/null; then touch /tmp/arche-next-dev-restart && kill -TERM "$(cat /tmp/arche-next-dev.pid)"; else exit 42; fi'

if podman compose "${COMPOSE_ARGS[@]}" exec -T web sh -lc "$RESTART_NEXT"; then
  echo "Triggered Next.js dev server reload inside the web container."
  exit 0
fi

echo "Next.js dev server PID not found; recreating only the web service." >&2
podman compose "${COMPOSE_ARGS[@]}" up -d --no-deps --force-recreate web
