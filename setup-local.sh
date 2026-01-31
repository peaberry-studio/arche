#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/compose/compose.yaml"
ENV_FILE="$ROOT_DIR/apps/web/.env"
ENV_EXAMPLE="$ROOT_DIR/apps/web/.env.example"

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

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  printf "Docker Compose not found. Install Docker Desktop.\n"
  exit 1
fi

$COMPOSE -f "$COMPOSE_FILE" up -d --build
$COMPOSE -f "$COMPOSE_FILE" exec web pnpm prisma migrate dev --name init
$COMPOSE -f "$COMPOSE_FILE" exec web pnpm db:seed

printf "Done. Open http://arche.lvh.me\n"
