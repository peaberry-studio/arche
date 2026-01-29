# Arquitectura de Calix Control Plane

## Visión general

Calix es un sistema multiusuario que proporciona instancias de OpenCode on-demand, protegido por Cloudflare Zero Trust.

```
                    ┌─────────────────────────────────────┐
                    │         CLOUDFLARE                  │
                    │  ┌─────────────┐  ┌─────────────┐  │
                    │  │   Access    │  │   Tunnel    │  │
                    │  │   (SSO)     │  │(cloudflared)│  │
                    │  └─────────────┘  └──────┬──────┘  │
                    └──────────────────────────┼─────────┘
                                               │
                    ┌──────────────────────────┼─────────┐
                    │         VPS              │         │
                    │                          ▼         │
                    │  ┌─────────────────────────────┐   │
                    │  │          TRAEFIK            │   │
                    │  │  ┌─────────────────────────┐│   │
                    │  │  │ Host rules + forwardAuth││   │
                    │  │  └─────────────────────────┘│   │
                    │  └──────────────┬──────────────┘   │
                    │        ┌────────┴────────┐         │
                    │        ▼                 ▼         │
                    │  ┌──────────┐    ┌──────────────┐  │
                    │  │  PANEL   │    │   OPENCODE   │  │
                    │  │  (Rails) │    │ (por usuario)│  │
                    │  └──────────┘    └──────────────┘  │
                    │        │                 │         │
                    │        └────────┬────────┘         │
                    │                 ▼                  │
                    │  ┌─────────────────────────────┐   │
                    │  │        PERSISTENCIA         │   │
                    │  │  /var/lib/calix/            │   │
                    │  │    panel/   users/<slug>/   │   │
                    │  └─────────────────────────────┘   │
                    └────────────────────────────────────┘
```

## Componentes

### Cloudflare Access
- Protege el acceso al panel y a las sesiones de usuario
- SSO con Google Workspace (u otro IdP)
- Inyecta JWT en header `Cf-Access-Jwt-Assertion`

### Cloudflare Tunnel (cloudflared)
- Publica dos hostnames hacia el VPS:
  - `calix.example.com` → Panel
  - `*.calix.example.com` → Sesiones de usuario
- No requiere puertos abiertos en el VPS

### Traefik
- Reverse proxy con routing dinámico
- Enruta por `Host`:
  - Panel: `calix.example.com` → `panel-web:3000`
  - Sesiones: `u-<slug>.calix.example.com` → `opencode-<slug>:4096`
- Aplica `forwardAuth` a las sesiones de usuario

### Panel (Rails)
- Valida JWT de Cloudflare Access
- Gestiona usuarios, repos e instancias
- Endpoint `/auth/traefik` para owner isolation
- Background jobs con Solid Queue + SQLite

### OpenCode containers
- Una instancia por usuario
- Imagen `calix-opencode:latest`
- Labels Traefik para routing dinámico
- Git local para versionado (sin GitHub remoto)

### Docker Socket Proxies
- `docker-socket-proxy-traefik`: Solo lectura (para descubrir containers)
- `docker-socket-proxy-panel`: Lectura/escritura (para crear/parar containers)
- Principio de mínimo privilegio

## Flujos

### Autenticación

```
Usuario ──► Cloudflare Access ──► VPS (Traefik) ──► Panel
                │
                └── Inyecta JWT en Cf-Access-Jwt-Assertion
                                    │
                                    ▼
                            Panel valida JWT:
                            1. Verifica firma (JWKS)
                            2. Verifica aud (CF_ACCESS_AUDS)
                            3. Extrae email
                            4. Find or create User
```

### Owner Isolation

```
Usuario A intenta acceder a u-slug-b.calix.example.com
                │
                ▼
        Traefik forwardAuth
                │
                ▼
        Panel /auth/traefik
                │
                ├── Valida JWT ✓
                │
                ├── Extrae email: user-a@empresa.com
                │
                ├── Extrae slug del Host: slug-b
                │
                ├── User A tiene slug-a ≠ slug-b
                │
                └── Responde 403 Forbidden
```

### Start de instancia

```
Usuario hace clic en "Start"
                │
                ▼
        Panel crea container:
        - Nombre: opencode-<slug>
        - Labels Traefik
        - Mounts: workspace, config
        - Env: GH_TOKEN, GIT_USER_*
                │
                ▼
        Traefik detecta container
        (via docker-socket-proxy-traefik)
                │
                ▼
        Ruta dinámica activa:
        u-<slug>.calix.example.com → container:4096
```

## Persistencia

```
/var/lib/calix/
├── panel/
│   ├── production.sqlite3    # Base de datos principal
│   └── queue.sqlite3         # Solid Queue jobs
│
└── users/
    └── <slug>/
        ├── config/           # ~/.config/opencode
        ├── cache/            # ~/.cache/opencode
        ├── share/            # ~/.local/share/opencode
        └── workspaces/
            └── <repo_key>/   # Git repo local
                ├── .git/
                └── ...
```

## Seguridad

1. **Cloudflare Access**: Primera capa de autenticación
2. **JWT validation**: El panel verifica firma y audience
3. **Owner isolation**: ForwardAuth impide acceso cruzado
4. **Docker socket proxy**: Least privilege para cada servicio
5. **Encryption at rest**: GH_TOKEN cifrado en SQLite
