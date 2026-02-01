# Spawner + runtime OpenCode (Docker)

- Asignado a: [[Company/People/Jose Miguel Hernandez|José Miguel Hernández]]
- Estado: Hecha

- Issue: https://github.com/peaberry-studio/arche/issues/3
- PR: https://github.com/peaberry-studio/arche/pull/10
- Diseño: [[docs/plans/2026-01-31-spawner-design|Plan de diseño]]

## Objetivo

Implementar el "Spawner" para crear/parar instancias `opencode-<slug>` por usuario, con credenciales y networking interno seguro.

## Entregables mínimos

- [x] Interfaz estable: `start(slug)`, `stop(slug)`, `status(slug)` (aunque viva dentro del BFF al inicio)
- [x] Plantilla runtime `opencode-<slug>` ejecutando `opencode serve`
- [x] Generación y persistencia de `OPENCODE_SERVER_PASSWORD` por instancia
- [x] Contenedor accesible solo en red Docker interna (no expuesto a Internet)
- [x] Modelo de datos mínimo: `instances` (estado, timestamps, credenciales/runtime metadata)

## Implementación (repositorio)

- App (Next.js): `apps/web/`
- Spawner lib: `apps/web/src/lib/spawner/`
  - `config.ts` - Getters de configuración
  - `crypto.ts` - AES-256-GCM encrypt/decrypt
  - `docker.ts` - Wrapper dockerode
  - `core.ts` - start, stop, status
  - `reaper.ts` - Idle reaper
- Server Actions: `apps/web/src/actions/spawner.ts`
- UI: `apps/web/src/components/instance-controls.tsx`
- DB/ORM (Prisma): modelo `Instance` en `apps/web/prisma/schema.prisma`

## Contrato aplicado (decisiones v0)

- Docker client: `dockerode` (estándar, escalable para equipos)
- Imagen OpenCode: `ghcr.io/anomalyco/opencode:1.1.45` (oficial)
- Networking:
  - Red Docker interna: `arche-internal`
  - Puerto fijo: `4096`
  - Container naming: `opencode-{slug}`
- Encriptación passwords: AES-256-GCM con `ARCHE_ENCRYPTION_KEY` en env
- API interna: Server Actions (core agnóstico para MCP futuro)
- Idle detection: OCPROXY actualiza `lastActivityAt`, reaper cada 5min
- Tiempos de start:
  - Normal: `< 15s`
  - Warning "tardando más de lo esperado": `15s - 120s`
  - Timeout real (error): `> 120s`
- Idle timeout default: `30 minutos`

## Pendiente para "cerrar" en entorno real

- Infra: Verificar `docker-socket-proxy` y red `arche-internal` con Alberto
- Test end-to-end: start → running → idle → reaped
- Integración OCPROXY: endpoint `PATCH /api/instances/[slug]/activity`

## Contratos a respetar (para no pisarnos)

- Estados de instancia: `starting` / `running` / `stopped` / `error`
- El BFF nunca habla con Docker directo: usa `docker-socket-proxy`

## Dependencias

- Coordinación con [[Arche/Tasks/Alberto Perdomo - Infra y edge|Infra/edge]] para redes Docker, socket proxy y compose
- Coordinación con [[Arche/Tasks/Inaki Tajes - Auth y sesiones|Auth/sesiones]] si el spawner depende del `users.slug` y de la sesión actual
