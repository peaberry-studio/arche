# Infra

Este directorio agrupa todo lo necesario para ejecutar Arche como stack (local y VPS): reverse proxy, base de datos, redes y hardening.

## Puntos de entrada

- Stack local de desarrollo (Traefik + Postgres + Web): `infra/compose/README.md`
- One-click deployer (VPS + local prod): `infra/deploy/README.md`
- Coolify deployment (VPS con Coolify): `infra/coolify/README.md`
- Imagen de workspace (OpenCode + git): `infra/workspace-image/README.md`

## Knowledge Base (KB)

El sistema incluye un Knowledge Base compartido que se inyecta en cada workspace de usuario.

### Arquitectura

```
Host (VPS)
├── /opt/arche/kb-content/   ← Repo bare de contenido KB
├── /opt/arche/kb-config/    ← Repo bare de configuración
│
└── Containers (por usuario)
└── /workspace/          ← Volumen persistente
    ├── .git/            ← Repo local con remote 'kb'
    ├── Company/         ← Generado por kickstart al setup inicial
    ├── ...
    └── opencode.json    ← Generado en runtime desde kb-config
```

### Setup del KB

1. **Build de la imagen de workspace** (incluye git):
   ```bash
   cd infra/workspace-image
   podman build -t arche-workspace:latest .
   ```

2. **Inicializar repos bare de KB y config (vacios)**:
   ```bash
   ./scripts/deploy-kb.sh /opt/arche/kb-content
   ./scripts/deploy-config.sh /opt/arche/kb-config
   ```

3. **Configurar la variable de entorno** en el compose o en produccion:
   ```
   KB_CONTENT_HOST_PATH=/opt/arche/kb-content
   KB_CONFIG_HOST_PATH=/opt/arche/kb-config
   ```

### Sincronización

En una instalacion nueva, el workspace queda bloqueado hasta completar kickstart
en `/u/[slug]/kickstart`, que escribe el contenido inicial del KB y la config.

Los usuarios pueden sincronizar su workspace con el KB central:

1. **Desde la UI**: Botón "Sync KB" en el header del workspace
2. **Manualmente** (dentro del container):
   ```bash
   git fetch kb
   git merge kb/main
   ```

Si hay conflictos, el usuario los resuelve en el editor integrado.
