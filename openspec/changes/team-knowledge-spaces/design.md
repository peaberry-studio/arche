## Context

See proposal.md (Why) for the motivation. The current state below shapes the approach. Paths are relative to `apps/web/` unless they start with `infra/`.

- **One KB per deployment.**
  - The content lives in the bare repo `kb-content` (`/kb-content` in the web container; host path `KB_CONTENT_HOST_PATH`, read by `lib/spawner/config.ts` `getKbContentHostPath()`).
  - `lib/spawner/docker.ts` `createContainer` bind-mounts it read-write into every workspace container (`binds.push(\`${kbContentHostPath}:/kb-content\`)`).
  - `infra/workspace-image/init-workspace.sh` clones it into `/workspace` and names the remote `kb`.
- **Workspace git is single-repo.** The Go `workspace-agent` (`infra/workspace-image/workspace-agent/main.go`) assumes one repository rooted at `/workspace` for:
  - the git endpoints: `/git/diffs`, `/git/conflict`, `/git/resolve`, `/git/discard`
  - the KB endpoints: `/kb/sync`, `/kb/status`, `/kb/publish` (`handleKbSync`, `fetchAndMergeKb`, `handleKbPublish`, `commitWorkspacePathsIfNeeded`, `verifyReviewManifestHashes`, `isReviewableKbPath`)
  - the file endpoints: `/files/*`, through `resolvePath` / `resolveRelPath`
- **Review is per workspace owner.**
  - `KnowledgeReviewChange` is keyed by the owner's `userId` and a free-form `kbPath`, with no repository id.
  - `lib/learning/proposal-application.ts` `applyKnowledgeReviewChange` writes through the owner's workspace agent.
  - `lib/learning/publish-kb.ts` `publishKnowledgeBasePaths` attests hashes and calls `/kb/publish`.
- **Agents read everything under `/workspace`.** The KB write policy denies edits (`guards.knowledgeWrites`, `injectAgentKnowledgePolicy`), but nothing restricts reads. Isolation therefore has to happen at the mount and clone layer.
- **Authorization is owner-or-ADMIN.**
  - The rule is in `lib/runtime/with-auth.ts` `withAuth`. There is no `requireAdmin` helper; routes check `role !== 'ADMIN'` inline.
  - Agents and skills are global, in kb-config `CommonWorkspaceConfig.json` (`lib/common-workspace-config-store.ts`, types in `lib/workspace-config.ts`). `lib/spawner/runtime-artifacts.ts` gives every user every agent.
- **Drift detection exists.** `core.ts` stores `hashWorkspaceRuntimeArtifacts(artifacts)` as `Instance.appliedConfigSha`, and `app/api/instances/[slug]/config-status` plus `components/workspace/config-change-banner.tsx` tell the user to restart when the regenerated artifacts differ.
- **Desktop shares the code.** It runs one local ADMIN user, one vault KB, and no containers. `prisma/schema.sqlite.prisma` mirrors every Postgres model, and the desktop DDL is hard-coded in `lib/prisma-desktop.ts`.
- **Zero-downtime deploys.** Old and new web versions run side by side against the same DB, and containers started by the old version keep running.

## Goals / Non-Goals

**Goals:**
- Admin-managed teams, plus isolated knowledge spaces granted to teams as `VIEWER` or `EDITOR`.
- Isolation enforced physically. A user without access never has the space's bytes in their container.
- The common KB and every existing flow (review, apply, publish, sync, GitHub sync) work exactly as today for users with no spaces.
- Space files use the same review → apply → publish UX as common-KB files.
- Agents can be restricted to teams.
- Additive migrations only; desktop unchanged.

**Non-Goals (follow-ups):**
- Team managers or delegated administration. Only ADMIN manages teams, spaces, and grants.
- Per-user grants. Grants go to teams only; an admin who needs a one-person grant creates a one-person team.
- Shared chat sessions, per-space default agents, team-scoped connectors, and team-scoped flows. `FlowVisibility.team` keeps meaning "organization".
- Exposing spaces through external MCP or personal access tokens, GitHub sync for space repos, and kickstart templates for spaces.
- Cross-user review. A viewer cannot propose changes to a space for an editor to approve.
- Desktop support for spaces.

