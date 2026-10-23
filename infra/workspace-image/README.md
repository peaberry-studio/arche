# Arche Workspace Image

Image derived from OpenCode with support for a shared Knowledge Base (KB).

## Features

- Based on `ghcr.io/anomalyco/opencode`
- Includes `git` for KB sync
- Automatic workspace initialization script
- Workspace agent HTTP service for diffs and file operations
- Support for runtime config injected by the spawner (`opencode.json` and `AGENTS.md`)
- In-container stdio MCP tools for charts, diagrams, documents, email drafts, flows, learning, presentations, session scratch folders, session history and spreadsheets (`arche_tools_*`)

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

# Pinned legacy image, used only to archive V1 history (not release v6.0.0, which has 1.17.9)
podman build --build-arg OPENCODE_VERSION="$(cat ../../versions/opencode-v1.version)" -t arche-workspace:opencode-v1 -t arche-workspace:opencode-v1-1.18.18 .
```

`versions/opencode.version` pins V2 to 2.0.32; `versions/opencode-v1.version` pins V1 to 1.18.18. CI publishes both `workspace:opencode-v1` and `workspace:opencode-v1-1.18.18` (plus architecture suffixes) alongside the V2 image. OpenCode 2 is the only workspace runtime (`OPENCODE_IMAGE`). Use `OPENCODE_V1_IMAGE=ghcr.io/peaberry-studio/arche/workspace:opencode-v1-1.18.18` only for history export once that image has been published. There is no rollback to V1; do not roll the web image back past this release once any workspace has started on V2. See [the runtime migration guidance](../README.md#workspace-runtime).

From the repository root, `bash scripts/check-podman-images.sh` builds the V2 runtime and V1 archive images, runs credential-free container smoke checks, then builds the web image. It does not prune images or containers. Run infrastructure regressions with `node --test infra/workspace-image/tests/runtime-infrastructure.test.mjs`.

### Legacy archive helper

The helper bypasses workspace initialization and disables project config, MCP,
plugins and providers. It mounts the workspace read-only and the original V1
share/state volumes read-only at `/tmp/arche-archive-source/{share,state}`.
Before serving, it copies both complete stores (including SQLite WAL/SHM files)
into its disposable container layer under `/home/workspace/.local`. The pinned
V1 server cannot start directly on read-only state: its SQLite/log writes need
the writable copies. Removing the helper also removes those copies; the source
volumes are unchanged. The source container must be stopped and removed before
the copy is made.

`node infra/workspace-image/tests/archive-smoke.mjs` (from the repository root,
with the legacy image built) verifies root/child/message export, rejected writes
to all three source mounts, and unchanged share/state file contents, mtimes and
modes after helper shutdown.

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

The image includes `/opt/arche/arche-tools/server.js`, registered by the spawner as the local `arche_tools` MCP server (`node /opt/arche/arche-tools/server.js`). It has no harness plugin dependency. Agent tool maps and permissions are remapped at runtime; stored workspace configuration is not rewritten.

The adjacent `shared/scratch-isolation` directory is a separate OpenCode 2 permission
plugin, also copied into desktop bundles. It binds native file-tool scratch access
to the trusted calling session, including subagents: own scratch stays prompt-free;
other sessions and symlink escapes are denied. This is not shell or OS-user isolation.
Existing workspaces need updated runtime artifacts and a restart to load the guard.

Tool output remains JSON text (including chart, diagram and attachment payloads), also exposed as MCP structured content. Workspace-scoped internal API credentials are inherited by the stdio process, never passed as tool arguments. Learning and session history require explicit `caller_agent` plus harness session metadata (`ai.opencode/sessionID`) or an explicit `caller_session_id`. Missing or conflicting context returns `caller_identity_unavailable` without calling the internal API. Explicit identity is attribution, not authentication; workspace authorization remains on the internal API. Agents must not invent a session id when none is known.

Tool checks: from `arche-tools/`, run `pnpm install --ignore-scripts` and `pnpm test`. Regression calls use an in-process MCP client/server pair.

At startup, `entrypoint.sh` copies mounted runtime files into `/workspace`:

- copy `/tmp/arche-user-data/opencode-config.json` -> `/workspace/opencode.json`
- copy `/tmp/arche-user-data/AGENTS.md` -> `/workspace/AGENTS.md`
- replace `/workspace/.opencode/skills` from `/tmp/arche-user-data/skills` (complete skill directories)

OpenCode 2 discovers `/workspace/opencode.json`; no renamed config file is needed. V2 2.0.32 supports native Basic auth, so no proxy is needed. The entrypoint maps Arche's `OPENCODE_SERVER_PASSWORD` to V2's higher-priority `OPENCODE_PASSWORD`, preventing an inherited value from overriding the workspace password. Keep the runtime on the private container network.

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
| `ARCHE_SCRATCH_DIR` | `/tmp/arche-scratch` | Root of the per-session scratch folders used by `arche_tools_scratch_*` |
