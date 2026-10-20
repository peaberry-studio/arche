## 1. Spike and contract foundation

- [x] 1.1 Time-boxed spike (≤1 day) against a real OpenCode 2.x container built from `ghcr.io/anomalyco/opencode:<2.x>`: confirm headless serve command and flags, auth (basic auth or none), health endpoint, event stream endpoint and event type names, session/permission/abort/children endpoints in `@opencode/client`, provider auth sync and dispose equivalents, MCP tool-id prefixing, MCP `_meta` forwarding to stdio servers, and how to opt a server out of Code Mode. Deliver `apps/web/src/lib/harness/adapters/opencode-v2/NOTES.md` with a v1→v2 operation table; verify every contract operation in design D1 has a mapped endpoint or a written workaround.
- [x] 1.2 Create `apps/web/src/lib/harness/{contract,events,errors,registry,execution}.ts` with the `HarnessRuntime` type (operations from spec `harness-runtime`, including provider-access sync), the versioned Arche event union and part kinds (spec `workspace-event-stream`) and stable error codes (`session_not_found`, `session_busy`, `session_archived`, `runtime_unsupported`, `execution_termination_unconfirmed`, `caller_identity_unavailable`); verify with `pnpm exec tsc --noEmit` and an ACP mapping table (contract operation → ACP method or Arche-side answer) added to `NOTES.md` (D4).
- [x] 1.3 Move UI-facing types from `src/lib/opencode/types.ts` to `src/types/workspace-runtime.ts` (and file-tree types to `src/types/workspace.ts`), update imports in components/hooks/contexts/types; verify `pnpm exec tsc --noEmit` and `pnpm test` pass with no behavior change.

## 2. OpenCode v1 adapter and BFF event translation

- [x] 2.1 Create `src/lib/harness/adapters/opencode-v1/` by moving `client.ts`, `client-factory.ts`, `connection-resolver.ts`, `providers.ts`, `permission.ts`, `transform.ts`, `workspace-prompt.ts`, `session-utils.ts` and their `__tests__`; implement `HarnessRuntime` primitives on top of them; verify the moved tests pass unchanged.
- [x] 2.2 Move orchestration from `session-execution.ts` (prompt-run creation, abort-family-and-confirm-idle, wait-for-completion, cursor capture, latest-assistant-reply) into `src/lib/harness/execution.ts` written against contract primitives; verify existing `session-execution` tests, ported to run against a fake `HarnessRuntime`, pass.
- [x] 2.3 Implement `registry.ts` `getRuntimeForSlug(slug)` returning the v1 adapter for every instance (runtime kind arrives in group 5) and `runtime_unsupported` for unknown kinds; verify with unit tests.
- [x] 2.4 Implement the v1 event translator (OpenCode event → Arche events) from the field-extraction logic in `event-reducer.ts`; record v1 event-stream fixtures (text streaming, tool call, permission ask/reply, subagent child session, error, file touch) and add golden tests asserting `reduceArche(translate(fixture))` equals today's `reduceOpenCodeEvent(fixture)` store; verify golden tests pass.
- [x] 2.5 Switch `/api/w/[slug]/events` to `runtime.subscribeEvents(signal)` and write Arche frames, keeping heartbeat, connect deadline, broadcast injection and non-aborting close; move the client reducer to `src/lib/workspace-events/reducer.ts` handling only Arche events; switch `listMessagesAction` snapshots to Arche parts; verify updated route tests and `use-workspace-event-bus` tests, plus spec scenarios for unknown events and `workspace.touched`.
- [x] 2.6 Measure translation overhead: add a micro-benchmark (Vitest bench) translating a recorded 2,000-event streaming fixture and log p50/p99 per-event cost in `NOTES.md`; verify p99 < 0.5 ms per event.

## 3. Consumers on the contract and seam enforcement

- [x] 3.1 Rewrite `src/actions/opencode.ts` as `src/actions/workspace-sessions.ts` using `getRuntimeForSlug`; file list/read/search keep today's OpenCode-backed semantics (ignore-aware, bounded fuzzy search) through the adapter's typed workspace-files bridge, which the v2 adapter must also provide; update hook imports; verify action tests (ported) pass.
- [x] 3.2 Port `/api/w/[slug]/chat/{prompt,permissions/[permissionId]}`, `/api/internal/learning/{auth,session-history}`, `/api/u/[slug]/learning/runs/[runId]/cancel` to the contract; verify their route tests pass.
- [x] 3.3 Port `lib/flows/{runner,session-executor,node-executor-types}.ts`, `lib/learning/{run-executor,session-history}.ts`, `lib/slack/{dm-handler,thread-handler}.ts` to the contract and `execution.ts`; verify flows, learning and Slack test suites pass.
- [x] 3.4 Port `lib/spawner/core.ts`, `lib/runtime/workspace-host-{web,desktop}.ts`, `lib/providers/credential-mutations.ts`, `actions/spawner.ts` (health, provider sync) to the contract; verify spawner and runtime host tests pass and the `workspace-startup` spec scenarios still hold.
- [x] 3.5 Delete `src/lib/opencode/`; add the `no-restricted-imports` rule from design D8 to `eslint.config.mjs`; verify `pnpm lint` passes and that a deliberately added SDK import in a component fails lint (then remove it).
- [ ] 3.6 Integration check for the refactor: `pnpm test`, `pnpm lint`, `pnpm build`, and a manual run through the workspace UI (stream a reply, approve a permission, abort a subagent run, reconnect mid-stream) on a v1 container; verify no visible change.

