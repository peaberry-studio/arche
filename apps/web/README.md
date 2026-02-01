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
