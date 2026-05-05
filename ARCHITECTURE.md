# Architecture

Technical reference for developers and contributors working on Arche.

## High-Level Architecture

```
arche/
├── apps/web/          # Next.js 16 (React 19) - UI + BFF + Spawner
│   └── kickstart/     # Agent catalog + KB/config template definitions
├── apps/desktop/      # Electron desktop app (local single-user mode)
├── infra/
│   ├── compose/       # Local stack (Podman Compose)
│   ├── deploy/        # VPS deployer (Ansible + Bash)
│   ├── coolify/       # Coolify deployment configuration
│   └── workspace-image/  # Workspace container image (OpenCode + git)
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
| `Connector` | Per-user connector records with encrypted config. Supported connector types are defined in `apps/web/src/lib/connectors/types.ts`: Linear, Notion, Zendesk, Ahrefs, Umami, custom MCP, Meta Ads, and Google Workspace products (Gmail, Drive, Calendar, Chat, People) |
| `ProviderCredential` | Per-user model provider credentials for providers such as OpenAI, Anthropic, Fireworks, OpenRouter, and OpenCode |
| `ExternalIntegration` | Admin-managed integrations stored once for the deployment, such as Slack |
| `SlackThreadBinding` | Mapping between Slack channel threads and OpenCode sessions |
| `SlackEventReceipt` | Slack event deduplication receipts |
| `AutopilotTask` | Scheduled autopilot task definition, target agent, schedule, and lease state |
| `AutopilotRun` | Autopilot execution history, status, trigger, session binding, and seen state |
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

## Desktop Vault Model

Desktop keeps the existing single-user, single-workspace runtime model per process.
Multi-vault support is implemented by launching one Electron process per vault.

At launch:

- if a last opened valid vault exists, Desktop opens `/w/local` directly
- if no vault is selected, Desktop opens a launcher UI
- switching vaults opens another Electron process instead of hot-swapping the current one

Each desktop vault is a visible folder. Its internal runtime files are dot-prefixed,
so they are hidden on macOS and Linux by default:

```text
<VaultName>/
  .arche-vault.json
  .arche.db
  workspace/
  .kb-config/
  .kb-content/
  .users/
    local/
  .runtime/
    opencode/
  .secrets/
    encryption.key
```

Notes:

- `.arche-vault.json` is the explicit vault manifest used for validation and stable `vaultId`
- `.arche.db` is the per-vault desktop SQLite database
- `workspace/` is the local git workspace used by runtime tools
- `.runtime/opencode/` stores OpenCode runtime state for that vault
- `.kb-config/` and `.kb-content/` are local bare Git repos

Breaking desktop storage change:

- Desktop no longer reads or auto-detects legacy hidden folders such as `~/.arche` and `~/.arche-opencode`
- no automatic migration is performed for the previous hidden-folder layout

## Key Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ARCHE_DOMAIN` | Main domain (e.g. `arche.lvh.me`) |
| `ARCHE_PUBLIC_BASE_URL` | Public base URL used for OAuth callbacks behind proxies |
| `ARCHE_SESSION_PEPPER` | Pepper for session hashing |
| `ARCHE_SESSION_TTL_DAYS` | Configurable session lifetime in days |
| `ARCHE_ENCRYPTION_KEY` | AES-256-GCM key (base64, 32 bytes) |
| `ARCHE_INTERNAL_TOKEN` | Internal token required by deploy/runtime internal calls |
| `ARCHE_GATEWAY_TOKEN_SECRET` | Secret used to sign provider gateway tokens |
| `ARCHE_GATEWAY_TOKEN_TTL_SECONDS` | Optional provider gateway token TTL |
| `ARCHE_GATEWAY_BASE_URL` | Optional provider gateway base URL override |
| `ARCHE_CONNECTOR_OAUTH_STATE_SECRET` | Secret used to protect connector OAuth state (required in production for OAuth flows) |
| `ARCHE_CONNECTOR_GATEWAY_BASE_URL` | Internal MCP connector gateway base URL override |
| `ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET` | Optional dedicated secret for connector gateway tokens. Falls back to `ARCHE_GATEWAY_TOKEN_SECRET` |
| `CONTAINER_PROXY_HOST` | docker-socket-proxy host |
| `OPENCODE_IMAGE` | Workspace image |
| `OPENCODE_NETWORK` | Internal container network |
| `ARCHE_USERS_PATH` | Host path for persisted per-user runtime data |
| `KB_CONTENT_HOST_PATH` | Path to KB content bare repo |
| `KB_CONFIG_HOST_PATH` | Path to config bare repo |
| `ARCHE_SEED_ADMIN_EMAIL` | Initial admin seed email |
| `ARCHE_SEED_ADMIN_PASSWORD` | Initial admin seed password |
| `ARCHE_SEED_ADMIN_SLUG` | Initial admin seed slug |

See `apps/web/.env.example` for the complete app reference and connector-specific overrides.

## Session History Note

- Arche must consume workspace session history through OpenCode's public API, not by reading `opencode.db` directly and not by using container `exec` from the web app.
- The current OpenCode `/session` API supports `roots`, `limit`, `search`, and `start`.
- `start` is a lower-bound filter (`updatedAt >= start`), so it is useful for incremental refreshes but it does not support backwards pagination for older history.
- Until OpenCode exposes a real backwards cursor or a dedicated family/history endpoint, the workspace UI uses root sessions plus a progressively increasing `limit` (500, 1000, 1500, ...) and reconstructs the active family via `session.get` + `session.children`.

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
