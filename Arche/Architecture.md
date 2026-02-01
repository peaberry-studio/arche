# Arquitectura de Arche

## Objetivo

Arche es un sistema multiusuario que levanta instancias aisladas de OpenCode bajo demanda en un VPS, con:

- Autenticación y control de acceso autocontenidos.
- UI web propia (client-first) para operar la experiencia de usuario
- Knowledge Base persistida como Git local en el VPS en estructura de fichero markdown.
- Metadatos (usuarios/instancias/config) en una DB local en contenedor
- Integración con OpenCode en modo headless (`opencode serve`) a traves de su OpenAPI

Decisiones clave (v1):

- La autenticación es gestionada por Arche (BFF), no por un IdP externo.
- Las sesiones se gestionan con cookies httpOnly y sesiones persistidas en DB (no JWT stateless).
- 2FA se implementa con TOTP (apps tipo Google Authenticator) + recovery codes.
- OpenCode no se expone a Internet; el navegador habla solo con Arche.

## Estado actual (repositorio)

- Auth + sesiones + `forwardAuth` (BFF): hecho (issue #2, PR #5).
- Spawner + runtime OpenCode (Docker): hecho (issue #3, PR #10).
- Infra/edge (Traefik + routing subdominios + `forwardAuth`): en progreso (issue #4).
- Workspace web (visor + chat + sesiones múltiples): en progreso (issue #9).
- 2FA (TOTP): en progreso (issue #7, PR #11).

Ver también:

- [[Arche/KB - Contratos de dominios, cookies y routing|Contratos de dominios, cookies y routing (v0)]]

## Requisitos

### Requisitos externos (minimos)

- Un VPS Linux (Ubuntu 22.04+ recomendado) con Docker
- Un dominio con:
  - `ARCHE_DOMAIN` (p.ej. `arche.example.com`) apuntando al VPS
  - wildcard `*.ARCHE_DOMAIN` (p.ej. `*.arche.example.com`) apuntando al VPS

### Requisitos funcionales

- Login local (usuarios + roles) y sesiones seguras
- 2FA opcional por usuario (TOTP) y obligatorio por politica para admins
- Aislamiento por usuario:
  - Cada usuario tiene su propio contenedor OpenCode
  - Cada usuario solo puede acceder a su subdominio `<slug>.<ARCHE_DOMAIN>`
- Provisionamiento on-demand (start/stop) y lifecycle (idle/TTL)
- La KB se clona a un workspace por usuario al iniciar una instancia
- Auditoria basica: login/logout, start/stop, errores del runtime

### Requisitos no funcionales

- “One VPS, self-contained”: sin dependencias SaaS obligatorias
- Seguridad por defecto:
  - TLS obligatorio en el edge
  - OpenCode no expuesto directamente a Internet
  - Principio de minimo privilegio para acceso a Docker
- Backups recuperables (DB + Git KB + datos de usuarios)

## Autenticacion y acceso (v1)

### Enfoque

- Autenticacion autocontenida dentro del BFF de Arche (Next.js).
- Autorizacion por host en el edge mediante `forwardAuth` hacia Arche.
- Sesiones con cookie `httpOnly` + registro de sesion en Postgres.

Razon:

- Evita dependencias externas.
- Permite owner isolation estricto por `<slug>.<domain>`.
- Evita exponer OpenCode al navegador.

### Metodos

- Password: hash `argon2id`.
- 2FA: TOTP (RFC 6238) compatible con Google Authenticator, 1Password, Authy, etc.
- Recovery codes: conjunto de codigos de un solo uso almacenados como hashes.

### Sesiones (recomendacion)

- Cookie: `Secure`, `HttpOnly`, `SameSite=Lax`.
- Sesion en DB con TTL (revocable, rotacion, audit).
- Politicas:
  - rate limit por IP y por cuenta
  - backoff/lockout progresivo ante intentos fallidos
  - auditoria de eventos de seguridad

### Flujos

Login (2 pasos si hay 2FA):

1) `email + password`
2) si `totp_enabled`: pedir `totp_code` o `recovery_code`
3) crear sesion (DB) + set cookie

Enrolment de 2FA:

1) generar `totp_secret` (pendiente)
2) mostrar QR (`otpauth://...`)
3) verificar primer codigo TOTP
4) activar 2FA y emitir recovery codes (mostrar una sola vez)

Owner isolation (edge):

- Traefik llama a `GET /auth/traefik`.
- Arche valida sesion desde cookie, lee `X-Forwarded-Host`, extrae slug.
- Responde `200` si el usuario coincide; `401/403` en caso contrario.

### Modelo de datos (minimo)

- `users`: email, slug, role, password_hash, totp_enabled
- `user_totp`: user_id, secret_encrypted, verified_at, last_used_step (opcional)
- `recovery_codes`: user_id, code_hash, used_at
- `sessions`: id, user_id, created_at, expires_at, revoked_at, last_seen_at, ip, user_agent
- `audit_events`: actor_user_id, action, metadata, created_at

## Componentes (v1)

