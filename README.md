# Arche

Specialized AI agent platform with isolated workspaces, a shared knowledge base, and container orchestration.

Arche lets teams deploy AI agents that understand company identity, tone, products, and internal processes. Each user gets a dedicated containerized workspace (OpenCode), access to a shared Knowledge Base (Obsidian vault), and a configurable agent catalog (support, copywriting, SEO, marketing, requirements, and more).

## High-Level Architecture

```
arche/
├── apps/web/          # Next.js 16 (React 19) - UI + BFF + Spawner
│   └── kickstart/     # Agent catalog + KB/config template definitions
├── infra/
│   ├── compose/       # Local stack (Podman Compose)
│   ├── deploy/        # VPS deployer (Ansible + Bash)
│   └── workspace-image/  # Workspace Docker image (OpenCode + git)
└── scripts/           # Bare repo initialization scripts (kb-content/kb-config)
```

### Data Flow

```
┌──────────────────────────────────────────────────────────┐
│                     Podman Compose                        │
├──────────────────────────────────────────────────────────┤
│  Traefik :80/:443                                        │
│     │                                                    │
│     ▼                                                    │
│  Web (Next.js) ──▶ docker-socket-proxy ──▶ Podman API   │
│     │                                                    │
│     ▼                                                    │
│  PostgreSQL 16                                           │
│                                                          │
│  ┌─────────────── arche-internal ──────────────────┐     │
│  │  opencode-alice :4096   opencode-bob :4096  ... │     │
│  │       ▲                       ▲                 │     │
│  │       └── kb-content (rw) ────┘                 │     │
│  │       └── kb-config  (ro) ────┘                 │     │
│  └─────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|------|-----------|
| Framework | Next.js 16.1 + React 19 + TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (Radix) |
| Database | PostgreSQL 16 + Prisma 7 |
| Auth | HTTP-only sessions + Argon2 + TOTP 2FA |
| Encryption | AES-256-GCM (connectors, instance passwords) |
| Containers | Podman + Traefik v3 + docker-socket-proxy |
| Workspaces | OpenCode AI SDK (`@opencode-ai/sdk`) |
| Package manager | pnpm 10 |
| Tests | Vitest 3 |
| Lint | ESLint 9 |
| CI/CD | GitHub Actions (build + push to GHCR) |
| Deploy | Ansible + Bash (VPS) / Podman Compose (local) |

## Data Model (Prisma)

| Model | Description |
|--------|-------------|
| `User` | Accounts (email, slug, role, Argon2 hash, TOTP fields) |
| `Session` | Sessions with token hash, expiration, IP, and user agent |
| `Instance` | Containerized workspace (status, containerId, encrypted password, configSha) |
| `Connector` | External integrations (Linear, Notion, Slack, GitHub) with encrypted config |
| `AuditEvent` | Action log (actor, action, metadata) |
| `TwoFactorRecovery` | One-time 2FA recovery codes |

## Agents

The system includes a catalog of specialized AI agents defined in `apps/web/kickstart/agents/`.
Each workspace applies a subset during kickstart and generates
`CommonWorkspaceConfig.json` in the config bare repo:

| Agent | Mode | Function |
|--------|------|---------|
| **assistant** | primary | General orchestrator, delegates to specialists |
| **support** | subagent | Incident diagnosis and product support |
| **requirements** | subagent | PRD and product spec writing |
| **knowledge-curator** | subagent | KB maintenance and normalization |
| **copywriter** | subagent | Brand voice and tone copy |
| **ads-scripts** | subagent | Ad scripts (UGC/performance) |
| **performance-marketing** | subagent | Meta Ads / ASA analysis |
| **seo** | subagent | SEO strategy and content |

## Knowledge Base

KB starter content is defined in `apps/web/kickstart/templates/definitions/*.json`.
Kickstart generates the initial tree and writes it to the `kb-content` bare repo.

Runtime behavior:

- `kb-content` (bare repo): workspace knowledge base files
- `kb-config` (bare repo): runtime `CommonWorkspaceConfig.json` + generated `AGENTS.md`
- both repos start empty and are populated by kickstart on first setup

## Local Development

### Prerequisites

- Podman (or Docker) with Compose
- pnpm 10+
- Node.js 24+

### Steps

```bash
# 1. Clone and configure environment variables
cp apps/web/.env.example apps/web/.env

# 2. Build the workspace image
podman build -t arche-workspace:latest infra/workspace-image

# 3. Create network and bare KB/config repos (empty)
podman network create arche-internal
./scripts/deploy-kb.sh ~/.arche/kb-content
./scripts/deploy-config.sh ~/.arche/kb-config

# 4. Start the full stack
podman compose -f infra/compose/compose.yaml up -d --build

# 5. Migrations and seed
podman compose -f infra/compose/compose.yaml exec web pnpm prisma migrate dev --name init
podman compose -f infra/compose/compose.yaml exec web pnpm db:seed

# 6. Open the app
# http://arche.lvh.me:8080
# Login: admin@example.com / change-me
# Then run kickstart from /u/<slug>
```

### Development with Hot Reload

```bash
cd infra/deploy
cp .env.example .env
./deploy.sh --local-dev
```

### Available Scripts (`apps/web`)

| Script | Command |
|--------|---------|
| Dev server | `pnpm dev` |
| Build | `pnpm build` |
| Lint | `pnpm lint` |
| Tests | `pnpm test` |
| Tests (watch) | `pnpm test:watch` |
| Generate Prisma client | `pnpm prisma:generate` |
| Migrations | `pnpm db:migrate` |
| Seed | `pnpm db:seed` |

## Deployment

Two modes are available through `infra/deploy/deploy.sh`:

| Mode | Command | TLS | Usage |
|------|---------|-----|-----|
| Local dev | `./deploy.sh --local-dev` | No | Hot-reload development |
| Remote (VPS) | `./deploy.sh --ip <IP> --domain <DOMAIN> --ssh-key <KEY> --acme-email <EMAIL> [--skip-ensure-dns-record]` | Yes (ACME) | Production |

Remote deployment uses Ansible to provision Podman, ACME HTTP challenge for TLS, and managed secrets.

## Key Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ARCHE_DOMAIN` | Main domain (e.g. `arche.lvh.me`) |
| `ARCHE_SESSION_PEPPER` | Pepper for session hashing |
| `ARCHE_ENCRYPTION_KEY` | AES-256-GCM key (base64, 32 bytes) |
| `CONTAINER_PROXY_HOST` | docker-socket-proxy host |
| `OPENCODE_IMAGE` | Workspace image |
| `OPENCODE_NETWORK` | Internal container network |
| `KB_CONTENT_HOST_PATH` | Path to KB content bare repo |
| `KB_CONFIG_HOST_PATH` | Path to config bare repo |

See `apps/web/.env.example` for the complete reference.

## Source Code Structure (`apps/web/`)

```
src/
├── app/                    # App Router (pages + API routes)
│   ├── api/
│   │   ├── u/[slug]/       # User APIs (agents, connectors)
│   │   ├── w/[slug]/       # Workspace APIs (chat streaming)
│   │   └── instances/[slug]/ # Instance control
│   ├── auth/               # Auth flows (login, logout, 2FA)
│   ├── u/[slug]/           # User dashboard
│   └── w/[slug]/           # Workspace UI
├── components/
│   ├── ui/                 # shadcn/ui primitives
│   ├── workspace/          # Workspace components
│   └── agents/             # Agent components
├── lib/
│   ├── spawner/            # Container lifecycle
│   ├── workspace-agent/    # Workspace agent HTTP client
│   ├── connectors/         # Connector types and encryption
│   └── auth.ts             # Auth utilities
├── actions/                # Server Actions (Next.js)
├── hooks/                  # Custom hooks (useWorkspace, etc.)
├── types/                  # Shared type definitions
└── contexts/               # React Contexts

kickstart/
├── agents/                 # Shared agent catalog
├── templates/              # startup-tech, marketing-studio, research-group, blank
└── *.ts                    # Contracts, state, apply and rendering
```

## Additional Documentation

- [`apps/web/README.md`](apps/web/README.md) - Detailed local setup, auth, spawner
- [`infra/README.md`](infra/README.md) - Infrastructure and KB architecture
- [`infra/compose/README.md`](infra/compose/README.md) - Podman Compose stack
- [`infra/deploy/README.md`](infra/deploy/README.md) - VPS deployment guide
- [`infra/workspace-image/README.md`](infra/workspace-image/README.md) - Workspace image

## License

This project is licensed under the Apache License 2.0. See [`LICENSE`](LICENSE).
