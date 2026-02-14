# Arche

Plataforma de agentes IA especializados con workspaces aislados, base de conocimiento compartida y orquestación de contenedores.

Arche permite a equipos desplegar agentes IA que conocen la identidad, el tono, los productos y los procesos de la empresa. Cada usuario obtiene un workspace con contenedores dedicados (OpenCode), acceso a una Knowledge Base (Obsidian vault) y un catálogo de agentes configurables (soporte, copywriting, SEO, marketing, requisitos, etc.).

## Arquitectura general

```
arche/
├── apps/web/          # Next.js 16 (React 19) - UI + BFF + Spawner
├── config/            # Definiciones de agentes y configuración compartida
├── kb/                # Knowledge Base (Obsidian vault)
├── infra/
│   ├── compose/       # Stack local (Podman Compose)
│   ├── deploy/        # Deployer VPS (Ansible + Bash)
│   └── workspace-image/  # Imagen Docker del workspace (OpenCode + git)
└── scripts/           # Scripts de despliegue de KB y config
```

### Flujo de datos

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

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16.1 + React 19 + TypeScript 5 |
| Estilos | Tailwind CSS 4 + shadcn/ui (Radix) |
| Base de datos | PostgreSQL 16 + Prisma 7 |
| Auth | Sesiones HTTP-only + Argon2 + TOTP 2FA |
| Cifrado | AES-256-GCM (conectores, passwords de instancia) |
| Contenedores | Podman + Traefik v3 + docker-socket-proxy |
| Workspaces | OpenCode AI SDK (@opencode-ai/sdk) |
| Package manager | pnpm 10 |
| Tests | Vitest 3 |
| Lint | ESLint 9 |
| CI/CD | GitHub Actions (build + push a GHCR) |
| Deploy | Ansible + Bash (VPS) / Podman Compose (local) |

## Modelo de datos (Prisma)

| Modelo | Descripcion |
|--------|-------------|
| `User` | Cuentas (email, slug, role, Argon2 hash, campos TOTP) |
| `Session` | Sesiones con token hash, expiracion, IP y user agent |
| `Instance` | Workspace contenedorizado (status, containerId, password cifrado, configSha) |
| `Connector` | Integraciones externas (Linear, Notion, Slack, GitHub) con config cifrada |
| `AuditEvent` | Log de acciones (actor, action, metadata) |
| `TwoFactorRecovery` | Codigos de recuperacion 2FA (uso unico) |

## Agentes

El sistema incluye un catalogo de agentes IA especializados definido en `apps/web/kickstart/agents/`.
Cada workspace aplica un subconjunto durante el flujo inicial de kickstart y genera
`CommonWorkspaceConfig.json` en el repo bare de configuracion:

| Agente | Modo | Funcion |
|--------|------|---------|
| **assistant** | primary | Orquestador general, delega a especializados |
| **support** | subagent | Diagnostico de incidencias y soporte de producto |
| **requirements** | subagent | Redaccion de PRDs y especificaciones |
| **knowledge-curator** | subagent | Mantenimiento y normalizacion del KB |
| **copywriter** | subagent | Copy con voz y tono de marca |
| **ads-scripts** | subagent | Guiones para anuncios (UGC/performance) |
| **performance-marketing** | subagent | Analisis Meta Ads / ASA |
| **seo** | subagent | Estrategia SEO y contenido |

## Knowledge Base

El KB es un vault de Obsidian montado en cada workspace:

```
kb/
├── Company/
│   ├── 01 - Identidad de marca.md
│   ├── 02 - Voz y tono.md
│   ├── 03 - Glosario.md
│   ├── 05 - Canales y contacto.md
│   ├── People/           # Fichas del equipo
│   └── Product/
│       ├── 00 - Overview.md
│       ├── 01 - Soporte - Indice KB.md
│       └── docs/         # Help center
└── Templates/            # Plantillas operativas (PRD, KB entry, marketing)
```

Se despliega como repositorios bare de Git (`kb-content` y `kb-config`) que los
contenedores montan y sincronizan. En una instalacion nueva, ambos repos se
inicializan vacios y se completan al ejecutar kickstart.

## Desarrollo local

### Requisitos previos

- Podman (o Docker) con Compose
- pnpm 10+
- Node.js 24+

### Pasos

