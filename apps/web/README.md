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

## Test Coverage

This app has three practical test layers today:

- Unit tests: mostly `src/**/*.test.ts(x)` outside `src/app/api`
- Integration tests: `tests/*.test.ts` and `src/app/api/**/*.test.ts`
- Browser E2E: `e2e/*.spec.ts` with `Playwright`

There is also a smaller backend E2E layer in `src/**/*.e2e.test.ts`. Those tests depend on extra runtime services such as a database or container socket, so they are not included in the default coverage badge flow.

Coverage commands:

```bash
pnpm coverage
pnpm coverage:unit
pnpm coverage:integration
pnpm coverage:refresh
```

What each command does:

- `pnpm coverage`: overall `Vitest` line coverage for the web app
- `pnpm coverage:unit`: line coverage produced by the unit-test layer, excluding API routes and Next.js runtime entrypoints so it focuses on reusable logic, components, and hooks
- `pnpm coverage:integration`: API route line coverage produced by the integration-test layer
- `pnpm coverage:refresh`: regenerates all three coverage reports and updates the SVG badges in `.github/badges/`

The SVG badges are refreshed automatically on every `push` to `main` by `.github/workflows/coverage-badges.yml`.

Current README badges are generated from:

- `coverage/all/coverage-summary.json`
- `coverage/unit/coverage-summary.json`
- `coverage/integration/coverage-summary.json`

`Playwright` E2E remains execution-based for now. There is no E2E coverage badge yet because the suite is not instrumented to emit a trustworthy source-level coverage percentage. We can add browser-side instrumentation later, but for a Next.js app it is not a low-friction or fully reliable source of whole-app coverage on its own.

## Connector OAuth security notes

- Custom connector OAuth state includes encrypted metadata needed for callback completion.
- When a custom connector uses static client credentials, the encrypted state can include `clientSecret`.
- The OAuth `state` travels in the authorization URL query string, so avoid logging full callback or authorization URLs in reverse proxies and access logs.
- Custom connector endpoints are SSRF-validated (HTTPS only, DNS/IP checks), but a DNS rebinding window still exists between validation and outbound fetch.
- Keep outbound egress controls in place (network policy, firewall, allowlists) for defense in depth.

## Linear app actor mode

- Linear connectors support standard user OAuth and app actor OAuth.
- App actor mode adds `actor=app` to the Linear authorization URL, so actions appear in Linear as the OAuth application instead of as the user who completed consent.
- The visible author name and icon come from the Linear OAuth application configuration.
- In app actor mode, you paste the Linear app `client_id` and `client_secret` directly into the connector modal. User OAuth keeps using dynamic client registration.
- Arche does not currently set Linear's optional `createAsUser` or `displayIconUrl` fields, so app actor changes appear as the OAuth application itself.

## Umami connector

- Supported authentication:
  - Umami Cloud via `https://api.umami.is/v1` plus `x-umami-api-key`
  - Self-hosted Umami via a public HTTPS base URL plus username/password login
- Required access: the configured Umami user must be able to read the target websites.
- Supported reads: website listing, summary stats, pageview series, ranked metrics, recent sessions, recent events, and realtime activity.
- Limits:
  - The connector is read-only.
  - Umami Cloud API keys are limited to 50 requests every 15 seconds.
  - Self-hosted base URLs are validated as public HTTPS endpoints before Arche connects.

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
| `ARCHE_IDLE_TIMEOUT_MINUTES` | Idle time before stop | `120` |
| `KB_CONTENT_HOST_PATH` | Path to KB content bare repo | `~/.arche/kb-content` |
| `KB_CONFIG_HOST_PATH` | Path to config bare repo | `~/.arche/kb-config` |

### Build workspace image

`arche-workspace:latest` extends OpenCode with git and initialization scripts:

```bash
podman build --build-arg OPENCODE_VERSION="$(cat versions/opencode.version)" -t arche-workspace:latest infra/workspace-image
```

For published GHCR images, the default tags remain amd64. To run the arm64 variant, set `OPENCODE_IMAGE=ghcr.io/peaberry-studio/arche/workspace:latest-arm64`.

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