## Decisions

### D1. A space is its own bare repo, never a folder of the common KB
Each space gets its own bare repo at `<kbSpacesRoot>/<spaceId>.git`.
- `kbSpacesRoot` is `/kb-spaces` in the web container. Add it next to `kbContentRoot()` in `lib/runtime/paths-web.ts` and `paths.ts`, following the existing pattern.
- On the host it is `KB_SPACES_HOST_PATH`, read by a new `getKbSpacesHostPath()` in `lib/spawner/config.ts` that mirrors `getKbContentHostPath()`.
- The repo is named by the immutable `id`, not the slug, so its path stays stable.
- At creation, the web app runs `git init --bare --initial-branch=main` through the `lib/git/bare-repo.ts` helpers and seeds one commit with `README.md` (space name and description), so clones never start from an empty repo.

*Rejected:* one repo with per-team folders plus sparse checkout. Git objects for every path would still be in the clone (`git show`, `git log -p`), so it is not isolation.

### D2. Workspace layout and mounts (cross-lane contract; both lanes MUST follow it exactly)
- The common KB stays at the root of `/workspace`, unchanged.
- Each accessible space is bind-mounted at `/kb-spaces/<space-slug>.git`: read-write for `EDITOR`, `:ro` for `VIEWER`.
- The spawner passes `ARCHE_KB_SPACES`, a JSON array of `{"slug":"<slug>","access":"VIEWER"|"EDITOR"}` sorted by slug. An empty array or an unset variable means no spaces.
- `init-workspace.sh` does the following for each entry:
  - if `/workspace/_spaces/<slug>/.git` is missing, clone `/kb-spaces/<slug>.git` into `/workspace/_spaces/<slug>` and rename `origin` to `kb`
  - otherwise ensure the `kb` remote points to the mount
  - set the same git author config and excludes as the root repo
- It then deletes every `/workspace/_spaces/<dir>` that is not in `ARCHE_KB_SPACES`. This is how revoked access is removed from the persistent volume.
- It adds `_spaces/` to the root repo's `.git/info/exclude`, so the common repo never tracks space files.
- The top-level name `_spaces` is reserved:
  - the BFF and the workspace agent reject a common-KB path whose first segment is `_spaces`
  - kickstart templates must not create it
- Space slugs match `^[a-z0-9][a-z0-9-]{1,47}$` and are immutable after creation, because `KnowledgeReviewChange.kbPath` stores `_spaces/<slug>/…` paths.

### D3. Multi-repo semantics in the workspace agent (cross-lane contract)
- **Repo resolution.** A workspace-relative path whose first two segments are `_spaces/<slug>` and where `/workspace/_spaces/<slug>/.git` exists belongs to repo `<slug>`. Every other path belongs to the common repo. Paths in every request and response stay workspace-relative (they include the `_spaces/<slug>/` prefix), so the existing response shapes stay valid.
- **`/git/diffs`.** Aggregates the diffs of the common repo and every space repo, prefixing space paths.
- **`/git/conflict`, `/git/resolve`, `/git/discard`.** Operate on the repo that owns the given path.
- **`/kb/status`.** Keeps its existing fields for the common repo and adds `spaces: [{slug, access, ahead, behind, dirty, conflicts}]`.
- **`/kb/sync`.** Syncs the common repo first (existing behavior, including the GitHub remote), then every space repo with `fetchAndMergeKb` semantics. It keeps the existing top-level result fields for the common repo and adds `spaces: [{slug, status, error?}]`. A space failing to sync does not fail the common sync.
- **`/kb/publish`.**
  - Groups the requested paths by repo and runs the existing publish steps (conflict gate, commit, fetch and merge, `verifyReviewManifestHashes`, push) per repo.
  - The common repo goes first, then spaces in slug order.
  - The GitHub remote push applies only to the common repo.
  - Keeps the existing top-level fields, describing the common repo when it had paths, and adds `repos: [{space: null|"<slug>", status, commitSha?, error?}]`.
  - If any repo fails, the response reports a failure and names the failed repos. Repos that already pushed stay pushed (no cross-repo atomicity; see Risks).
