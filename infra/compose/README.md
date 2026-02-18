# Infra (Compose)

This module starts the full local Arche stack using Podman Compose.

Includes (v0):

- Traefik (edge) with host-based routing.
- Postgres.
- `apps/web` (Next.js: UI + BFF).

## Requirements

- Podman + podman-compose.

## Local domains (recommended)

To test subdomains without touching DNS, use `lvh.me` (resolves to `127.0.0.1`).

- Base: `arche.lvh.me`
- User: `admin.arche.lvh.me`

## Startup (local)

1) **Create internal network** (one-time):

```bash
podman network create arche-internal
```

2) **Build workspace image** (one-time or when changed):

```bash
podman build -t arche-workspace:latest ../workspace-image
```

3) **Prepare empty bare repos for KB/config**:

```bash
# Initialize empty bare repos (kickstart fills content later)
mkdir -p /opt/arche
../../scripts/deploy-kb.sh /opt/arche/kb-content
../../scripts/deploy-config.sh /opt/arche/kb-config
```

`/opt/arche/kb-content` and `/opt/arche/kb-config` are bare Git repos (no working tree).
Once the app is up, complete kickstart at `/u/<slug>/kickstart` to generate
initial KB content and `CommonWorkspaceConfig.json`.

4) **`apps/web` environment variables**

Copy `apps/web/.env.example` to `apps/web/.env`.

Recommended for local:

- `ARCHE_DOMAIN="arche.lvh.me"`

5) **Start the stack** (single local dev mode)

From repo root:

```bash
podman compose -f infra/compose/compose.yaml up -d --build
```

6) **Migrations + seed**

```bash
podman compose -f infra/compose/compose.yaml exec web pnpm prisma migrate dev --name init
podman compose -f infra/compose/compose.yaml exec web pnpm db:seed
```

7) **Quick verification**

- Home: http://arche.lvh.me:8080

Login (dev):

```bash
curl -i \
  -X POST "http://arche.lvh.me:8080/auth/login" \
  -H "content-type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me"}'
```

Note: `forwardAuth` and per-user subdomains are no longer used.

## Operation

- Traefik logs:

```bash
podman compose -f infra/compose/compose.yaml logs -f traefik
```

- Web logs:

```bash
podman compose -f infra/compose/compose.yaml logs -f web
```

- Stop (without deleting data):

```bash
podman compose -f infra/compose/compose.yaml down
```

- Full reset (deletes volumes):

```bash
podman compose -f infra/compose/compose.yaml down -v
```
