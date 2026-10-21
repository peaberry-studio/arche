# Infra

This directory contains everything needed to run Arche as a full stack (local and VPS): reverse proxy, database, networks, and hardening.

## Entry Points

- Local development stack (Traefik + Postgres + Web): `infra/compose/README.md`
- One-click deployer (VPS + local-dev): `infra/deploy/README.md`
- Coolify deployment (VPS with Coolify): `infra/coolify/README.md`
- Workspace image (OpenCode + git): `infra/workspace-image/README.md`

## Workspace runtime

Workspaces run OpenCode 2 (`OPENCODE_IMAGE`). OpenCode 1 is no longer a runtime:
`OPENCODE_V1_IMAGE` is the pinned legacy image used only to read the V1 history of
existing workspaces once, when they first start on OpenCode 2:

```text
OPENCODE_V1_IMAGE=ghcr.io/peaberry-studio/arche/workspace:opencode-v1-1.18.18
```

For arm64, use the `opencode-v1-1.18.18-arm64` tag. The workspace image workflow
publishes both tags from `main`; they must exist before deploying. The old
`v6.0.0` release is **not** this legacy pin: it contains OpenCode 1.17.9, not
1.18.18. Update existing deployment overrides as well as examples; the code
default cannot override an explicitly configured old value. For local
validation, `infra/deploy/deploy.sh --local-dev` builds
`arche-workspace:opencode-v1-1.18.18` next to `arche-workspace:latest`.

V1 and V2 keep separate state: `arche-opencode-share-*` / `arche-opencode-state-*`
for V1 (read only by the archive helper) and `arche-opencode2-share-*` /
`arche-opencode2-state-*` for V2. Desktop bundles the OpenCode 1 binary for the
same one-time archive and keeps V2 data in `.runtime/opencode-v2`.

### First start of an existing V1 workspace

A workspace recorded as V1 (or with no recorded kind) is not served until it
restarts. A V1 workspace still running after the deploy reports as stopped, so the
next open or flow starts it:

1. The workspace shows "migrating history" while its V1 conversations (roots and
   subagent children) are exported to `legacy_session_archives`, through the
   still-running V1 container or a temporary pinned V1 helper with project config,
   plugins, MCP and providers disabled and a read-only workspace mount. The
   helper and the old container are removed before V2 serves.
2. V2 starts on the V2 volumes. Archived conversations are listed with an
   "Archived" marker and open read-only.
3. If the export fails, the start fails with `legacy_archive_failed` and the next
   start retries it. Nothing is lost: the V1 volumes are never written. In-flight
   V1 message and flow runs are settled with `runtime_migrated` only after a
   successful export; Slack bindings to archived sessions rebind to a new session
   on the next message.

The reaper pre-archives running V1 workspaces in the background, one at a time,
so most first starts only export what changed since. Startup, stop and reaper
transitions are attempt-scoped; stop requests are refused while startup owns the
instance.

There is no rollback to V1. A web build from before this release cannot serve V2
workspaces, so do not roll the web image back past it once any workspace has
started on V2. Validate the release on staging first.

### Retiring V1 share volumes (contract phase only)

`scripts/cleanup-legacy-volumes.mjs` is preparation for task 8.2, **not a deploy
step**. Run it only after every workspace has started on V2 at least once, so its
history is archived. Deletion permanently removes the original V1 history. Keep the
V1 reader, image/binary and volumes until separate contract-phase approval.

Run on the workspace Podman host with Node.js and access to its PostgreSQL
container (`psql` runs inside that container). Select the correct Podman
connection and database explicitly; the defaults are database `arche`, role
`postgres` (override with `--database` / `--db-user`). First inspect the dry run
(replace `arche-postgres` with the actual database container name):

```bash
node scripts/cleanup-legacy-volumes.mjs --postgres-container arche-postgres
```

The script only considers exact `arche-opencode-share-<slug>` volumes. It retains
missing/non-V2 instances, error/starting instances, missing or structurally
incomplete archives, and volumes referenced by **any** container, even stopped
containers or archive helpers. Any starting workspace or running non-V2 instance
blocks eligibility globally. Query/Podman failures abort cleanup.

