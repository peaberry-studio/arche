#!/bin/sh
set -e

ensure_git_safe_directory() {
  dir="$1"
  if [ ! -d "$dir" ]; then
    return
  fi

  if ! git config --global --get-all safe.directory | grep -Fx "$dir" >/dev/null 2>&1; then
    git config --global --add safe.directory "$dir"
  fi
}

# Git safety: with Podman user namespace remapping, bind mounts can appear with
# a different owner inside the container. Mark known mount points as safe.
ensure_git_safe_directory /workspace
ensure_git_safe_directory /kb-content

if [ ! -d "/kb-content" ]; then
  echo "[entrypoint] Missing required /kb-content mount" >&2
  exit 1
fi

# Initialize workspace with KB
/usr/local/bin/init-workspace.sh

# Apply OpenCode config from user-data (written by the spawner).
# This contains the merged config: agents + MCP connectors + provider gateway.
if [ -f "/tmp/arche-user-data/opencode-config.json" ]; then
  cp /tmp/arche-user-data/opencode-config.json /workspace/opencode.json
fi

# Copy support files from user-data (written by the spawner)
if [ -f "/tmp/arche-user-data/AGENTS.md" ]; then
  cp /tmp/arche-user-data/AGENTS.md /workspace/AGENTS.md
fi

# Start workspace-agent if available
# Logs go to stdout/stderr (captured by container runtime)
if command -v workspace-agent >/dev/null 2>&1; then
  WORKSPACE_AGENT_ADDR="${WORKSPACE_AGENT_ADDR:-0.0.0.0:${WORKSPACE_AGENT_PORT:-4097}}"
  workspace-agent --addr "$WORKSPACE_AGENT_ADDR" &
fi

# Run OpenCode with original arguments
exec opencode "$@"
