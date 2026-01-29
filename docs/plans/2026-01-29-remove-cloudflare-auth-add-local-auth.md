# Local Auth (SQLite) + Remove Cloudflare Access/Tunnel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminar completamente Cloudflare Zero Trust/Access + `cloudflared` del despliegue y reemplazarlo por autenticación local multiusuario (SQLite) manteniendo el aislamiento por subdominio (`u-<slug>.<CALIX_DOMAIN>`).

**Architecture:** El panel Rails pasa a gestionar sesiones propias (cookie) y credenciales locales (password hash). Traefik continúa usando `forwardAuth` hacia el panel para autorizar tráfico a los contenedores `opencode-<slug>` y prevenir acceso cruzado por subdominio.

**Tech Stack:** Rails (panel), SQLite (ya existente), Traefik forwardAuth, Docker labels (spawner), bcrypt (password hashing).

---

## Estado actual (baseline)

- Cloudflare Access inyecta `Cf-Access-Jwt-Assertion`.
- `Calix/Deploy/panel/app/controllers/application_controller.rb` valida JWT y crea `User` por email.
- `Calix/Deploy/panel/app/controllers/auth_controller.rb` sirve `/auth/traefik` para forwardAuth y hace owner isolation por `Host` (subdominio → slug).
- `Calix/Deploy/docker-compose.yml` incluye `cloudflared` y env vars `CLOUDFLARED_TOKEN` + `CF_ACCESS_AUDS`.

## Decisiones (cerradas en esta conversación)

- Multiusuario real (cada usuario con workspace aislado).
- Subdominios por usuario se mantienen (no path-based) por limitaciones de OpenCode.

## Fuera de alcance (por ahora)

- Recovery por email/magic links.
- MFA.
- Integración con IdPs externos.

## Reglas de aceptación

- El stack funciona sin Cloudflare: no hay `cloudflared` ni variables/env/docs requeridas.
- El panel requiere login local (sesión cookie) para UI.
- Traefik `forwardAuth` autoriza `u-<slug>.<CALIX_DOMAIN>` solo si el usuario autenticado localmente corresponde a ese `slug`.
- No hay dependencia de `Cf-Access-Jwt-Assertion`.
- Persistencia de usuarios/credenciales en SQLite del panel.

---

### Task 1: Inventario de puntos Cloudflare y modo de compatibilidad (solo lectura)

**Files:**
- Review: `Calix/Deploy/docker-compose.yml`
- Review: `Calix/Deploy/panel/app/controllers/application_controller.rb`
- Review: `Calix/Deploy/panel/app/controllers/auth_controller.rb`
- Review: `Calix/Deploy/panel/app/services/cf_jwt_validator.rb`
- Review: `Calix/Deploy/docs/cloudflare-setup.md`
- Review: `Calix/Deploy/docs/architecture.md`
- Review: `Calix/Deploy/scripts/install.sh`
- Review: `Calix/Deploy/scripts/doctor.sh`

**Step 1: Enumerar puntos de acoplamiento**
- Identificar cada: header, env var, servicio, doc y texto que asume Cloudflare.

**Step 2: Definir estrategia de corte**
- Decidir si se soporta “modo legacy” temporal (recomendado: NO; quitar completamente como pediste).

**Step 3: No commit**
- Esta tarea produce lista, no cambios.

---

### Task 2: Modelo de autenticación local (TDD)

**Files:**
- Modify: `Calix/Deploy/panel/app/models/user.rb`
- Create: `Calix/Deploy/panel/db/migrate/XXXXXXXXXX_add_auth_fields_to_users.rb`
- Modify: `Calix/Deploy/panel/Gemfile`
- Test: `Calix/Deploy/panel/test/models/user_test.rb` (o la convención de test existente)

**Step 1: Escribir test fallando para credenciales**
- Caso mínimo: `User` requiere `email` y permite `password`/`password_confirmation` y persiste un digest.

**Step 2: Ejecutar test y confirmar FAIL**
- Run (desde `Calix/Deploy/panel`): `bin/rails test test/models/user_test.rb`
- Expected: falla por campos/métodos inexistentes.

