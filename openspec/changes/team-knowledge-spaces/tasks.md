Lanes (design "Migration Plan"):
- Groups 1–5 are **lane web** (branch `feat/team-knowledge-spaces`).
- Group 6 is **lane runtime** (branch `feat/team-knowledge-spaces-runtime`, touches only `infra/workspace-image/**`).
- Group 7 runs after the runtime branch is merged into the web branch.

Paths are relative to `apps/web/` unless noted.

## 1. Data model, capability, access resolver (D4, D5, D10)

- [ ] 1.1 Add `KnowledgeSpaceAccess`, `Team`, `TeamMember`, `KnowledgeSpace`, `KnowledgeSpaceGrant` to `prisma/schema.prisma`, with the back-relations on `User`. Create the migration with `pnpm db:migrate`. Verify the SQL contains only `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` / foreign keys.
- [ ] 1.2 Mirror the models in `prisma/schema.sqlite.prisma` and the DDL in `lib/prisma-desktop.ts`, following the existing pattern. Run `pnpm prisma:generate:all`. Verify with the existing desktop schema/DDL tests, extended for the new tables.
- [ ] 1.3 Add `knowledgeSpaces` to `RuntimeCapabilities` (web `true`, desktop `false`). Verify with capability tests.
- [ ] 1.4 Add `lib/services/teams.ts` (CRUD, archive, add/remove member; typed `Result`s) and `lib/services/knowledge-spaces.ts` (create with bare repo + seed commit under `getKbSpacesRoot()`, update without slug change, archive, replace grants). Add `kbSpacesRoot` to the runtime paths. Verify with unit tests, including slug validation, duplicate slug, immutable slug, and repo creation against a temp dir.
- [ ] 1.5 Add `lib/services/knowledge-space-access.ts` with `resolveKnowledgeSpaceAccess(userId)` and `getKnowledgeSpaceAccess(userId, slug)` (D5). Verify with table-driven tests: strongest grant wins, archived team, archived space, ADMIN gets all spaces as EDITOR, desktop returns `[]`.

## 2. Admin APIs, audit, revocation (D8, D10)

- [ ] 2.1 Add the team routes listed in D10, with ADMIN + capability gating, `{ error }` payloads, explicit statuses, and audit events. Verify with route tests: 403 for USER, 404 for a missing team, duplicate member, audit written.
- [ ] 2.2 Add the knowledge-space routes listed in D10, including `PUT …/grants` (full replace, unknown team → 400) and `GET …/knowledge-spaces/mine`. Verify with route tests.
- [ ] 2.3 Add revocation propagation (D8): after a member removal, team archive, grant removal or downgrade, or space archive, compute the users who lost access or were downgraded, stop their running instances through the existing spawner stop path, and audit `knowledge_space.access_revoked_stop`. Verify with tests: a removal stops the instance, a grant does not stop it, a downgrade stops it, a user still covered by another team is not stopped.

## 3. Runtime wiring and enforcement (D2, D6, D7, D9, D12)

- [ ] 3.1 `lib/spawner/config.ts` `getKbSpacesHostPath()`. In `docker.createContainer`, add one bind per resolved space (`:ro` for VIEWER) and `ARCHE_KB_SPACES` (JSON sorted by slug), exactly as in D2. Verify with docker tests asserting the binds and env for none, viewer, and editor spaces.
- [ ] 3.2 Pass the resolved spaces into `buildWorkspaceRuntimeArtifacts`. Include `spaces` in the hashed artifacts and append the `## Knowledge spaces` block to the generated `AGENTS.md` (D7). Verify that the hash changes when the space set or the access level changes, that the block lists paths and access, and that output is unchanged when there are no spaces.
- [ ] 3.3 Add the agent team restriction (D9): `teamIds` in `CommonAgentConfig`, the runtime filter in artifact generation, `GET` agents filtering, mention and delegation filtering, and `agent_not_restrictable` / `unknown_team` validation in the agent write routes. Verify with transform and route tests, including that the stored config is not mutated.
- [ ] 3.4 Enforce D6: add `_spaces/<slug>/…` support to `isValidKbPath` and reject `_spaces` as a common-KB top-level name elsewhere. Add EDITOR checks to the internal `learning_propose` route, the curator run executor, the review create/apply/publish flows, and the workspace write server actions. Handle the new `/kb/publish` and `/kb/sync` response fields (`repos`, `spaces`) in `publish-kb.ts` and the sync route, keeping the existing behavior for common-only results. Verify with tests: viewer rejected, revoked-after-proposal rejected at apply and publish, common paths unaffected, a multi-repo partial failure keeps the failed changes `applied`.
- [ ] 3.5 Confirm that `lib/mcp/kb-content-store.ts` and `listRecentKbFileUpdates` read only the common repo. Add a test that guards it.
- [ ] 3.6 Infra (D12): add `KB_SPACES_HOST_PATH` and the `/kb-spaces` mount wherever `KB_CONTENT_HOST_PATH` appears (compose, Ansible templates + `.env.j2`, Coolify, one-click `main.go`). Create the directory in the deploy script and document it in `infra/README.md`, including the rollback note from the design. Do not touch `apps/web/.env.example`. Verify by grepping that every location carrying `KB_CONTENT_HOST_PATH` now also carries `KB_SPACES_HOST_PATH`, and with `go test ./...` in `infra/one-click` if it has tests.