- **Read-only spaces.** The agent reads `ARCHE_KB_SPACES`.
  - `/files/write`, `/files/delete`, `/files/rename`, `/files/apply_patch`, `/files/upload`, `/git/resolve`, and `/git/discard` on a path in a `VIEWER` space return HTTP 403 with `{ "error": "read_only_space" }`.
  - A rename or patch that spans two repos returns 400 `{ "error": "cross_repo_operation" }`.
  - `/kb/publish` for a viewer space fails with `read_only_space`.
  - The `:ro` mount enforces the same rule at the filesystem level.
- **Common-root reservation.** `isReviewableKbPath` keeps excluding dot segments and `.arche`. A `_spaces/...` path is reviewable only when it resolves to a mounted space repo.

### D4. Data model (additive; Postgres and SQLite parity)
```prisma
enum KnowledgeSpaceAccess { VIEWER EDITOR }

model Team {            // @@map("teams")
  id, slug @unique, name, description?, createdAt, updatedAt, archivedAt?
  members TeamMember[]; grants KnowledgeSpaceGrant[]
}
model TeamMember {      // @@map("team_members")
  id, teamId -> Team (Cascade), userId -> User (Cascade), createdAt
  @@unique([teamId, userId]); @@index([userId])
}
model KnowledgeSpace {  // @@map("knowledge_spaces")
  id, slug @unique, name, description?, createdById? -> User (SetNull), createdAt, updatedAt, archivedAt?
  grants KnowledgeSpaceGrant[]
}
model KnowledgeSpaceGrant { // @@map("knowledge_space_grants")
  id, spaceId -> KnowledgeSpace (Cascade), teamId -> Team (Cascade), access KnowledgeSpaceAccess, createdAt, updatedAt
  @@unique([spaceId, teamId]); @@index([teamId])
}
```
- Follow the repo's conventions: snake_case `@map` columns, `cuid()` ids, back-relations on `User`.
- Mirror the models in `schema.sqlite.prisma` (with strings in place of enums, following how existing enums are handled there) and in the `lib/prisma-desktop.ts` DDL, with a regression test the way existing desktop models are covered.
- Create the migration with `pnpm db:migrate`. It must contain only `CREATE TYPE`, `CREATE TABLE`, and `CREATE INDEX` statements.
- Archive is a soft delete (`archivedAt`). An archived space is never mounted, and its repo stays on disk.

### D5. One access resolver, used everywhere
`lib/services/knowledge-space-access.ts` exports `resolveKnowledgeSpaceAccess(userId): Promise<ResolvedSpaceAccess[]>`, returning `[{ spaceId, slug, name, description, access }]` for non-archived spaces, sorted by slug.
- A user's access to a space is the strongest grant across their non-archived teams: `EDITOR` beats `VIEWER`.
- `ADMIN` users have implicit `EDITOR` on every non-archived space.
- On desktop (`knowledgeSpaces` capability false), the resolver returns `[]` without touching the DB.
- Every consumer uses this function or `getKnowledgeSpaceAccess(userId, slug)`: spawner mounts, the `AGENTS.md` block, BFF learning, publish checks, file-tree labels, and agent filtering. Nothing else reads grants directly.
- Service functions return typed `Result` objects (AGENTS.md conventions).

### D6. Server-side enforcement for space paths
Every operation that names a `_spaces/<slug>/…` path checks `getKnowledgeSpaceAccess(ownerUserId, slug)` and fails with a typed error unless access is `EDITOR`:
- the internal `learning_propose` route (`app/api/internal/learning/proposals`)
- the curator run executor (`lib/learning/run-executor.ts`)
- review UI create, apply, and publish (`app/api/u/[slug]/learning/proposals`, `lib/learning/proposal-application.ts`, `lib/learning/publish-kb.ts`)
- workspace write server actions (`actions/workspace-agent.ts`)