**Step 3: Implementación mínima**
- Añadir `bcrypt` (p.ej. `gem 'bcrypt', '~> 3.1'`).
- Añadir columna `password_digest` y usar `has_secure_password`.

**Step 4: Ejecutar test y confirmar PASS**
- Run: `bin/rails test test/models/user_test.rb`

**Step 5: Commit**
- `git add Calix/Deploy/panel/Gemfile Calix/Deploy/panel/app/models/user.rb Calix/Deploy/panel/db/migrate/* Calix/Deploy/panel/test/models/user_test.rb`
- `git commit -m "feat(auth): add local password auth fields"`

---

### Task 3: Sesiones (login/logout) para el panel (TDD)

**Files:**
- Create: `Calix/Deploy/panel/app/controllers/sessions_controller.rb`
- Create: `Calix/Deploy/panel/app/views/sessions/new.html.erb`
- Modify: `Calix/Deploy/panel/config/routes.rb`
- Modify: `Calix/Deploy/panel/app/controllers/application_controller.rb`
- Test: `Calix/Deploy/panel/test/controllers/sessions_controller_test.rb`
- Test: `Calix/Deploy/panel/test/integration/auth_flow_test.rb`

**Step 1: Test fallando de login**
- `GET /login` responde 200.
- `POST /login` con credenciales válidas crea sesión y redirige a `/`.
- `DELETE /logout` limpia sesión.

**Step 2: Ejecutar tests (FAIL)**
- Run: `bin/rails test test/controllers/sessions_controller_test.rb test/integration/auth_flow_test.rb`

**Step 3: Implementación mínima**
- `SessionsController`: `new`, `create`, `destroy`.
- `ApplicationController`: sustituir `authenticate_via_cloudflare_access!` por `authenticate_user!` basado en `session[:user_id]`.
- `current_user` basado en `User.find_by(id: session[:user_id])`.

**Step 4: Ejecutar tests (PASS)**
- Run: mismos tests.

**Step 5: Commit**
- `git add Calix/Deploy/panel/app/controllers/application_controller.rb Calix/Deploy/panel/app/controllers/sessions_controller.rb Calix/Deploy/panel/app/views/sessions/new.html.erb Calix/Deploy/panel/config/routes.rb Calix/Deploy/panel/test/controllers/sessions_controller_test.rb Calix/Deploy/panel/test/integration/auth_flow_test.rb`
- `git commit -m "feat(auth): add login/logout with cookie sessions"`

---

### Task 4: Bootstrap del primer usuario (sin depender de UI) (TDD)

**Files:**
- Create: `Calix/Deploy/panel/lib/tasks/auth.rake`
- Test: `Calix/Deploy/panel/test/tasks/auth_rake_test.rb` (si hay harness) o un test equivalente
- Modify: `Calix/Deploy/README.md` (sección de instalación/config)

**Step 1: Definir mecanismo**
- Recomendación: task `bin/rails "auth:bootstrap[email,password]"` que crea el primer usuario si no existe ninguno.

**Step 2: Test fallando**
- Caso: cuando no hay usuarios, se crea uno; cuando hay usuarios, no hace nada o falla con mensaje claro.

**Step 3: Implementación mínima**
- Task de rake con validaciones y salida clara.

**Step 4: Ejecutar tests (PASS)**

**Step 5: Commit**
- Incluir doc mínima en `Calix/Deploy/README.md`.

---

### Task 5: ForwardAuth sin Cloudflare (owner isolation por sesión local) (TDD)

**Files:**
- Modify: `Calix/Deploy/panel/app/controllers/auth_controller.rb`
- Modify: `Calix/Deploy/panel/config/routes.rb` (si se necesita separar auth endpoints)
- Test: `Calix/Deploy/panel/test/controllers/auth_controller_test.rb`

**Step 1: Test fallando**
- Sin sesión: `/auth/traefik` devuelve `401`.
- Con sesión, host `CALIX_DOMAIN`: `200`.
- Con sesión, host `u-<slug>.<CALIX_DOMAIN>`:
  - `200` si `current_user.slug == <slug>`.
  - `403` si no coincide.