## 4. UI (D11)

- [ ] 4.1 Add a Teams section to the Team page (admin only, capability-gated): create, rename, archive, add/remove members. Verify with component tests in the style of `components/team/__tests__`.
- [ ] 4.2 Add the Knowledge spaces admin page `app/u/[slug]/knowledge-spaces` with list, create, edit, archive, and the grants editor, plus a navigation entry next to Team. Verify with component and page tests.
- [ ] 4.3 Add the "Available to" team multi-select in the agent editor, disabled for the primary agent and the curator, with stale ids shown as "deleted team". Verify with component tests.
- [ ] 4.4 Workspace file tree, knowledge navigation, and review panel: show the `_spaces` folder as "Spaces", label each space folder with the space name from `knowledge-spaces/mine`, add a read-only badge, hide write actions in viewer spaces, and group review changes by space. Verify with component tests.
- [ ] 4.5 Manual UI walkthrough on a local stack with two users and two teams (needs a human: implement everything, leave unticked, report).

## 5. Lane web verification

- [ ] 5.1 Run `pnpm test` and `pnpm lint` from `apps/web/` and get both green.
- [ ] 5.2 Run `pnpm exec tsc --noEmit` from `apps/web/` and get it green.

## 6. Lane runtime: workspace image (D2, D3) — only `infra/workspace-image/**`

- [ ] 6.1 In `init-workspace.sh`: parse `ARCHE_KB_SPACES`, then clone, re-point, or prune `/workspace/_spaces/<slug>` exactly as in D2. Apply the same git author and excludes, and add `_spaces/` to the root repo's `.git/info/exclude`. Keep the behavior identical when the variable is unset or `[]`. Verify with a shell test under `infra/workspace-image/tests/` covering a fresh clone, an existing clone, pruning, and no spaces.
- [ ] 6.2 In `workspace-agent/main.go`: add repo resolution for `_spaces/<slug>/` paths and run `/git/diffs`, `/git/conflict`, `/git/resolve`, and `/git/discard` per repo (D3). Verify with `main_test.go` cases that use temporary bare repos: an aggregated diff with prefixed paths, and discard and resolve inside a space.
- [ ] 6.3 Make `/kb/status`, `/kb/sync`, and `/kb/publish` multi-repo, with the D3 response fields, per-repo grouping, the common repo first, GitHub push for the common repo only, and partial-failure reporting. Verify with Go tests: a space-only publish, a mixed publish, one failing repo, a sync where one space fails, and existing common-only behavior unchanged (the existing tests still pass).
- [ ] 6.4 Enforce read-only spaces and cross-repo rejection in the file and git endpoints (`read_only_space` 403, `cross_repo_operation` 400). Reject a common-KB `_spaces` path that is not a mounted space. Verify with Go tests.
- [ ] 6.5 Extend `infra/workspace-image/tests/runtime-smoke.mjs` (or add a sibling smoke) with one viewer space and one editor space. Run `go test ./...` in `infra/workspace-image/workspace-agent` and get it green. Run `bash scripts/check-podman-images.sh` from the repo root and get it green.

## 7. Integration (after merging lane runtime into lane web)

- [ ] 7.1 Check end to end that the BFF handles the agent's real multi-repo responses (`repos`, `spaces`, `read_only_space`). Fix any contract mismatch on whichever side deviates from D3.
- [ ] 7.2 Run `pnpm test`, `pnpm lint`, and `pnpm exec tsc --noEmit` from `apps/web/`; `go test ./...` in `infra/workspace-image/workspace-agent`; and `bash scripts/check-podman-images.sh` from the repo root. All must be green.
- [ ] 7.3 Run `openspec validate team-knowledge-spaces --strict` and get it to validate.