The owner is the workspace owner, which matches today's per-owner review model. The check also re-runs at apply and publish time, so access revoked after a proposal was created blocks the apply. `isValidKbPath` (`lib/learning/validation.ts`) accepts `_spaces/<slug>/<rest>` only when the slug matches the slug pattern. `lib/mcp/kb-content-store.ts` keeps reading only the common repo.

### D7. Spawner and runtime artifacts
- `buildWorkspaceRuntimeArtifacts` takes the resolved spaces as input and adds two things to the hashed artifacts, so any grant change alters `appliedConfigSha` and the existing banner prompts a restart:
  - `spaces: [{slug, access}]`
  - an `AGENTS.md` block, `## Knowledge spaces`, that lists `_spaces/<slug>/`, the name, the description, and the access level, and states that viewer spaces are read-only and that the KB write policy applies to every space
- `docker.createContainer` adds one bind per space (`<host>/<spaceId>.git:/kb-spaces/<slug>.git`, with `:ro` for viewers) and the `ARCHE_KB_SPACES` env var.
- Containers created by the old web version have no space mounts. They show the drift banner after deploy, which is correct.

### D8. Revocation stops running workspaces
After a mutation that can reduce access commits, the service computes the users whose resolved space set lost a space or dropped from `EDITOR` to `VIEWER`, and stops each one's running instance through the existing spawner stop path. These mutations are: remove a member, delete or archive a team, remove a grant or downgrade it, and archive a space.
- Each stop is audited as `knowledge_space.access_revoked_stop`, with `{ userId, spaceSlug }`.
- Gaining access never stops a workspace; the drift banner handles it.
- On the next start, `init-workspace.sh` deletes the clone of any space no longer granted (D2). Unpublished edits in a revoked space are lost by design: the user no longer has the right to them.

### D9. Agents restricted by team
- `CommonAgentConfig` (`lib/workspace-config.ts`) gets an optional `teamIds?: string[]`. Absent or empty means everyone.
- `buildBaseWorkspaceConfig` / `buildWorkspaceRuntimeArtifacts` drop restricted agents for a user who is in none of the listed teams. ADMIN users receive every agent. This runtime-only transform never rewrites the stored config, matching `kb-policy-prompt-sync`.
- `GET` agents filters the same way for non-admins. The `PATCH`/`POST` agent routes reject `teamIds` on the primary agent and on `knowledge-curator` with 400 `{ error: "agent_not_restrictable" }`, and reject unknown team ids with 400 `{ error: "unknown_team" }`.
- Agent mentions and delegation targets also skip agents the user cannot see, so a visible agent never delegates to one the user does not have.
- Removing a team leaves stale ids in `teamIds`, which the filter ignores. The filter treats an agent whose only ids are stale as restricted to nobody except admins. The agent editor shows those stale ids as "deleted team".

### D10. Capability and gating
- Add `knowledgeSpaces: boolean` to `RuntimeCapabilities`: `true` on web, `false` on desktop.
- Team and space admin routes use `requireCapability('knowledgeSpaces')` plus an ADMIN check, written the way existing admin routes do it inline. Do not add a new global helper unless it removes the duplication in the touched routes.
- Admin API routes:
  - `GET/POST /api/u/[slug]/teams`
  - `GET/PATCH/DELETE /api/u/[slug]/teams/[teamId]`
  - `POST /api/u/[slug]/teams/[teamId]/members`, `DELETE /api/u/[slug]/teams/[teamId]/members/[userId]`
  - `GET/POST /api/u/[slug]/knowledge-spaces`
  - `GET/PATCH/DELETE(archive) /api/u/[slug]/knowledge-spaces/[spaceId]`
  - `PUT /api/u/[slug]/knowledge-spaces/[spaceId]/grants`, with body `{ grants: [{ teamId, access }] }` (full replace)
