# Calix Control Plane

Panel web multiusuario para OpenCode on-demand, protegido por Cloudflare Zero Trust.

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLOUDFLARE                                     │
│  ┌─────────────────┐    ┌─────────────────────────────────────────┐     │
│  │  Access (SSO)   │    │  Tunnel (cloudflared)                   │     │
│  │  *@empresa.com  │    │  ├─ calix.example.com    ─┐             │     │
│  └─────────────────┘    │  └─ *.calix.example.com  ─┼─► localhost │     │
│                         └─────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              VPS                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                         TRAEFIK                                  │    │
│  │  Host(calix.example.com)      ──► panel-web:3000                │    │
│  │  Host(u-<slug>.calix.example.com) ──► opencode-<slug>:4096      │    │
│  │                                   + forwardAuth ──► panel/auth  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                           │                                              │
│           ┌───────────────┼───────────────┐                             │
│           ▼               ▼               ▼                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐                  │
│  │ panel-web   │  │panel-worker │  │ opencode-<slug> │ ← 1 por usuario  │
│  │ (Rails)     │  │(Solid Queue)│  │ (OpenCode Web)  │                  │
│  └─────────────┘  └─────────────┘  └─────────────────┘                  │
│         │                │                  │                            │
│         └────────────────┴──────────────────┘                           │
│                          │                                               │
│                          ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    PERSISTENCIA                                  │    │
│  │  /var/lib/calix/panel/     ← SQLite + config                    │    │
│  │  /var/lib/calix/users/<slug>/                                   │    │
│  │    ├── config/             ← OpenCode config                    │    │
│  │    ├── cache/              ← OpenCode cache                     │    │
│  │    └── workspaces/<repo>/  ← Git local (sin remote)             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Características

- **Multiusuario**: Cada usuario tiene su instancia OpenCode aislada
- **On-demand**: Instancias se crean/destruyen según uso
- **Owner isolation**: Usuario A no puede acceder al subdominio de B
- **Git local**: Versionado en el VPS sin depender de GitHub para commits
- **Persistencia**: Workspaces sobreviven a stop/start
- **Zero Trust**: Cloudflare Access + SSO (Google Workspace, etc.)

## Requisitos

- VPS Linux (Ubuntu 22.04+ recomendado) con Docker
- Dominio en Cloudflare
- Cloudflare Zero Trust (plan gratuito suficiente)
- ~2GB RAM mínimo + 1GB por usuario activo

## Quick Start

```bash
# 1. Clonar/copiar este directorio al VPS
scp -r Calix/Deploy user@vps:/opt/calix

# 2. Configurar variables
cd /opt/calix
cp .env.example .env
nano .env  # Rellenar valores

# 3. Instalar
./scripts/install.sh

# 4. Configurar Cloudflare (ver sección abajo)

# 5. Verificar
./scripts/doctor.sh
```

## Variables de entorno

Ver `.env.example` para la lista completa. Las críticas son:

| Variable | Descripción |
|----------|-------------|
| `CALIX_DOMAIN` | Dominio base (ej: `calix.calisteniapp.com`) |
| `CLOUDFLARED_TOKEN` | Token del tunnel de Cloudflare |
| `CF_ACCESS_AUDS` | Audience IDs de las apps Access (CSV) |
| `RAILS_MASTER_KEY` | Key para Rails credentials |
| `SECRET_KEY_BASE` | Secret para Rails sessions |
| `ALLOWED_GH_ORGS` | Organizaciones GitHub permitidas (CSV) |

## Configuración de Cloudflare

### 1. Crear Tunnel

Zero Trust → Networks → Tunnels → Create

Guardar el token en `CLOUDFLARED_TOKEN`.

### 2. Public Hostnames

En el tunnel, añadir dos hostnames:

| Hostname | Service |
|----------|---------|
| `calix.example.com` | `http://localhost:80` |
| `*.calix.example.com` | `http://localhost:80` |

