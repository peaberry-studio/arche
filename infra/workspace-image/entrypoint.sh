#!/bin/sh
set -e

# Inicializar workspace con KB si es necesario
if [ -d "/kb" ]; then
  /usr/local/bin/init-workspace.sh
fi

# Iniciar workspace-agent si está disponible
# Logs go to stdout/stderr (captured by container runtime)
if command -v workspace-agent >/dev/null 2>&1; then
  WORKSPACE_AGENT_ADDR="${WORKSPACE_AGENT_ADDR:-0.0.0.0:${WORKSPACE_AGENT_PORT:-4097}}"
  workspace-agent --addr "$WORKSPACE_AGENT_ADDR" &
fi

# Ejecutar OpenCode con los argumentos originales
exec opencode "$@"
