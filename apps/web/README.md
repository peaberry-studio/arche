# Arche Web (Next.js)

This app always runs inside the full stack (Traefik + Postgres + Web) using `infra/compose/compose.yaml`.

## Step by Step (Local)

### 1) Environment Variables

Copy `apps/web/.env.example` to `apps/web/.env`.

Recommended for local:

- `ARCHE_DOMAIN="arche.lvh.me"`

### 2) Start the full stack

From the repo root:

```bash
podman compose -f infra/compose/compose.yaml up -d --build
```

### 3) Migrations + seed (Prisma)

```bash
podman compose -f infra/compose/compose.yaml exec web pnpm prisma migrate dev --name init
podman compose -f infra/compose/compose.yaml exec web pnpm db:seed
```

### 4) Open the app

- `http://arche.lvh.me:8080`

### 5) Verify database

```bash
podman compose -f infra/compose/compose.yaml exec postgres psql -U postgres -d arche -c "\\dt"
```

### 6) Stop / reset

- Stop (without deleting data):

```bash
podman compose -f infra/compose/compose.yaml down
```

- Full reset (deletes volumes):

```bash
podman compose -f infra/compose/compose.yaml down -v
```

## Re-generate the app (command)

```bash
npx create-next-app@latest "apps/web" --ts --eslint --app --import-alias "@/*" --use-pnpm --disable-git --yes
```

## Auth + sessions (BFF)

Endpoints:

- `POST /auth/login`
- `POST /auth/logout`
- Note: `forwardAuth` and per-user subdomains are no longer used.

Login (capture `Set-Cookie`):

```bash
curl -i \
  -X POST "http://arche.lvh.me:8080/auth/login" \
  -H "content-type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me"}'
```

Logout:

```bash
curl -i \
  -X POST "http://arche.lvh.me:8080/auth/logout" \
  --cookie "arche_session=<paste_cookie_value_here>"
```

## Package manager

This repo uses `pnpm` by default.

## UI

The UI uses Tailwind + shadcn/ui. Components live in `src/components/ui`.

Notes:

- `tailwindcss-animate` is installed for compatibility with shadcn components.

## Spawner (Workspaces)

The spawner is the module that creates and manages containers for each user workspace.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Podman Compose                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────┐    ┌──────────────────┐    ┌──────────────────┐   │
│  │ Traefik │───▶│ docker-socket-   │◀───│      web         │   │
│  │  :80    │    │     proxy        │    │ (Next.js)        │   │
│  └─────────┘    │     :2375        │    └──────────────────┘   │
│       │         └────────┬─────────┘              │            │
│       │                  │                        │            │
│       │                  ▼                        │            │
│       │         /run/podman/podman.sock            │            │
│       │                  │                        │            │
│       ▼                  ▼                        ▼            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    arche-internal network                 │  │
│  │  ┌────────────────┐  ┌────────────────┐                  │  │
│  │  │ opencode-admin │  │ opencode-user2 │  ...             │  │
│  │  │    :4096       │  │    :4096       │                  │  │
│  │  └────────────────┘  └────────────────┘                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Configuration

The spawner can connect to the container runtime in two ways:

1. **Via HTTP proxy** (recommended for Podman Compose):
   ```env
   CONTAINER_SOCKET_PATH=""
   CONTAINER_PROXY_HOST="docker-socket-proxy"
   CONTAINER_PROXY_PORT="2375"
   ```

2. **Via local socket** (for development without Podman Compose):
   ```env
   CONTAINER_SOCKET_PATH="/run/podman/podman.sock"
   ```

**IMPORTANT**: If `CONTAINER_SOCKET_PATH` is defined, it takes precedence over the proxy. Leave it empty when using Podman Compose.

### Spawner environment variables

| Variable | Description | Development value |
|----------|-------------|------------------|
| `CONTAINER_SOCKET_PATH` | Runtime socket (empty = use proxy) | `""` |
| `CONTAINER_PROXY_HOST` | Proxy host | `docker-socket-proxy` |
| `CONTAINER_PROXY_PORT` | Proxy port | `2375` |
| `OPENCODE_IMAGE` | Workspace image | `arche-workspace:latest` |
| `OPENCODE_NETWORK` | Internal container network | `arche-internal` |
| `ARCHE_ENCRYPTION_KEY` | AES-256 key (base64, 32 bytes) | See `.env.example` |
| `ARCHE_START_TIMEOUT_MS` | Startup timeout | `120000` |
| `ARCHE_IDLE_TIMEOUT_MINUTES` | Idle time before stop | `30` |
| `KB_CONTENT_HOST_PATH` | Path to KB content bare repo | `~/.arche/kb-content` |
| `KB_CONFIG_HOST_PATH` | Path to config bare repo | `~/.arche/kb-config` |

### Build workspace image

`arche-workspace:latest` extends OpenCode with git and initialization scripts:

```bash
podman build -t arche-workspace:latest infra/workspace-image
```

### Troubleshooting

**Error: `Invalid key length`**
- `ARCHE_ENCRYPTION_KEY` must be exactly 32 bytes encoded in base64
- Generate one: `openssl rand -base64 32`

**Error: `connect ENOENT /var/run/docker.sock`**
- You are on Podman Compose but `CONTAINER_SOCKET_PATH` is defined
- Fix: set `CONTAINER_SOCKET_PATH=""` in `.env`

**Error: `start_failed` with no details**
- Check logs: `podman logs arche-web-1`
- Verify image exists: `podman images | grep arche-workspace`
- Verify network exists: `podman network ls | grep arche-internal`