### 3. Access Applications

Zero Trust → Access → Applications → Add

**App 1: Panel**
- Domain: `calix.example.com`
- Policy: Allow emails ending in `@tuempresa.com`
- Copiar el `aud` a `CF_ACCESS_AUDS`

**App 2: Sessions**
- Domain: `*.calix.example.com`
- Policy: Allow emails ending in `@tuempresa.com`
- Añadir el `aud` a `CF_ACCESS_AUDS` (separado por coma)

## Estructura de directorios

```
Deploy/
├── .env.example           # Template de configuración
├── .gitignore
├── README.md              # Este archivo
├── docker-compose.yml     # Stack completo (7 servicios)
│
├── images/
│   └── opencode/
│       ├── Dockerfile     # Imagen OpenCode + git
│       └── entrypoint.sh  # Setup git local
│
├── panel/                 # Rails app (placeholder)
│   ├── Dockerfile
│   └── ...
│
├── traefik/
│   └── traefik.yml        # Config estática
│
├── scripts/
│   ├── install.sh         # One-click deployment
│   ├── doctor.sh          # Health checks
│   ├── backup.sh          # Backup SQLite + data
│   ├── restore.sh         # Restore desde backup
│   └── prune.sh           # Limpiar contenedores stopped
│
└── docs/
    ├── architecture.md
    ├── cloudflare-setup.md
    ├── operations.md
    └── security.md
```

## Git local (sin GitHub remoto)

Cada workspace usa Git localmente para versionado:

```bash
# Dentro del contenedor OpenCode, el usuario puede:
git status              # Ver cambios
git diff                # Ver diferencias
git add . && git commit # Guardar snapshot
git log --oneline       # Ver historial
git checkout HEAD~1 -- file.md  # Revertir archivo
```

**Ventajas:**
- Historial completo con diffs
- Funciona sin conexión a GitHub
- Rollback instantáneo
- Sin autenticación para commits locales

**Para publicar a GitHub** (cuando se implemente `/publish`):
- El usuario necesita `GH_TOKEN` con permisos
- Se crea branch, push, y PR

## Operaciones

### Ver logs

```bash
# Todos los servicios
docker compose logs -f

# Solo panel
docker compose logs -f panel-web

# Contenedor de usuario específico
docker logs -f opencode-abc123
```

### Backup

```bash
./scripts/backup.sh
# Crea: /var/lib/calix/backups/calix-YYYYMMDD-HHMMSS.tar.gz
```

### Restore

```bash
./scripts/restore.sh /path/to/backup.tar.gz
```

### Limpiar contenedores parados

```bash
./scripts/prune.sh
```

## Seguridad

- **Owner isolation**: ForwardAuth valida que el JWT del usuario corresponde al subdominio
- **Docker socket proxy**: Panel no tiene acceso directo a docker.sock
- **Encryption at rest**: GH_TOKEN cifrado en SQLite con Rails encryption
- **No secrets en repo**: Todo en `.env` (ignorado por git)

## Troubleshooting

### El panel no responde

```bash
./scripts/doctor.sh
docker compose logs panel-web
```

### Usuario no puede acceder a su sesión

1. Verificar que el contenedor existe: `docker ps | grep opencode-`
2. Verificar logs de Traefik: `docker compose logs traefik`
3. Verificar forwardAuth: `curl -I http://localhost/auth/traefik`

### Cloudflare Access rechaza

1. Verificar que el email está en la policy
2. Verificar que `CF_ACCESS_AUDS` tiene los aud correctos
3. Limpiar cookies y re-autenticar

## Roadmap MVP

- [x] Arquitectura definida
- [ ] Panel Rails básico (auth + CRUD usuarios)
- [ ] Docker spawner (create/stop containers)
- [ ] ForwardAuth endpoint
- [ ] UI: lista repos + start/stop
- [ ] Idle reaper job
- [ ] Scripts de operación
