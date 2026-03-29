#!/bin/sh
set -e

# Wait for the database to accept connections before running migrations.
# prisma migrate deploy can hang indefinitely if postgres is unreachable,
# so we fail fast here with a clear message instead.
echo "[arche] Waiting for database to be ready..."
RETRIES=15
until node -e "
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
  const { Client } = require('pg');
  const c = new Client({ connectionString: url });
  c.connect().then(() => c.end()).catch(e => { console.error(e.message); process.exit(1); });
" 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "[arche] ERROR: database not reachable after 30s — aborting" >&2
    exit 1
  fi
  sleep 2
done
echo "[arche] Database is ready"

echo "[arche] Running database migrations..."
timeout 60 pnpm prisma migrate deploy 2>&1

echo "[arche] Running database seed..."
pnpm prisma db seed 2>&1 || echo "[arche] Seed skipped (may already be seeded)"

echo "[arche] Starting application (version: ${ARCHE_GIT_SHA:-dev})..."
exec pnpm run start
