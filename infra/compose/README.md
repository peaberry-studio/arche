# Infra (Compose)

Este módulo levanta el stack local completo para Arche usando Podman Compose.

Incluye (v0):

- Traefik (edge) con routing por host.
- Postgres.
- `apps/web` (Next.js: UI + BFF).

## Requisitos

- Podman + podman-compose.

## Dominios locales (recomendado)

Para probar subdominios sin tocar DNS, usa `lvh.me` (resuelve a `127.0.0.1`).

- Base: `arche.lvh.me`
- Usuario: `admin.arche.lvh.me`

## Arranque (local)

1) **Crear la red interna** (una sola vez):

```bash
podman network create arche-internal
```

2) **Build de la imagen de workspace** (una sola vez o cuando cambie):

```bash
podman build -t arche-workspace:latest ../workspace-image
```

3) **Preparar el KB** (Knowledge Base):

```bash
# Crear directorio y deploy del KB
mkdir -p /opt/arche/kb
../../scripts/deploy-kb.sh /opt/arche/kb
```

4) **Variables de entorno de `apps/web`**

Copia `apps/web/.env.example` a `apps/web/.env`.

Recomendado para local:

- `ARCHE_DOMAIN="arche.lvh.me"`

5) **Levantar el stack** (modo único de desarrollo local)

Desde la raíz del repo:

```bash
podman compose -f infra/compose/compose.yaml up -d --build
```

6) **Migraciones + seed**

```bash
podman compose -f infra/compose/compose.yaml exec web pnpm prisma migrate dev --name init
podman compose -f infra/compose/compose.yaml exec web pnpm db:seed
```

7) **Verificación rápida**

- Home: http://arche.lvh.me:8080

Login (dev):

```bash
curl -i \
  -X POST "http://arche.lvh.me:8080/auth/login" \
  -H "content-type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me"}'
```

Nota: ya no se usa `forwardAuth` ni subdominios por usuario.

## Operación

- Logs Traefik:

```bash
podman compose -f infra/compose/compose.yaml logs -f traefik
```

- Logs Web:

```bash
podman compose -f infra/compose/compose.yaml logs -f web
```

- Parar (sin borrar datos):

```bash
podman compose -f infra/compose/compose.yaml down
```

- Reset total (borra volúmenes):

```bash
podman compose -f infra/compose/compose.yaml down -v
```
