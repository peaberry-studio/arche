# Arche Workspace Image

Imagen derivada de OpenCode con soporte para Knowledge Base (KB) compartido.

## Características

- Basada en `ghcr.io/anomalyco/opencode`
- Incluye `git` para sincronización de KB
- Script de inicialización automática del workspace
- Workspace agent HTTP para diffs y operaciones de archivo
- Soporte para configuración runtime inyectada por el spawner (`opencode.json` y `AGENTS.md`)

## Workspace Agent

Servicio interno que expone operaciones acotadas sobre el workspace:

- `GET /git/diffs`
- `POST /files/read`
- `POST /files/write`
- `POST /files/delete`
- `POST /files/apply_patch`
- `POST /kb/sync`
- `GET /kb/status`
- `POST /kb/publish`

## Build

```bash
# Desde este directorio
podman build -t arche-workspace .

# Con versión específica de OpenCode
podman build --build-arg OPENCODE_VERSION=1.1.45 -t arche-workspace:1.1.45 .
```

## Uso

El container usa estos montajes principales:

1. `/workspace` - Volumen persistente del usuario (read-write)
2. `/kb-content` - Repo Git bare de contenido KB (read-write)
3. `/home/workspace/.local/share/opencode` - Estado persistente de OpenCode (sesiones/UI)
4. `/home/workspace/.local/state/opencode` - Estado runtime de OpenCode
5. `/workspace/opencode.json` - Config runtime (read-only, bind de archivo)
6. `/workspace/AGENTS.md` - Instrucciones runtime (read-only, bind de archivo, opcional)

```bash
podman run -d \
  -v workspace-user1:/workspace \
  -v opencode-share-user1:/home/workspace/.local/share/opencode \
  -v opencode-state-user1:/home/workspace/.local/state/opencode \
  -v /opt/arche/kb-content:/kb-content \
  -v /opt/arche/users/user1/opencode-config.json:/workspace/opencode.json:ro \
  -v /opt/arche/users/user1/AGENTS.md:/workspace/AGENTS.md:ro \
  arche-workspace serve --hostname 0.0.0.0 --port 4096
```

## Inicialización del Workspace

Al iniciar, el script `init-workspace.sh` ejecuta:

1. Si `/workspace` no tiene `.git` y está vacío:
   - Clona el repo bare de `/kb-content` a `/workspace`
   - Configura el remote `kb` apuntando a `/kb-content`

2. Si `/workspace` ya tiene `.git`:
   - No clona nada (respeta el trabajo del usuario)
   - Añade remote `kb` si no existe

El runtime de configuración lo inyecta el spawner de Arche al crear el contenedor:

- `opencode.json` (merge de CommonWorkspaceConfig + MCP connectors + provider gateway)
- `AGENTS.md` (si existe en el repo de config)

Si esos archivos no están montados, `entrypoint.sh` mantiene un fallback legacy:

- intentar copiar `/user-data/opencode-config.json` -> `/workspace/opencode.json`
- intentar copiar `/user-data/AGENTS.md` -> `/workspace/AGENTS.md`

## Sincronización de KB

Desde dentro del container, el usuario puede sincronizar con:

```bash
cd /workspace
git fetch kb
git merge kb/main  # o git rebase kb/main
```

Si hay conflictos, Git los marcará y el usuario puede resolverlos.

## Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `WORKSPACE_DIR` | `/workspace` | Directorio del workspace |
| `KB_CONTENT_DIR` | `/kb-content` | Repo bare de contenido KB montado |
| `KB_REMOTE_NAME` | `kb` | Nombre del remote Git para el KB |
| `WORKSPACE_AGENT_PORT` | `4097` | Puerto del workspace agent |
| `WORKSPACE_AGENT_ADDR` | `0.0.0.0:4097` | Dirección bind del workspace agent |