## 4. arche-tools MCP server

<!-- Phase-1 handoff (2026-10-20): 1.1 has a published-package/docs spike and
UNVERIFIED runtime gates in NOTES.md; package installation was replaced by
in-memory tarball inspection to respect the repository write boundary.
1.2/1.3 are implemented but full tsc remains blocked by baseline test diagnostics.
2.4 goldens pass against existing regression fixtures; fresh container capture is outstanding.
3.1 session actions are ported, but file operations retain safe v1 semantics through
the seam: the sidecar lacks equivalent ignore-aware bounded fuzzy search. This
needs a scope decision, not a silent behavior change. 3.6 requires the human UI walkthrough.
Phase 1 is not fully accepted; do not treat the unchecked tasks as completed. -->

<!-- Phase-1 acceptance decisions (2026-10-20, reviewer):
- Typecheck gate = no production-source diagnostics and no new test diagnostics vs main.
  Measured: main 281 diagnostics, branch 241, 0 in production source. 1.2/1.3 accepted.
- 2.4: goldens over the existing regression shapes are accepted; a live-container capture
  is not required for this change.
- 3.1: the workspace-files bridge through the adapter is the accepted design (task text
  updated); sidecar parity is out of scope.
- 3.6 stays unticked: manual walkthrough by a human before merge. It does not block later phases. -->

- [ ] 4.1 Create `infra/workspace-image/arche-tools/` (package.json with `@modelcontextprotocol/sdk`, zod, existing tool deps) and a stdio `server.js` with a shim that registers each existing tool definition as an MCP tool (zod → JSON schema, `toToolOutput` → MCP content incl. attachment metadata); move `shared/` and `tools/` into it; verify `node --test` / existing `opencode-config/tests` ported to call tools through an in-process MCP client pass.
- [ ] 4.2 Implement caller identity for `learning` and `session_history` per design D5 (MCP `_meta` if spike 1.1 confirms forwarding, otherwise explicit argument), returning `caller_identity_unavailable` when absent; verify with tool tests for both paths.
- [ ] 4.3 Update `Containerfile` to install `arche-tools` in `/opt/arche/arche-tools`, drop `@opencode-ai/plugin` and `OPENCODE_CONFIG_DIR` tools; update `infra/workspace-image/README.md`; verify `bash scripts/check-podman-images.sh` passes.
- [x] 4.4 Register `arche_tools` as a local MCP server in the v1 runtime config and remap built-in tool ids in `agent-config-transforms.ts` (`injectAlwaysOnAgentTools`, `materializeAgentToolMaps`, related guards); verify `runtime-artifacts` and `agent-config-transforms` tests cover the spec scenario "agent had only the spreadsheet tools".
- [x] 4.5 Audit `apps/web/kickstart/agents`, kickstart templates, skills and flow definitions for hard-coded built-in tool ids and update them; update `workspace-tool-display.ts` so the chat renders `arche_tools_*` tool parts with the same labels and attachments as before; verify with `rg` showing no old ids and component tests for tool display.
- [x] 4.6 Desktop: point the desktop runtime at the bundled `arche-tools` (update `prepare-desktop-runtime.sh` and `runtime/desktop/config.ts`); verify desktop runtime tests pass.

<!-- Phase-2 handoff (2026-10-20): group 4 code is implemented, but 4.1–4.3
remain unverified: execution permissions denied the required pnpm install.
arche-tools/pnpm-lock.yaml is therefore still missing. Generate it with an
authorized pnpm install before building either bundle; do not weaken frozen
installs or the two failing supply-chain checks. MCP regressions are ported to
an in-process client but currently fail to load the unavailable SDK. Web tests:
5488 pass / 2 fail (missing lockfile); lint: 0 errors; tsc: 241 test diagnostics,
0 production diagnostics. Desktop/runtime and allowlist/display tests pass.
Image checks exceeded the 120-second command budget during the web build.
Explicit caller identity is the D5 fallback: agent argument plus session metadata
or explicit session argument; missing/conflicting context fails closed. Learning
runs supply their current session id in the prompt. Explicit identity is
attribution, not authorization; internal API workspace authentication is unchanged.
Explicit allowlists no longer receive unrelated always-on tools (spreadsheet-only
spec scenario); legacy all/missing maps still receive the complete built-in set.
No v2 runtime or rollout default was changed. -->

