#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/compose/compose.yaml"
ENV_FILE="$ROOT_DIR/apps/web/.env"
ENV_EXAMPLE="$ROOT_DIR/apps/web/.env.example"
WORKSPACE_IMAGE_DIR="$ROOT_DIR/infra/workspace-image"
KB_SOURCE="$ROOT_DIR/kb"
KB_DEST="${KB_HOST_PATH:-$HOME/.arche/kb}"

if [ ! -f "$COMPOSE_FILE" ]; then
  printf "Missing compose file: %s\n" "$COMPOSE_FILE"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$ENV_EXAMPLE" ]; then
    printf "Missing env example: %s\n" "$ENV_EXAMPLE"
    exit 1
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  printf "Created %s from example. Review ARCHE_DOMAIN if needed.\n" "$ENV_FILE"
fi

if podman compose version >/dev/null 2>&1; then
  COMPOSE="podman compose"
else
  printf "podman-compose not found. Install Podman and podman-compose.\n"
  exit 1
fi

# Build workspace image (OpenCode + git + init scripts)
printf "Building workspace image: arche-workspace:latest\n"
podman build -t arche-workspace:latest "$WORKSPACE_IMAGE_DIR"

# Deploy Knowledge Base
printf "Deploying Knowledge Base to: %s\n" "$KB_DEST"
"$ROOT_DIR/scripts/deploy-kb.sh" "$KB_DEST"

# Export KB_HOST_PATH for compose (used in compose.yaml)
export KB_HOST_PATH="$KB_DEST"

$COMPOSE -f "$COMPOSE_FILE" up -d --build

# Wait for web service to be ready (pnpm install + prisma generate)
printf "Waiting for web service to be ready (this may take a minute)...\n"
until $COMPOSE -f "$COMPOSE_FILE" exec web pnpm prisma --version >/dev/null 2>&1; do
  sleep 5
  printf "."
done
printf " ready!\n"

$COMPOSE -f "$COMPOSE_FILE" exec web pnpm prisma migrate deploy
$COMPOSE -f "$COMPOSE_FILE" exec web pnpm db:seed

printf "\nDone. Open http://arche.lvh.me\n"
printf "Login: admin@example.com / change-me\n"
