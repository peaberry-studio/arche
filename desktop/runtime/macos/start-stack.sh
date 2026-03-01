#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${1:-}"

if [[ -z "$RUNTIME_ROOT" ]]; then
  echo "usage: start-stack.sh <runtime-root>" >&2
  exit 1
fi

if ! command -v podman >/dev/null 2>&1; then
  echo "podman is required for this POC runtime" >&2
  exit 1
fi

if ! podman compose version >/dev/null 2>&1; then
  echo "podman compose is required for this POC runtime" >&2
  exit 1
fi

source "$RUNTIME_ROOT/macos/env.sh" "$RUNTIME_ROOT"

emit_progress() {
  printf 'ARCHE_PROGRESS|%s|%s\n' "$1" "$2"
}

DATA_DIR="${ARCHE_DESKTOP_DATA_DIR:-$HOME/Library/Application Support/ArcheDesktop/data}"
emit_progress "prepare" "Preparing local runtime directories"
mkdir -p "$DATA_DIR" "$DATA_DIR/users"

"$RUNTIME_ROOT/scripts/init-bare-repo.sh" "$DATA_DIR/kb-content"
"$RUNTIME_ROOT/scripts/init-bare-repo.sh" "$DATA_DIR/kb-config"

if ! podman network inspect arche-internal >/dev/null 2>&1; then
  podman network create arche-internal >/dev/null
fi

SECRETS_FILE="$DATA_DIR/.desktop-secrets"
if [[ ! -f "$SECRETS_FILE" ]]; then
  cat > "$SECRETS_FILE" <<EOF
ARCHE_SESSION_PEPPER=$(openssl rand -base64 32)
ARCHE_ENCRYPTION_KEY=$(openssl rand -base64 32)
ARCHE_CONNECTOR_OAUTH_STATE_SECRET=$(openssl rand -base64 32)
ARCHE_GATEWAY_TOKEN_SECRET=$(openssl rand -base64 32)
EOF
  chmod 600 "$SECRETS_FILE"
fi

set -a
source "$SECRETS_FILE"
set +a

export PODMAN_SOCKET_PATH
export ARCHE_DESKTOP_DATA_DIR="$DATA_DIR"

COMPOSE_FILE="$RUNTIME_ROOT/compose.desktop.yml"

if ! podman image exists arche-web:desktop; then
  echo "missing image arche-web:desktop, run desktop/scripts/build-desktop-images.sh" >&2
  exit 1
fi

if ! podman image exists arche-workspace:desktop; then
  echo "missing image arche-workspace:desktop, run desktop/scripts/build-desktop-images.sh" >&2
  exit 1
fi

emit_progress "services" "Starting desktop services on host podman"
podman compose -f "$COMPOSE_FILE" -p arche-desktop up -d

emit_progress "migrate" "Applying database migrations"
podman compose -f "$COMPOSE_FILE" -p arche-desktop exec -T web pnpm prisma migrate deploy
podman compose -f "$COMPOSE_FILE" -p arche-desktop exec -T web pnpm prisma db seed || true

emit_progress "health" "Waiting for Arche healthcheck"
for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:4510/api/health" >/dev/null 2>&1; then
    emit_progress "ready" "Arche runtime is ready"
    echo '{"ok":true,"url":"http://127.0.0.1:4510"}'
    exit 0
  fi
  sleep 2
done

echo "web healthcheck failed" >&2
exit 1
