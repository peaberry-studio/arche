# Auth + sesiones + forwardAuth (BFF)

- Asignado a: [[Company/People/Inaki Tajes|Iñaki Tajes]]
- Estado: Hecha

- Issue: https://github.com/peaberry-studio/arche/issues/2
- PR: https://github.com/peaberry-studio/arche/pull/5

## Objetivo

Implementar autenticación local y sesiones seguras en el BFF, incluyendo el endpoint de autorización por host para Traefik (`forwardAuth`).

## Entregables mínimos

- [x] Modelo de datos (mínimo): `users`, `sessions`, `audit_events` (y placeholders opcionales para 2FA)
- [x] `POST /auth/login` (email+password) -> crea sesión + cookie `httpOnly`
- [x] `POST /auth/logout` -> revoca sesión
- [x] `GET /auth/traefik` -> valida cookie + `X-Forwarded-Host` y aplica owner isolation (`<slug>.<domain>`)
- [x] Seed: crear primer admin (y/o usuario de prueba)

## Implementación (repositorio)

- App (Next.js): `apps/web/`
- DB/ORM (Prisma): `apps/web/prisma/schema.prisma`
- Seed: `apps/web/prisma/seed.ts`
- Endpoints:
  - `POST /auth/login`: `apps/web/src/app/auth/login/route.ts`
  - `POST /auth/logout`: `apps/web/src/app/auth/logout/route.ts`
  - `GET /auth/traefik`: `apps/web/src/app/auth/traefik/route.ts`

## Contrato aplicado (decisiones v0)

- Cookie de sesión:
  - nombre: `arche_session`
  - flags: `HttpOnly`, `SameSite=Lax`, `Secure` en producción
  - domain: `ARCHE_COOKIE_DOMAIN` o (si no está) `.${ARCHE_DOMAIN}`
- Sesiones:
  - token opaco aleatorio en cookie
  - hash en DB: `sha256("<token>.<ARCHE_SESSION_PEPPER>")`
  - TTL: `ARCHE_SESSION_TTL_DAYS` (default `7`)
- `GET /auth/traefik` (owner isolation):
  - host base (`ARCHE_DOMAIN`): permite cualquier sesión válida
  - host usuario (`<slug>.<ARCHE_DOMAIN>`): permite solo si `current_user.slug == <slug>`
  - sin cookie: `401`
  - sesión válida pero host no coincide/no soportado: `403`
  - sin `X-Forwarded-Host`/`Host`: `401`

## Pendiente para “cerrar” en entorno real

- Infra: Traefik debe reenviar `X-Forwarded-Host` al BFF (ver [[Arche/Tasks/Alberto Perdomo - Infra y edge|Infra/edge]]).
- DB: ejecutar migraciones y seed contra Postgres real (requiere `DATABASE_URL`).
- Verificación end-to-end: login -> cookie -> `GET /auth/traefik` con host `<slug>.<ARCHE_DOMAIN>`.

## Contratos a respetar (para no pisarnos)

- `users.slug` es la fuente de verdad para `<slug>.<domain>`
- `GET /auth/traefik` responde `200` si autorizado; `401/403` si no

## Dependencias

- Coordinación con [[Arche/Tasks/Alberto Perdomo - Infra y edge|Infra/edge]] para headers reales (`X-Forwarded-Host`) y wiring de `forwardAuth`
- Coordinación con [[Arche/Tasks/Jose Miguel Hernandez - Spawner y runtime|Spawner]] para el modelo/tabla de `instances` (si se consulta desde UI)
