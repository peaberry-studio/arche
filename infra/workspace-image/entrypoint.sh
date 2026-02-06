#!/bin/sh
set -e

# Inicializar workspace con KB si es necesario
if [ -d "/kb-content" ]; then
  /usr/local/bin/init-workspace.sh
fi

# Apply OpenCode config from user-data (written by the spawner).
# This contains the merged config: agents + MCP connectors + provider gateway.
if [ -f "/tmp/arche-user-data/opencode-config.json" ]; then
  cp /tmp/arche-user-data/opencode-config.json /workspace/opencode.json
fi

# Copy support files from user-data (written by the spawner)
if [ -f "/tmp/arche-user-data/AGENTS.md" ]; then
  cp /tmp/arche-user-data/AGENTS.md /workspace/AGENTS.md
fi

# Iniciar workspace-agent si está disponible
# Logs go to stdout/stderr (captured by container runtime)
if command -v workspace-agent >/dev/null 2>&1; then
  WORKSPACE_AGENT_ADDR="${WORKSPACE_AGENT_ADDR:-0.0.0.0:${WORKSPACE_AGENT_PORT:-4097}}"
  workspace-agent --addr "$WORKSPACE_AGENT_ADDR" &
fi

# Ejecutar OpenCode con los argumentos originales
exec opencode "$@"