```bash
# 1. Clonar y configurar variables de entorno
cp apps/web/.env.example apps/web/.env

# 2. Construir la imagen de workspace
podman build -t arche-workspace:latest infra/workspace-image

# 3. Crear red y repos bare de KB/config (vacios)
podman network create arche-internal
./scripts/deploy-kb.sh ~/.arche/kb-content
./scripts/deploy-config.sh ~/.arche/kb-config

# 4. Levantar el stack completo
podman compose -f infra/compose/compose.yaml up -d --build

# 5. Migraciones y seed
podman compose -f infra/compose/compose.yaml exec web pnpm prisma migrate dev --name init
podman compose -f infra/compose/compose.yaml exec web pnpm db:seed

# 6. Abrir la app
# http://arche.lvh.me:8080
# Login: admin@example.com / change-me
# Luego ejecutar kickstart desde /u/<slug>
```

### Desarrollo con hot-reload

```bash
cd infra/deploy
cp .env.example .env
./deploy.sh --local-dev
```

### Scripts disponibles (`apps/web`)

| Script | Comando |
|--------|---------|
| Dev server | `pnpm dev` |
| Build | `pnpm build` |
| Lint | `pnpm lint` |
| Tests | `pnpm test` |
| Tests (watch) | `pnpm test:watch` |
| Generar Prisma | `pnpm prisma:generate` |
| Migraciones | `pnpm db:migrate` |
| Seed | `pnpm db:seed` |

## Despliegue

Tres modos disponibles via `infra/deploy/deploy.sh`:

| Modo | Comando | TLS | Uso |
|------|---------|-----|-----|
| Local dev | `./deploy.sh --local-dev` | No | Desarrollo con hot-reload |
| Local prod | `./deploy.sh --local` | No | Testing de imagen en local |
| Remoto (VPS) | `./deploy.sh` | Si (ACME) | Produccion |

El despliegue remoto usa Ansible para provisionar Podman, TLS via ACME DNS challenge, y gestion de secretos.

## Variables de entorno clave

| Variable | Descripcion |
|----------|-------------|
| `DATABASE_URL` | Connection string de PostgreSQL |
| `ARCHE_DOMAIN` | Dominio principal (ej: `arche.lvh.me`) |
| `ARCHE_SESSION_PEPPER` | Pepper para hashing de sesiones |
| `ARCHE_ENCRYPTION_KEY` | Clave AES-256-GCM (base64, 32 bytes) |
| `CONTAINER_PROXY_HOST` | Host del docker-socket-proxy |
| `OPENCODE_IMAGE` | Imagen del workspace |
| `OPENCODE_NETWORK` | Red interna de contenedores |
| `KB_CONTENT_HOST_PATH` | Path al repo bare de contenido KB |
| `KB_CONFIG_HOST_PATH` | Path al repo bare de configuracion |

Ver `apps/web/.env.example` para la referencia completa.

## Estructura del codigo fuente (`apps/web/`)

```
src/
├── app/                    # App Router (paginas + API routes)
│   ├── api/
│   │   ├── u/[slug]/       # APIs de usuario (agentes, conectores)
│   │   ├── w/[slug]/       # APIs de workspace (chat streaming)
│   │   └── instances/[slug]/ # Control de instancias
│   ├── auth/               # Flujos de auth (login, logout, 2FA)
│   ├── u/[slug]/           # Dashboard de usuario
│   └── w/[slug]/           # UI del workspace
├── components/
│   ├── ui/                 # Primitivos shadcn/ui
│   ├── workspace/          # Componentes del workspace
│   └── agents/             # Componentes de agentes
├── lib/
│   ├── spawner/            # Lifecycle de contenedores
│   ├── workspace-agent/    # Cliente HTTP del workspace agent
│   ├── connectors/         # Tipos y cifrado de conectores
│   └── auth.ts             # Utilidades de autenticacion
├── actions/                # Server Actions (Next.js)
├── hooks/                  # Custom hooks (useWorkspace, etc.)
├── types/                  # Definiciones de tipos compartidas
└── contexts/               # React Contexts

kickstart/
├── agents/                 # Catalogo compartido de agentes
├── templates/              # startup-tech, marketing-studio, research-group, blank
└── *.ts                    # Contratos, estado, apply y renderizado
```

## Documentacion adicional

- [`apps/web/README.md`](apps/web/README.md) - Setup local detallado, auth, spawner
- [`config/README.md`](config/README.md) - Configuracion de agentes
- [`infra/README.md`](infra/README.md) - Arquitectura de infraestructura y KB
- [`infra/compose/README.md`](infra/compose/README.md) - Stack de Podman Compose
- [`infra/deploy/README.md`](infra/deploy/README.md) - Guia de despliegue VPS
- [`infra/workspace-image/README.md`](infra/workspace-image/README.md) - Imagen del workspace