```
Internet
  │
  ▼
┌───────────────────────────┐
│ Reverse Proxy (Traefik)   │  TLS (ACME), routing, rate limits
│ + forwardAuth             │  authZ por host/subdominio
└───────────────┬───────────┘
                │
      ┌─────────┴──────────────────────────────────────────┐
      │                                                    │
      ▼                                                    ▼
arche.<domain>                                      <slug>.<domain>
┌───────────────────────────┐                      ┌───────────────────┐
│ Arche Web (Next.js)       │                      │ Arche Web (Next.js)│
│ - UI (operaciones + user) │                      │ - UI user          │
│ - BFF/API (server actions │◄──────────────┐       │ - SSE/streaming UI │
│   o routes)               │               │       └───────────────────┘
└───────────────┬───────────┘               │
                │                           │
                ▼                           │
        ┌───────────────┐                   │
        │ Postgres       │                   │
        │ + Prisma       │                   │
        └───────────────┘                   │
                                            │
                                            ▼
                                     ┌───────────────┐
                                     │ OpenCode serve │  (1 por usuario)
                                     │ opencode-<slug>│  OpenAPI + SSE
                                     └───────────────┘

Persistencia host:
  /var/lib/arche/kb/vault.git   (repo bare)
  /var/lib/arche/users/<slug>/  (workspace + datos opencode)
```

### Reverse Proxy (Traefik)

- Termina TLS con Lets Encrypt (ACME)
- Enruta por Host:
  - `arche.<domain>` -> Arche Web
  - `<slug>.<domain>` -> Arche Web (misma app, distinta superficie)
- Aplica `forwardAuth` hacia el backend de Arche para autorizar por sesion y validar owner isolation

### Arche Web (Next.js)

Una unica aplicacion que incluye:

- UI (admin y usuario)
- Backend-for-Frontend (BFF): API interna para:
  - autenticar (password + 2FA)
  - operar instancias
  - proxyear llamadas hacia OpenCode (OpenAPI + SSE)

### Orquestador de instancias (Spawner)

Responsable de:

- Crear/parar `opencode-<slug>`
- Montar el workspace del usuario y config dirs
- Gestionar lifecycle (idle reaper, TTL)

Implementacion:

- El BFF llama al API de Docker via `docker-socket-proxy` (no acceso directo a `/var/run/docker.sock`)
- Los contenedores OpenCode solo son accesibles en la red Docker interna

### OpenCode runtime (headless)

- Cada usuario corre `opencode serve` en su contenedor
- Se protege en red interna con basic auth por instancia:
  - `OPENCODE_SERVER_USERNAME` (default `opencode`)
  - `OPENCODE_SERVER_PASSWORD` (generado por instancia)

Integracion:

- Arche consume el OpenAPI expuesto por OpenCode (`/doc`) y opera mediante HTTP + SSE (`/event`)
- Opcional: usar `@opencode-ai/sdk` en el backend para tipado/ergonomia

### Datos

- Postgres (container) para: usuarios, roles, instancias, configuracion, audit events
- Prisma para: schema, migraciones, seeds
- Git bare para KB:
  - `vault.git` como source of truth
  - clones por usuario en `users/<slug>/vault` (idealmente con `--shared/--local` cuando aplique)

## Seguridad (modelo)

- TLS obligatorio en el edge
- Autenticacion local con sesiones (cookie httpOnly) + sesiones en DB
- 2FA (TOTP) disponible para usuarios y exigible por politica para admins
- Autorizacion por host:
  - `forwardAuth` valida sesion
  - extrae slug del Host
  - permite solo si `current_user.slug == slug`
- Defensa en profundidad:
  - OpenCode no expuesto a Internet
  - Basic auth para `opencode serve` en red interna
  - docker-socket-proxy con permisos minimos

## Herramientas

- UI/BFF: Next.js + TypeScript
- DB: Postgres
- ORM/migraciones: Prisma
- Reverse proxy: Traefik
- Runtime: Docker
- Docker security: `tecnativa/docker-socket-proxy`
- OpenCode: imagen base oficial + `opencode serve`
- Git: repo bare + clones por usuario

Notas de implementacion:

- Password hashing: libreria Argon2 (argon2id).
- TOTP: libreria compatible RFC 6238.
- Encriptacion de secretos TOTP: usar un secreto de aplicacion (KMS opcional; en MVP, envelope con key en el host).

## Plan de implementacion (orden recomendado)

1) Skeleton del repositorio (solo arquitectura + decisiones)
   - Estandarizar variables `ARCHE_*` y rutas `/var/lib/arche/*`

2) Core BFF (Next.js)
   - Login local + sesiones (DB)
   - RBAC minimo (admin/user)
   - 2FA: enrolment, login step-up, recovery codes

3) Data layer (Postgres + Prisma)
   - Modelos: users, instances, audit_events, kb
   - Migraciones + seed (primer admin)

4) Spawner (Docker)
   - API para start/stop/status
   - docker-socket-proxy
   - lifecycle (idle/TTL)

5) Git KB workflow
   - Inicializar repo bare
   - Estrategia de clon por usuario
   - Politica de sync/merge (definir conflicto/resolucion)

6) Integracion OpenCode headless
   - Levantar `opencode serve` por usuario
   - Proxy BFF para OpenAPI + SSE
   - UI: sesiones, streaming, acciones basicas

7) Hardening y operabilidad
   - Rate limits
   - Logs/auditoria
   - Estrategia de backups (requisito, no script en esta fase)

## Distribucion de ownership (equipo 3)

- Infra: Traefik/TLS, Docker hardening, networking, backups (definicion)
- Generalista: BFF backend, Prisma/Postgres, spawner, Git KB
- Web/UI: UI Next.js (user experience + operaciones), streaming y estados

Ver también:

- [[Arche/Tasks/00 - Indice|Tasks]]