## 5. Runtime kind and OpenCode v2 adapter

- [x] 5.1 Add `Instance.runtimeKind String? @map("runtime_kind")` and the `LegacySessionArchive` model to `prisma/schema.prisma` and `prisma/schema.sqlite.prisma` via `pnpm db:migrate` (additive only); verify migration SQL contains only `ADD COLUMN`/`CREATE TABLE`/`CREATE INDEX`.
- [x] 5.2 Write `runtimeKind` in the start attempt's conditional state update in `spawner/core.ts` and the desktop host, read it in `registry.ts` (null → `opencode-v1`), add `ARCHE_DEFAULT_RUNTIME_KIND` and `OPENCODE_V1_IMAGE` to config and `.env.example`; verify registry tests for mixed v1/v2 instances and unknown kind.
- [x] 5.3 Split `runtime-artifacts.ts` into a harness-neutral model plus `renderRuntimeConfig` per adapter; verify the v1 renderer is byte-identical to today's output (existing hash tests unchanged).
- [ ] 5.4 Implement the v2 renderer per design D6 (`mcp.servers`, `agents`, `providers`, ordered `permissions`, `external_directory: ask`, guards as `policies`, `arche_tools` local server); verify snapshot tests per agent kind and validation of the rendered file with the OpenCode 2 config schema if one is published (per spike notes).
- [ ] 5.5 Implement `adapters/opencode-v2/` on `@opencode/client` (add the dependency), including the event translator to Arche events and provider-access sync; verify adapter unit tests against recorded v2 fixtures from the spike, plus the same golden reducer scenarios as 2.4.
- [x] 5.6 Build the v2 workspace image: bump `versions/opencode.version`, adapt `entrypoint.sh` (config file name/location, skills dir `.opencode/skills`, auth proxy if spike requires it), `scripts/download-opencode.sh` and the CI workflow; keep a pinned `workspace:opencode-v1` tag; verify `bash scripts/check-podman-images.sh` builds both.
- [ ] 5.7 Add an admin-only action to start a specific instance as `opencode-v2`, with an `AuditEvent`; verify with an action test and a manual end-to-end run on a v2 container (stream, tool call with `arche_tools`, connector MCP call through the gateway, permission, abort family, flow run, Slack DM).

<!-- Phase-3 partial handoff (2026-10-20): 5.1 SQL is additive and both schemas
validate/generate. DATABASE_URL is unset, so offline Prisma migrate diff replaced
db:migrate; PostgreSQL application remains unverified. Desktop schema bootstrap
v13 is additive, with isolated SQLite fresh/upgrade/unique/cascade regressions.
5.3 equivalence and unchanged existing hash tests pass. 5.2 recording/config and
5.7 audited admin action/tests are implemented, but v2 cannot be started: required
dependency installation was permission-denied, not retried; no @opencode/client
was added without a matching lockfile. Recorded v2/unknown kinds fail with typed
runtime_unsupported before container contact/cleanup, including the files bridge.
5.4 has mapping tests but protected models refuse with runtime_config_unsupported
at guards.selfDelegation: documented policies cannot express a caller-scoped hard
guard, and permissions are not a safe substitute. 5.5/5.6 remain blocked; image
and version pins and deployment default stay v1. Local credential-free 2.0.32 HTTP
probes are documented in NOTES.md; they do not prove compatibility with client
2.1.0 or complete model/tool/permission/family execution. Final web tests 5557
pass/19 skipped, lint 0 errors, tsc 241 test diagnostics/0 production; build passes.
An unowned arche-tools lockfile appeared during checks and was preserved; final
web tests rely on its presence. No MCP install/runtime validation was claimed.
Required image script timed out after 120s in web build, before workspace check.
Re-run with a 600s budget failed at dangling-image prune with exit 125 because
an image is in use by a container; no external container/image was force-removed.
Do not proceed to rollout/archive switch until phase-3 blocked gates are resolved. -->

