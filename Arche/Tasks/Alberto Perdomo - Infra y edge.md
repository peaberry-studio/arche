# Infra/edge (Traefik + socket proxy + compose)

- Asignado a: [[Company/People/Alberto Perdomo|Alberto Perdomo]]
- Estado: En progreso

- Issue: https://github.com/peaberry-studio/arche/issues/4

## Objetivo

Dejar un setup de infraestructura reproducible para el monorepo: Traefik con routing por host y `forwardAuth`, más `docker-socket-proxy` y servicios base.

## Entregables mínimos

- [x] `docker-compose` base: Traefik + Arche Web + Postgres + `tecnativa/docker-socket-proxy`
- [ ] Routing por host:
  - [ ] `arche.<domain>` -> Arche Web
  - [ ] `<slug>.<domain>` -> Arche Web
- [ ] `forwardAuth` hacia `GET /auth/traefik` (BFF)
- [ ] Red interna Docker para runtimes OpenCode (no expuestos)

## Nota de estado

- En local ya existe `infra/compose/compose.yaml` con Traefik, Postgres y `docker-socket-proxy`.
- Falta completar el routing para subdominios de usuario y el wiring de `forwardAuth`.

## Contratos a respetar (para no pisarnos)

- `forwardAuth` debe reenviar `X-Forwarded-Host` al BFF
- No exponer OpenCode a Internet; solo el BFF puede acceder en red interna

## Dependencias

- Coordinación con [[Arche/Tasks/Inaki Tajes - Auth y sesiones|Auth/sesiones]] para el endpoint `GET /auth/traefik`
- Coordinación con [[Arche/Tasks/Jose Miguel Hernandez - Spawner y runtime|Spawner]] para naming/red/puertos de `opencode-<slug>`