**Step 2: Ejecutar tests (FAIL)**
- Run: `bin/rails test test/controllers/auth_controller_test.rb`

**Step 3: Implementación mínima**
- Dejar de leer `Cf-Access-Jwt-Assertion`.
- Extraer `host` como hoy (`X-Forwarded-Host` o `request.host`).
- Resolver `current_user` desde sesión.
- Mantener owner isolation actual por regex de subdominio.
- (Opcional) setear `X-Forwarded-User` (email o id) en `response.headers`.

**Step 4: Ejecutar tests (PASS)**

**Step 5: Commit**

---

### Task 6: Eliminar Cloudflare del compose y scripts (TDD donde aplique)

**Files:**
- Modify: `Calix/Deploy/docker-compose.yml`
- Modify: `Calix/Deploy/.env.example`
- Modify: `Calix/Deploy/scripts/install.sh`
- Modify: `Calix/Deploy/scripts/doctor.sh`
- Modify: `Calix/Deploy/docs/architecture.md`
- Modify/Delete (según decisión): `Calix/Deploy/docs/cloudflare-setup.md`
- Modify: `Calix/Deploy/README.md`

**Step 1: Compose**
- Eliminar servicio `cloudflared`.
- Eliminar env vars `CF_ACCESS_AUDS`, `CLOUDFLARED_TOKEN`.
- Revisar puertos de `traefik` (actualmente solo bind a `127.0.0.1:80`): decidir si se exponen a `0.0.0.0:80` para acceso remoto sin túnel.

**Step 2: Scripts**
- `doctor.sh`: quitar checks Cloudflare.
- `install.sh`: quitar pasos de configuración Cloudflare y referencias a AUD/token.

**Step 3: Docs**
- Actualizar `Calix/Deploy/docs/architecture.md` para eliminar Cloudflare del diagrama y del flujo de auth.
- Ajustar `Calix/Deploy/README.md` para explicar auth local y bootstrap.

**Step 4: Smoke checks**
- Run (desde `Calix/Deploy`): `docker compose config`.
- Run (si hay docker disponible en el entorno de ejecución real): `docker compose up -d` y validar:
  - `GET http://<host>/health` (si aplica) o ruta equivalente.

**Step 5: Commit**
- `git add Calix/Deploy/docker-compose.yml Calix/Deploy/.env.example Calix/Deploy/scripts/install.sh Calix/Deploy/scripts/doctor.sh Calix/Deploy/docs/architecture.md Calix/Deploy/README.md Calix/Deploy/docs/cloudflare-setup.md`
- `git commit -m "chore(deploy): remove cloudflare tunnel/access configuration"`

---

### Task 7: Limpieza de código Cloudflare en Rails (TDD)

**Files:**
- Delete: `Calix/Deploy/panel/app/services/cf_jwt_validator.rb`
- Modify: cualquier referencia restante (buscar por `CfJwtValidator` y `Cf-Access-Jwt-Assertion`)
- Test: suite completa del panel

**Step 1: Búsqueda**
- Search: `CfJwtValidator|Cf-Access-Jwt-Assertion|CF_ACCESS_AUDS`.

**Step 2: Eliminar y ajustar**
- Borrar servicio y referencias.

**Step 3: Ejecutar tests del panel**
- Run: `bin/rails test`.

**Step 4: Commit**
- `git add -A`
- `git commit -m "refactor(auth): remove cloudflare jwt validator"`

---

## Verificación final (antes de PR/merge)

- Panel: `Calix/Deploy/panel` → `bin/rails test`.
- Compose: `Calix/Deploy` → `docker compose config`.
- Docs: revisión rápida de `Calix/Deploy/README.md` para asegurar que no menciona Cloudflare.

## Notas operativas

- En este entorno local actual no hay `docker` instalado (no se puede hacer `docker compose up`). La verificación del stack deberá hacerse en la máquina/VPS de despliegue.
