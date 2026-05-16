#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/infra/deploy/deploy.sh"
RELOAD_SCRIPT="$ROOT_DIR/scripts/reload-web-dev.sh"
COMPOSE_FILE="$ROOT_DIR/infra/deploy/.compose-local-dev.yml"
ENV_FILE="$ROOT_DIR/infra/deploy/.env.local-dev"
PROJECT_NAME="${ARCHE_LOCAL_DEV_PROJECT:-arche}"

COMPOSE_ARGS=(-f "$COMPOSE_FILE" --env-file "$ENV_FILE" -p "$PROJECT_NAME")

if ! command -v podman >/dev/null 2>&1; then
  echo "ERROR: podman not found in PATH." >&2
  exit 1
fi

show_help() {
  cat <<'EOF'

Local dev controls:
  r  reload only the Next.js dev server
  l  show recent web logs
  q  quit this launcher, keep the stack running
  Q  stop the local-dev stack and quit
  h  show this help
EOF
}

stop_stack() {
  if [[ ! -f "$COMPOSE_FILE" || ! -f "$ENV_FILE" ]]; then
    echo "ERROR: local-dev compose files are missing; cannot stop stack from launcher." >&2
    echo "Expected: $COMPOSE_FILE" >&2
    echo "Expected: $ENV_FILE" >&2
    exit 1
  fi

  echo "Stopping local-dev stack..."
  podman compose "${COMPOSE_ARGS[@]}" down
  echo "Local-dev stack stopped."
}

leave_launcher() {
  echo
  echo "Leaving launcher. Local-dev stack is still running."
  exit 0
}

trap leave_launcher INT TERM

"$DEPLOY_SCRIPT" --local-dev

if [[ ! -t 0 ]]; then
  echo "Local-dev stack is running. Interactive controls require a TTY."
  exit 0
fi

show_help

while true; do
  printf '\nlocal-dev> '
  IFS= read -rsn1 key || leave_launcher
  printf '%s\n' "$key"

  case "$key" in
    r|R)
      "$RELOAD_SCRIPT"
      ;;
    l|L)
      podman compose "${COMPOSE_ARGS[@]}" logs --tail 120 web
      ;;
    q)
      leave_launcher
      ;;
    Q)
      stop_stack
      exit 0
      ;;
    h|H|\?)
      show_help
      ;;
    $'\n'|$'\r')
      ;;
    *)
      echo "Unknown key: $key"
      show_help
      ;;
  esac
done
