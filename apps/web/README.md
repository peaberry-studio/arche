# Arche Web (Next.js)

Esta app se levanta siempre dentro del stack completo (Traefik + Postgres + Web) usando `infra/compose/compose.yaml`.

## Paso a paso (local)

### 1) Variables de entorno

Copia `apps/web/.env.example` a `apps/web/.env`.

Recomendado en local:

- `ARCHE_DOMAIN="arche.lvh.me"`

### 2) Levantar el stack completo

Desde la raíz del repo:

```bash
docker compose -f infra/compose/compose.yaml up -d --build
```

Si tu Docker no soporta `docker compose`, usa `docker-compose`.

### 3) Migraciones + seed (Prisma)

```bash
docker compose -f infra/compose/compose.yaml exec web pnpm prisma migrate dev --name init
docker compose -f infra/compose/compose.yaml exec web pnpm db:seed
```

### 4) Abrir la app

- `http://arche.lvh.me`

### 5) Verificar la base de datos

```bash
docker compose -f infra/compose/compose.yaml exec postgres psql -U postgres -d arche -c "\\dt"
```

### 6) Parar / resetear

- Parar (sin borrar datos):

```bash
docker compose -f infra/compose/compose.yaml down
```

- Reset total (borra volúmenes):

```bash
docker compose -f infra/compose/compose.yaml down -v
```

## Regenerar la app (comando)

```bash
npx create-next-app@latest "apps/web" --ts --eslint --app --import-alias "@/*" --use-pnpm --disable-git --yes
```

## Auth + sesiones (BFF)

Endpoints:

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/traefik` (para Traefik `forwardAuth`)

Login (captura el `Set-Cookie`):

```bash
curl -i \
  -X POST "http://arche.lvh.me/auth/login" \
  -H "content-type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me"}'
```

Traefik auth (simula el host usuario):

```bash
curl -i \
  "http://arche.lvh.me/auth/traefik" \
  -H "X-Forwarded-Host: admin.arche.lvh.me" \
  --cookie "arche_session=<pega_aqui_el_valor_del_cookie>"
```

Logout:

```bash
curl -i \
  -X POST "http://arche.lvh.me/auth/logout" \
  --cookie "arche_session=<pega_aqui_el_valor_del_cookie>"
```

## Package manager

En este repo usamos `pnpm` por defecto.

## UI

La UI usa Tailwind + shadcn/ui. Los componentes viven en `src/components/ui`.

Notas:

- `tailwindcss-animate` esta instalado para compatibilidad con componentes shadcn.

## Spawner (Workspaces Docker)

El spawner es el módulo que crea y gestiona contenedores Docker para cada workspace de usuario.

### Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Compose                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────┐    ┌──────────────────┐    ┌──────────────────┐   │
│  │ Traefik │───▶│ docker-socket-   │◀───│      web         │   │
│  │  :80    │    │     proxy        │    │ (Next.js)        │   │
│  └─────────┘    │     :2375        │    └──────────────────┘   │
│       │         └────────┬─────────┘              │            │
│       │                  │                        │            │
│       │                  ▼                        │            │
│       │         /var/run/docker.sock              │            │
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

### Configuración

El spawner puede conectarse a Docker de dos formas:

1. **Via proxy HTTP** (recomendado para Docker Compose):
   ```env
   DOCKER_SOCKET_PATH=""
   DOCKER_PROXY_HOST="docker-socket-proxy"
   DOCKER_PROXY_PORT="2375"
   ```

2. **Via socket local** (para desarrollo sin Docker Compose):
   ```env
   DOCKER_SOCKET_PATH="/var/run/docker.sock"
   ```

**IMPORTANTE**: Si defines `DOCKER_SOCKET_PATH`, tiene prioridad sobre el proxy. Déjalo vacío cuando uses Docker Compose.

### Variables de entorno del spawner

| Variable | Descripción | Valor desarrollo |
|----------|-------------|------------------|
| `DOCKER_SOCKET_PATH` | Socket de Docker (vacío = usar proxy) | `""` |
| `DOCKER_PROXY_HOST` | Host del proxy | `docker-socket-proxy` |
| `DOCKER_PROXY_PORT` | Puerto del proxy | `2375` |
| `OPENCODE_IMAGE` | Imagen de workspace | `arche-workspace:latest` |
| `OPENCODE_NETWORK` | Red Docker interna | `arche-internal` |
| `ARCHE_ENCRYPTION_KEY` | Clave AES-256 (base64, 32 bytes) | Ver `.env.example` |
| `ARCHE_START_TIMEOUT_MS` | Timeout de arranque | `120000` |
| `ARCHE_IDLE_TIMEOUT_MINUTES` | Inactividad antes de parar | `30` |
| `KB_HOST_PATH` | Path al Knowledge Base | `~/.arche/kb` |

### Construir la imagen de workspace

La imagen `arche-workspace:latest` extiende OpenCode con git y scripts de inicialización:

```bash
docker build -t arche-workspace:latest infra/workspace-image
```

### Troubleshooting

**Error: `Invalid key length`**
- `ARCHE_ENCRYPTION_KEY` debe ser exactamente 32 bytes codificados en base64
- Generar una válida: `openssl rand -base64 32`

**Error: `connect ENOENT /var/run/docker.sock`**
- Estás en Docker Compose pero `DOCKER_SOCKET_PATH` está definido
- Solución: dejar `DOCKER_SOCKET_PATH=""` en el `.env`

**Error: `start_failed` sin más detalles**
- Revisar logs: `docker logs arche-web-1`
- Verificar que la imagen existe: `docker images | grep arche-workspace`
- Verificar que la red existe: `docker network ls | grep arche-internal`
