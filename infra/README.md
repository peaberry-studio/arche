# Infra

Este directorio agrupa todo lo necesario para ejecutar Arche como stack (local y VPS): reverse proxy, base de datos, redes y hardening.

## Puntos de entrada

- Stack local (Traefik + Postgres + Web): `infra/compose/README.md`
- Imagen de workspace (OpenCode + git): `infra/workspace-image/README.md`

## Knowledge Base (KB)

El sistema incluye un Knowledge Base compartido que se inyecta en cada workspace de usuario.

### Arquitectura

```
Host (VPS)
├── /opt/arche/kb/           ← Repo Git con el KB (se carga en deploy)
│   ├── .git/
│   ├── Company/
│   ├── Templates/
│   ├── System Prompts/
│   └── opencode.json
│
└── Docker containers (por usuario)
    └── /workspace/          ← Volumen persistente
        ├── .git/            ← Repo local con remote 'kb'
        ├── Company/         ← Copiado del KB al init
        └── ...
```

### Setup del KB

1. **Build de la imagen de workspace** (incluye git):
   ```bash
   cd infra/workspace-image
   docker build -t arche-workspace:latest .
   ```

2. **Deploy del KB al host**:
   ```bash
   ./scripts/deploy-kb.sh /opt/arche/kb
   ```

3. **Configurar la variable de entorno** en el compose o en producción:
   ```
   KB_HOST_PATH=/opt/arche/kb
   ```

### Sincronización

Los usuarios pueden sincronizar su workspace con el KB central:

1. **Desde la UI**: Botón "Sync KB" en el header del workspace
2. **Manualmente** (dentro del container):
   ```bash
   git fetch kb
   git merge kb/main
   ```

Si hay conflictos, el usuario los resuelve en el editor integrado.