Archive rows can be partial pre-archive output: there is no final-export marker
in the database, and a row count cannot prove completeness. A human must verify
the final export against the original V1 root/child session inventory and messages,
verify archived conversations in the UI, back up both database and original volume,
and record only verified workspaces in an approvals file, for example:

```json
[
  { "slug": "alice", "archiveComplete": true, "archivedSessionCount": 40 }
]
```

Zero-session workspaces are deliberately retained; this script cannot verify an
empty export. Preserve any workspace with uncertain or incomplete history. The
approvals file is an operator attestation, not an automatically generated proof.
Do not commit it. Then review and retain the staging dry-run output:

```bash
node scripts/cleanup-legacy-volumes.mjs --postgres-container arche-postgres --approvals /secure/verified-archives.json
```

Only after V2 acceptance and backup verification: pause **all** starts/restarts
(including web, flows, reaper and external automation), confirm that no old web
build can start V1,
then repeat the reviewed command with explicit destructive-operation guards:

```bash
node scripts/cleanup-legacy-volumes.mjs --postgres-container arche-postgres --approvals /secure/verified-archives.json --apply --confirm-retire-v1-rollback --confirm-starts-paused
```

The script rechecks database eligibility, approvals and attachments immediately
before each deletion and never uses forced removal. The pause is an operator
precondition, not an automated deployment lock: checks cannot prevent a concurrent
start by themselves. Capture the output as the operator cleanup record. Archive
rows, workspace data, V2 volumes and runtime configuration are never changed.
Staging dry-run verification and any actual deletion remain human-owned; task 8.2
stays unchecked until its staging verification is performed.

Local regression checks use fake Podman/database responses only:
`node --test scripts/__tests__/cleanup-legacy-volumes.test.mjs`.

## Session scratch folders

Agents cannot write to the Knowledge Base, so each session gets a private scratch
folder where they read, write, edit files and run commands without asking:

- `arche_tools_scratch_dir` creates and returns `/tmp/arche-scratch/<session id>`.
  The runtime config allows edits only under that root (an agent without write
  tools still cannot write there) and lets agents read it without the external
  directory prompt.
- In the workspace container the root is a tmpfs capped by `ARCHE_SCRATCH_SIZE_MB`
  (web env, default `512`): it never fills the host disk and is wiped when the
  container restarts. Desktop uses `<OS temp dir>/arche-scratch`.
- Folders of other sessions untouched for 24 hours are removed whenever a session
  opens its own.
- Results leave the scratch folder through `arche_tools_scratch_publish` (a copy in
  the workspace attachments, which the user can open and download) or as a
  Knowledge Base proposal with `arche_tools_learning_propose`.

## Knowledge Base (KB)

The system includes a shared Knowledge Base injected into each user workspace.

### Architecture

```
Host (VPS)
├── /opt/arche/kb-content/   ← KB content bare repo
├── /opt/arche/kb-config/    ← Config bare repo
│
└── Containers (per user)
└── /workspace/          ← Persistent volume
    ├── .git/            ← Local repo with `kb` remote
    ├── Company/         ← Generated by kickstart during initial setup
    ├── ...
    └── opencode.json    ← Generated at runtime from kb-config
```

### KB Setup

1. **Build the workspace image** (includes git):
   ```bash
   cd infra/workspace-image
   podman build --build-arg OPENCODE_VERSION="$(cat ../../versions/opencode.version)" -t arche-workspace:latest .
   ```

2. **Initialize KB and config bare repos (empty)**:
   ```bash
   ./scripts/deploy-kb.sh /opt/arche/kb-content
   ./scripts/deploy-config.sh /opt/arche/kb-config
   ```

3. **Set environment variables** in compose or production:
   ```
   KB_CONTENT_HOST_PATH=/opt/arche/kb-content
   KB_CONFIG_HOST_PATH=/opt/arche/kb-config
   ```

### Sync

On a fresh installation, the workspace remains blocked until kickstart is completed at `/u/[slug]/kickstart`, which writes initial KB content and config.

Users can sync their workspace with the central KB:

1. **From the UI**: "Sync KB" button in the workspace header
2. **Manually** (inside container):
   ```bash
   git fetch kb
   git merge kb/main
   ```

If conflicts appear, the user resolves them in the integrated editor.