<!-- Phase-3 continuation (2026-10-20): matched client 2.0.32 is installed.
5.2 verified: mixed/null/unknown-kind routing, V2 files bridge, existing container-keyed
recording, separate image/state selection. Per PRD, infra/README.md replaces changes
to the protected .env.example. Default remains V1; desktop preparation retains 1.18.18.
5.4 strengthened with 52 renderer tests and live OpenAPI/config.get validation, but
required caller-scoped policies cannot be expressed (agent policies are dropped).
5.5 has matched SDK CRUD/files/text prompt mappings, live text/reasoning/tool/permission
fixtures, snapshots/accounting and safe synchronous translations. Still partial:
subscription requires Arche-owned partial updates/parity; provider credential removal
reactivates old credentials; queued/retry/late-child idle confirmation and attachments
remain unverified. These paths return typed errors, not guessed success.
V2 startup is gated BEFORE cleanup or any state write; failed sync also cannot publish
V2 running. 5.6 verified: both workspace images + web build; network-disabled image
auth/config/skills checks pass. Legacy remote tag is opencode-v1-1.18.18, not v6.0.0;
publication/deployment are human-owned. 5.7 audited admin action/tests still pass,
manual end-to-end remains pending. Do not begin archive/rollout until 5.4/5.5 gates
are resolved; NOTES.md and __tests__/CAPTURE.md contain evidence and remaining gates. -->

## 6. Legacy session archive and runtime switch

- [x] 6.1 Implement archive export through the v1 adapter (sessions incl. children → `LegacySessionArchive`, upsert on `(slug, sessionId)`, resumable); verify service tests for full, partial-resume and empty workspaces.
- [x] 6.2 Wire archive-on-start in `startInstance` per design D7 (export from running v1, else boot `OPENCODE_V1_IMAGE` on the v1 volume in archive mode; on success start v2 with `arche-opencode2-share-<slug>`; on failure start v1 and log); verify spawner tests for each branch and the spec scenarios "Workspace with history switches to v2" and "Export fails".
- [x] 6.3 Sessions UI: merge archived sessions into the session list with an archived marker, read-only conversation view (no composer, notice), and `session_archived` rejection for mutations in actions and routes; verify component and route tests, including the authorization scenario for another user's archive.
- [x] 6.4 Background pre-archive job for running v1 instances (reaper-adjacent, rate-limited, one workspace at a time); verify with a service test and a log line per archived workspace.
- [x] 6.5 Integration recovery: Slack thread/DM bindings pointing to archived sessions create a new session and rebind; in-flight v1 message runs and flow runs on a switched instance settle as failed with `runtime_migrated`; verify Slack handler and flow tests.
- [x] 6.6 Add a "migrating history" state to `workspace-startup-screens.tsx`; verify component test.
- [ ] 6.7 Flip `ARCHE_DEFAULT_RUNTIME_KIND=opencode-v2` in compose/deploy config and document rollback (set back to `opencode-v1`) in `infra/README.md`; verify a staging deploy where a v1 workspace restarts as v2 with its history archived, and a rollback restart returns it to v1 with its original sessions.

<!-- Phase-4 handoff (2026-10-20): 6.1–6.6 machine checks pass. As required by
the step-specific PRD, archive preparation is implemented without bypassing the
unresolved 5.4/5.5 startup gate; default stays V1 and 6.7 remains human-owned.
Export includes descendants and validates idle/stable snapshots. Unlike the D7
optimization, final export re-reads messages even for matching timestamps so an
old partial snapshot can never silently become the final archive. Upserts remain
idempotent/resumable; background writes are fenced against migration claims.
Archived reads/mutation guards only activate on non-V1 recorded instances, so
pre-archive and rollback preserve live V1 behavior. Late flow/message writers
cannot revive settled runtime_migrated records. Temporary archive containers are
isolated, authenticated and removed before starting either runtime. Infra README
documents the future flip and exact rollback; no staging deployment was run.
Startup/stop/reaper/status reconciliation use conditional transition ownership;
failed helper cleanup blocks either runtime on retry. Sessionless flows awaiting
startup survive; bound V1 runs settle even when their session was deleted. Archive
hydration freezes immediately and rejects stale live responses/events.
Desktop group 7 and contract preparation 8.2/8.3 remain for impl-desktop; keep
the V1 adapter, SDK, binary/image and volumes. -->

## 7. Desktop on OpenCode 2

- [ ] 7.1 Bundle both `opencode` (v2) and `opencode-v1` in `prepare-desktop-runtime.sh` and resolve them in `runtime/desktop/config.ts`; verify desktop config tests.
- [ ] 7.2 Run archive-then-switch in the desktop host using the local v1 binary and a separate v2 data dir; verify desktop host tests and a manual upgrade of a desktop vault with existing sessions.

## 8. Contract phase (after all running instances are v2)

- [ ] 8.1 Remove `adapters/opencode-v1/`, `@opencode-ai/sdk`, the `opencode-v1` image tag/desktop binary and `OPENCODE_V1_IMAGE`; verify `pnpm test`, `pnpm lint`, `pnpm build` and `bash scripts/check-podman-images.sh`.
- [ ] 8.2 Add a script that lists `arche-opencode-share-<slug>` v1 volumes for archived workspaces (dry run by default, `--apply` to delete); verify dry-run output on staging before applying.
- [ ] 8.3 Run `openspec validate harness-runtime-contract --strict`; verify it passes.
