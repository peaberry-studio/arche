## Why

Arche has two access levels today: each user's own workspace, and one Knowledge Base that every user of the deployment sees in full. There is no team, group, or project concept. `UserRole` is `USER | ADMIN`, the only workspace authorization rule is "owner of the slug, or ADMIN" (`lib/runtime/with-auth.ts`), and "team" in flows and on the Team page means "everyone in this deployment".

A company cannot put HR, legal, finance, or customer-specific knowledge in Arche, because every user and every agent would read it. Every user also gets every agent. The missing layer is the one teams actually work in: groups of people with shared, isolated knowledge and the agents that belong to them. This is what Claude Projects and ChatGPT Projects offer, plus the group-scoped access controls that Claude Enterprise and ChatGPT Enterprise offer.

The isolation has to be physical. Each workspace container holds a full clone of the KB at `/workspace`, and OpenCode's read, grep, and bash tools can read any path in it. A filter in the BFF or in the workspace-agent HTTP layer would not stop an agent from reading a restricted file. Restricted knowledge must never reach the container of a user who lacks access.

## What Changes

- **Teams.** Admins create teams and manage their members. A user can belong to any number of teams.
- **Knowledge spaces ("projects").** A knowledge space is an isolated KB: its own bare git repository, separate from the common `kb-content` repo. Admins create spaces and grant teams access as `VIEWER` (read-only) or `EDITOR` (read, propose, review, publish). The common KB stays exactly as it is, and every user keeps seeing it.
- **Physical isolation in the workspace.** A user's container mounts only the space repos they can access (`:ro` for viewers) and clones each one under `/workspace/_spaces/<space-slug>/`. A space the user cannot access is never mounted, so neither the user nor their agents can read it.
- **Multi-repo workspace git.** The workspace-agent recognizes `_spaces/<slug>/` paths as separate repositories. Diffs, status, sync, publish, conflicts, and discard work on each repo independently. The existing review → apply → publish flow therefore works for space files with no change to the user experience. Writes to viewer spaces are rejected.
- **Server-side enforcement.** Proposals (`learning_propose`, the curator, the review UI), applies, and publishes for `_spaces/<slug>/` paths check that the actor is an `EDITOR` of that space. External MCP and personal access tokens keep exposing only the common KB.
- **Agents scoped to teams.** An admin can restrict an agent in `CommonWorkspaceConfig` to one or more teams. Users outside those teams do not receive the agent in their runtime and do not see it in the agents list. The primary agent and the system `knowledge-curator` cannot be restricted.
- **Agent context.** The generated `AGENTS.md` lists the spaces the user can access, with path, name, description, and access level, so agents know where team knowledge lives.
- **Access changes take effect safely.** Gaining access shows the existing "config changed" banner, so the user restarts and gets the new mounts. Losing access (removed from a team, grant removed, space archived) stops the affected users' running workspaces right away, so revoked content does not stay readable. Every team and space mutation writes an `AuditEvent`.
- **Admin UI.** A Teams section next to the existing user management. A Knowledge spaces admin page for spaces and grants. A team picker in the agent editor. Space folders in the workspace file tree show their display name and a read-only badge.
- **Web only.** A new `knowledgeSpaces` runtime capability is `true` on web and `false` on desktop. Desktop behavior is unchanged.

## Capabilities

### New Capabilities
- `team-knowledge-spaces`: Teams and membership; isolated knowledge spaces with team grants (`VIEWER`/`EDITOR`); physical isolation in workspace containers; multi-repo review and publish; agent restriction by team; access-change propagation and audit.

### Modified Capabilities
- (none) The KB write policy (`kb-policy-prompt-sync`) and `workspace-startup` still hold unchanged. Space repos follow the same "persist only through proposals" policy.

## Impact

- **DB (additive only):** new tables `teams`, `team_members`, `knowledge_spaces`, `knowledge_space_grants`, and new enum `KnowledgeSpaceAccess`. Every new model also goes into `prisma/schema.sqlite.prisma` and the desktop DDL in `lib/prisma-desktop.ts`, to keep the two schemas at parity. Nothing existing is altered or dropped.
- **Web:**
  - New services in `src/lib/services/`: teams, knowledge spaces, and the access resolver.
  - New admin API routes under `src/app/api/u/[slug]/teams/**` and `src/app/api/u/[slug]/knowledge-spaces/**`.
  - Space checks in `lib/learning/*`, `app/api/internal/learning/proposals`, and `lib/learning/publish-kb.ts`.
  - Spawner binds and env (`lib/spawner/docker.ts`, `core.ts`), runtime artifacts and the `AGENTS.md` block (`lib/spawner/runtime-artifacts.ts`), agent filtering, and the capability flag.
  - UI under `src/components/team`, a new `src/components/knowledge-spaces`, the agent editor, and the workspace file tree.
- **Workspace image:**
  - `infra/workspace-image/init-workspace.sh` clones and prunes spaces.
  - `infra/workspace-image/workspace-agent/main.go` gets multi-repo git operations and read-only enforcement, plus Go tests.
  - `infra/workspace-image/tests/runtime-smoke.mjs`.
- **Infra:**
  - New host path `KB_SPACES_HOST_PATH` (default `/opt/arche/kb-spaces`), mounted into the web container at `/kb-spaces` and passed to the spawner.
  - Changes in `infra/compose/compose.yaml`, the Ansible templates, Coolify, and one-click.
  - New env vars are documented in `infra/README.md`.
- **Unchanged:** the common KB layout and paths, kickstart, GitHub KB sync (common KB only), external MCP (common KB only), desktop, connectors, and flows.
