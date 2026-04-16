# Arche Workspace Image

Image derived from OpenCode with support for a shared Knowledge Base (KB).

## Features

- Based on `ghcr.io/anomalyco/opencode`
- Includes `git` for KB sync
- Automatic workspace initialization script
- Workspace agent HTTP service for diffs and file operations
- Support for runtime config injected by the spawner (`opencode.json` and `AGENTS.md`)
- Global OpenCode custom tools for spreadsheets (`spreadsheet_*`), documents (`document_inspect`), presentations (`presentation_inspect`), and structured email drafts (`email_draft`)

## Workspace Agent

Internal service exposing scoped workspace operations:

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
# From this directory
podman build --build-arg OPENCODE_VERSION="$(cat ../../versions/opencode.version)" -t arche-workspace .

# With a specific OpenCode version
podman build --build-arg OPENCODE_VERSION=1.2.24 -t arche-workspace:1.2.24 .
```

## Usage

The container uses these main mounts:

1. `/workspace` - User persistent volume (read-write)
2. `/kb-content` - KB content bare Git repo (read-write)
3. `/home/workspace/.local/share/opencode` - OpenCode persistent state (sessions/UI)
4. `/home/workspace/.local/state/opencode` - OpenCode runtime state
5. `/workspace/opencode.json` - Runtime config (read-only file bind)
6. `/workspace/AGENTS.md` - Runtime instructions (read-only file bind, optional)

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

## Workspace Initialization

At startup, `init-workspace.sh` runs:

1. If `/workspace` has no `.git` and is empty:
   - Clones `/kb-content` bare repo into `/workspace`
   - Configures `kb` remote pointing to `/kb-content`

2. If `/workspace` already has `.git`:
   - Does not clone (preserves user work)
   - Adds `kb` remote if missing

Runtime config is injected by Arche spawner when creating the container:

- `opencode.json` (merge of CommonWorkspaceConfig + MCP connectors + provider gateway)
- `AGENTS.md` (if present in config repo)

The image also includes a global `OPENCODE_CONFIG_DIR` (`/opt/arche/opencode-config`) with custom tools always available to all workspaces.

At startup, `entrypoint.sh` copies mounted runtime files into `/workspace`:

- copy `/tmp/arche-user-data/opencode-config.json` -> `/workspace/opencode.json`
- copy `/tmp/arche-user-data/AGENTS.md` -> `/workspace/AGENTS.md`

`/kb-content` is mandatory. The container exits on startup if the mount is missing.

## KB Sync

Inside the container, users can sync with:

```bash
cd /workspace
git fetch kb
git merge kb/main  # or git rebase kb/main
```

If conflicts appear, Git marks them and the user can resolve them.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKSPACE_DIR` | `/workspace` | Workspace directory |
| `KB_CONTENT_DIR` | `/kb-content` | Mounted KB content bare repo |
| `KB_REMOTE_NAME` | `kb` | KB Git remote name |
| `WORKSPACE_AGENT_PORT` | `4097` | Workspace agent port |
| `WORKSPACE_AGENT_ADDR` | `0.0.0.0:4097` | Workspace agent bind address |
