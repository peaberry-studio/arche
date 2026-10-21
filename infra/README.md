# Infra

This directory contains everything needed to run Arche as a full stack (local and VPS): reverse proxy, database, networks, and hardening.

## Entry Points

- Local development stack (Traefik + Postgres + Web): `infra/compose/README.md`
- One-click deployer (VPS + local-dev): `infra/deploy/README.md`
- Coolify deployment (VPS with Coolify): `infra/coolify/README.md`
- Workspace image (OpenCode + git): `infra/workspace-image/README.md`

## Workspace runtime selection

New starts use `ARCHE_DEFAULT_RUNTIME_KIND`, which defaults to `opencode-v2`.
Running instances keep their recorded kind (null means V1) until they restart;
this is never an in-place switch. `OPENCODE_IMAGE` is the V2 workspace image and
`OPENCODE_V1_IMAGE` the pinned legacy image used to archive V1 history and for
rollback:

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
for V1 and `arche-opencode2-share-*` / `arche-opencode2-state-*` for V2. Desktop
bundles both binaries and keeps V2 data in `.runtime/opencode-v2`.

### First V2 start of an existing workspace

When a workspace recorded as V1 starts while the default is V2:

1. The workspace shows "migrating history" while its V1 conversations (roots and
   subagent children) are exported to `legacy_session_archives`, through the
   running V1 container or a temporary pinned V1 helper with project config,
   plugins, MCP and providers disabled and a read-only workspace mount. The
   helper is removed before either runtime serves.
2. V2 starts on the V2 volumes. Archived conversations are listed with an
   "Archived" marker and open read-only.
3. If the export fails, the workspace starts on V1 and retries on its next start.
   In-flight V1 message and flow runs are settled with `runtime_migrated` only
   after a successful export; Slack bindings to archived sessions rebind to a new
   session on the next message.

The reaper pre-archives running V1 workspaces in the background, one at a time,
so most first starts only export what changed since. Startup, stop and reaper
transitions are attempt-scoped; stop requests are refused while startup owns the
instance.

### Rollback

Set `ARCHE_DEFAULT_RUNTIME_KIND=opencode-v1` in the env consumed by **web, flows
and reaper**, recreate those services with the normal deployment procedure, and
stop/start the affected workspaces. They start on their untouched V1 volumes with
the original V1 conversations live; archive rows are hidden on V1. Conversations
created on V2 stay on the V2 volumes and reappear when the workspace runs V2
again, and that switch only archives the V1 conversations created in between.

The database is not rolled back. Do not revert to a pre-seam web build while V2
instances still run: it cannot dispatch their recorded adapter. Keep both runtime
images and both volume families until the contract phase below.

Known V1-only gap: on V1, the session history and knowledge proposal tools called
from chat fail with `caller_identity_unavailable`, because OpenCode 1 does not
forward session metadata to MCP servers. Learning runs pass their session
explicitly and are unaffected.

### Retiring V1 share volumes (contract phase only)

`scripts/cleanup-legacy-volumes.mjs` is preparation for task 8.2, **not a deploy
step**. Do not apply it during this branch's rollout or while V1 rollback is still
required. Deletion permanently removes the original runnable V1 history. Keep the
V1 adapter, image/binary and volumes until separate contract-phase approval.

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

Only after V2 acceptance, rollback retirement approval and backup verification:
pause **all** starts/restarts (including web, flows, reaper and external automation),
confirm V2 defaults across deployments and that no old web build can start V1,
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
