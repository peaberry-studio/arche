#!/bin/sh
set -e

echo "[arche] Running database migrations..."
pnpm prisma migrate deploy

echo "[arche] Running database seed..."
pnpm prisma db seed || echo "[arche] Seed skipped (may already be seeded)"

echo "[arche] Starting application (version: ${ARCHE_GIT_SHA:-dev})..."
exec pnpm run start