- Errors use `{ error: string }` with explicit status codes, and every mutation writes an `AuditEvent`:
  - `team.created`, `team.updated`, `team.archived`, `team.member_added`, `team.member_removed`
  - `knowledge_space.created`, `knowledge_space.updated`, `knowledge_space.archived`, `knowledge_space.grants_updated`
- Non-admin users get `GET /api/u/[slug]/knowledge-spaces/mine`, which returns their own resolved spaces for the workspace UI.

### D11. UI
Use existing shadcn/ui components and existing page patterns (`components/team/*` is the reference). Copy is in English, like the rest of the app.
- **Team page.** Adds a "Teams" section (admin): create, rename, or archive a team, and add or remove members from the existing user list.
- **New "Knowledge spaces" admin page** (`app/u/[slug]/knowledge-spaces`), linked from the same navigation as Team when the capability is on: create a space (name, slug, description), edit, archive, and a grants editor (team × VIEWER/EDITOR).
- **Agent editor.** A multi-select labeled "Available to", where empty means everyone. It is disabled for the primary agent and the curator.
- **Workspace file tree and knowledge navigation.** The `_spaces` folder renders as "Spaces", and each `<slug>` folder shows the space name, with a read-only badge for viewer spaces. Write actions (new file, rename, delete, edit) are hidden in viewer spaces. The review panel groups changes by space.

### D12. Infra
- Add `KB_SPACES_HOST_PATH` (default `/opt/arche/kb-spaces`; `~/.arche/kb-spaces` in local dev, next to the existing defaults). Mount it at `/kb-spaces` in the web service in `infra/compose/compose.yaml`, `infra/deploy/ansible/roles/app/templates/compose.yml.j2` (+ `.env.j2`), `infra/coolify/docker-compose.yml`, and `infra/one-click/main.go`, wherever `KB_CONTENT_HOST_PATH` appears.
- The deploy script creates the directory the way it creates `kb-content`, but without `git init`; the app creates repos per space.
- Document the variable in `infra/README.md`. Do not edit `apps/web/.env.example`; Convoy's secret guard refuses it.

## Risks / Trade-offs

- **No cross-repo atomicity in a publish.** Publishing paths from two repos can push one and fail the other. The response names the failed repos, and the review panel keeps their changes in `applied` so the user can retry. Each `KnowledgeReviewChange` touches one path in one repo, so no single change is ever half-published.
- **Revocation stops work in progress.** Stopping a workspace interrupts a running chat. This is the security-first choice. The alternative, keeping revoked content readable until the user restarts, is not acceptable for HR or legal spaces.
- **Viewers cannot contribute.** Cross-user review is a non-goal, so viewers are strictly read-only in v1.
- **Disk.** Each user with access holds a full clone of each space. This is acceptable at the scale of a team KB, the same as the common KB today.
- **Slug immutability.** Renaming a space changes only its display name. Changing a slug would need a path migration of open review changes, and it is not supported.
- **Old containers during a deploy.** Workspaces started before the deploy keep running without spaces, and they hold no space data, so this is safe. The drift banner prompts a restart.

## Migration Plan

Two implementation lanes run in parallel on separate branches, joined by the contract in D2 and D3:
- **Lane web** (`feat/team-knowledge-spaces`): task groups 1–5.
- **Lane runtime** (`feat/team-knowledge-spaces-runtime`): task group 6. It touches only `infra/workspace-image/**`.

The runtime branch merges into the web branch before task group 7 (integration verification, audits, scoring).

Deploy is a single additive migration. Rollback is to redeploy the previous version. The new tables are ignored, and any space-aware containers get recreated without space mounts on the next start by the old spawner. Space clones left in the volumes stay excluded from the root repo by `.git/info/exclude`, and the old UI shows them as ordinary folders. Document in `infra/README.md` that after a rollback an admin can remove them by deleting `_spaces/` from the workspace volumes.
