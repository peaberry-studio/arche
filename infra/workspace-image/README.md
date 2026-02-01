# Arche Workspace Image

Imagen derivada de OpenCode con soporte para Knowledge Base (KB) compartido.

## Características

- Basada en `ghcr.io/anomalyco/opencode`
- Incluye `git` para sincronización de KB
- Script de inicialización automática del workspace

## Build

```bash
# Desde este directorio
docker build -t arche-workspace .

# Con versión específica de OpenCode
docker build --build-arg OPENCODE_VERSION=1.1.45 -t arche-workspace:1.1.45 .
```

## Uso

El container espera dos volúmenes:

1. `/workspace` - Volumen persistente del usuario (read-write)
2. `/kb` - Knowledge Base compartido (read-only)

```bash
docker run -d \
  -v workspace-user1:/workspace \
  -v /opt/arche/kb:/kb:ro \
  arche-workspace serve --hostname 0.0.0.0 --port 4096
```

## Inicialización del Workspace

Al iniciar, el script `init-workspace.sh` ejecuta:

1. Si `/workspace` no tiene `.git`:
   - Copia el contenido de `/kb` a `/workspace`
   - Inicializa un repositorio git
   - Crea commit inicial
   - Añade remote `kb` apuntando a `/kb`

2. Si `/workspace` ya tiene `.git`:
   - No copia nada (respeta el trabajo del usuario)
   - Añade remote `kb` si no existe

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
| `KB_DIR` | `/kb` | Directorio del KB montado |
| `KB_REMOTE_NAME` | `kb` | Nombre del remote Git para el KB |
