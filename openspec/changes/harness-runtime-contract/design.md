## Context

See proposal.md (Why) for motivation. Current state that shapes the approach:

- **Server-side coupling.** `src/lib/opencode/` holds the client factory (`@opencode-ai/sdk/v2/client`, which despite the subpath name is SDK 1.18.18), session execution (`session.status/children/abort/messages`), prompt building, provider sync, transforms and permissions. It is consumed directly by `src/actions/opencode.ts` (1,184 lines, 19 actions), three `/api/w/[slug]/*` routes, flows (`lib/flows/runner.ts`, `session-executor.ts`), learning, Slack (`dm-handler`, `thread-handler`), the spawner, both workspace hosts and provider credential mutations.
- **Browser coupling.** `/api/w/[slug]/events` pipes OpenCode `/event` frames through unchanged, and `lib/opencode/event-reducer.ts` interprets OpenCode event shapes in the browser (`message.part.delta`, `permission.v2.asked`, `properties.info.sessionID`, …). Most UI files import Arche-shaped types (`WorkspaceSession`, `MessagePart`, `AvailableModel`) that only *live* under `lib/opencode/types.ts`. The real browser coupling is the reducer and the event wire format, not the components.
- **Runtime artifacts.** The spawner generates a v1 `opencode.json` (`mcp`, `agent`, `provider`, v1 permission maps, `withWorkspacePermissionGuards`), `AGENTS.md` and skills, and starts `opencode serve --hostname 0.0.0.0 --port 4096` with basic auth `opencode:<password>`. Desktop mode does the same with a bundled binary on loopback.
- **Built-in tools.** Nine tools in `infra/workspace-image/opencode-config/tools/*.js` use `@opencode-ai/plugin` 1.18.18 and read workspace files and Arche's internal API. OpenCode 2.0 does not run v1 plugins.
- **OpenCode 2.0** (released October 2026): server API rewritten (`@opencode/client`, generated reference at `/api`), config renamed (`mcp.servers`, `agents`, `providers`, ordered `permissions` array, `bash→shell`, `write/patch→edit`, `task→subagent`, `external_directory` allowed by default), MCP servers opt into Code Mode by default, no documented migration for 1.x session storage.
- **Zero-downtime deploys.** Old and new web versions run at the same time against the same DB, and long-lived containers started by the old version keep running after the deploy.

## Goals / Non-Goals

**Goals:**
- A single seam (`src/lib/harness/`) that every consumer uses, small enough that a Codex or Claude Code adapter needs no change outside its own directory plus a registry entry.
- Land the seam as a pure refactor first (v1 adapter, no behavior change), then switch the runtime. The two risks stay separate and each phase can be reverted on its own.
- Per-instance runtime selection, so v1 and v2 containers coexist during rollout.
- Keep turn latency at or below today's: translation must not buffer.

**Non-Goals:**
- Designing the multi-harness UX (harness picker, per-harness credentials, subscription login).
- Replacing the provider gateway or connector gateway. They keep working; only the config that points to them changes shape.
- Converting v1 sessions into runnable v2 sessions.

## Decisions

### D1. Arche owns a narrow runtime contract; adapters own everything harness-specific

```
src/lib/harness/
  contract.ts        # HarnessRuntime type: operations + typed results/errors
  events.ts          # Arche event schema (versioned), part kinds — client-safe
  registry.ts        # runtimeKind → adapter factory; getRuntimeForSlug(slug)
  errors.ts          # stable error codes (session_not_found, session_busy, …)
  execution.ts       # harness-agnostic orchestration: prompt-run bookkeeping,
                     # abort-family-and-confirm-idle, wait-for-completion
  adapters/
    opencode-v1/     # absorbs today's src/lib/opencode/* (moved, not rewritten)
    opencode-v2/     # @opencode/client
```

The contract has **primitive** operations (`session.status`, `session.children`, `session.abort`, `session.messages`, …), including provider-access sync (today's auth PUTs plus `instance/dispose` and the post-dispose health wait in `providers.ts`). The **orchestration** that exists today in `session-execution.ts` (abort the family and confirm idle, wait for completion, cursor capture, message-run creation) moves to `execution.ts` and is written once against the primitives. Flows, Slack and learning keep identical semantics for both adapters, and a future adapter implements primitives only.

*Alternative: a fat contract where each adapter implements "abort family and confirm".* Rejected: it duplicates subtle race handling (`execution_termination_unconfirmed`) per harness, and those are exactly the bugs that have already happened.

UI-facing types (`WorkspaceSession`, `WorkspaceMessage`, `MessagePart`, `AvailableModel`, `WorkspaceFileNode`, `PermissionResponse`, `WorkspaceConnectionState`) move from `lib/opencode/types.ts` to `src/types/workspace-runtime.ts` and become the contract's output types. File-tree types belong to the workspace-agent side and move to `src/types/workspace.ts`.

### D2. Normalize events in the BFF, not in the browser

`/api/w/[slug]/events` subscribes through the adapter (`runtime.subscribeEvents(signal)`), which yields Arche events. The route writes `data: <ArcheEvent>` frames. The browser reducer (`lib/opencode/event-reducer.ts` → `src/lib/workspace-events/reducer.ts`) switches on the closed Arche event set only. The v1 adapter's translator is today's reducer field-extraction logic (session-id resolution, delta reading, permission payload normalization) moved server-side and made to emit events instead of mutating a store.

*Alternative: keep raw passthrough and give the browser one reducer per harness.* Rejected: it ships harness knowledge to the client, doubles client bundle logic per harness, and makes snapshot/live consistency (spec: workspace-event-stream) depend on two code paths.

*Cost:* one JSON parse and serialize per event in the BFF. Today the route already parses SSE framing per chunk. Translation is a pure synchronous function with no cross-event buffering, so the added latency is negligible next to network and model time. Task 2.6 measures it.

Event schema carries `v: 1`. The client ignores unknown types, and the BFF and client deploy together.

### D3. Per-instance `runtimeKind`, two adapters during rollout

Additive migration: `Instance.runtimeKind String? @map("runtime_kind")` in both `schema.prisma` and `schema.sqlite.prisma`. Null means `opencode-v1`. Deployment default comes from `ARCHE_DEFAULT_RUNTIME_KIND` (default `opencode-v1` in phase 1, flipped to `opencode-v2` in phase 3). Images: `OPENCODE_IMAGE` (current, v2 after the flip) and `OPENCODE_V1_IMAGE` (pinned legacy image, used only for archive export and rollback). The kind is written when a start attempt creates the container, in the same conditional update that already keys state transitions to `containerId` (workspace-startup spec).

*Alternative: global flag only.* Rejected: during a blue-green deploy, containers started by the old version would be addressed with the new adapter.

### D4. ACP: map to it, do not adopt it now

The Agent Client Protocol (JSON-RPC over stdio, Zed-originated, adapters exist for Claude Code and Codex) is the obvious candidate interface for a multi-harness hub. For this change:

- **Not adopted as transport.** ACP is shaped for one editor client driving one agent process over stdio. Arche needs things ACP does not model, or models only partly: listing and reading historical sessions from the server, session families (child sessions created by subagents) for abort and permission visibility, server-side multi-subscriber event streams across browser tabs, Slack and flows, and provider-gateway injection. Adopting it would need a stdio↔HTTP bridge in every container plus extensions for all of the above. The OpenCode 2 native API covers them directly.
- **Contract is ACP-mappable.** Contract names and part kinds are chosen so that an `acp` adapter can implement them later: session/new ↔ create, session/prompt ↔ prompt, session/cancel ↔ abort, session/request_permission ↔ permission.asked, session/update chunks ↔ part.delta/part.upserted. The Codex and Claude Code adapters (future changes) will most likely be ACP-backed, which is why the mapping matters now.

Recorded so the next change starts from this decision instead of re-deciding it.

### D5. Built-in tools become an in-container stdio MCP server

`infra/workspace-image/opencode-config/` → `infra/workspace-image/arche-tools/`: a Node MCP server (`@modelcontextprotocol/sdk`) that imports the existing tool modules almost unchanged. A thin shim maps each `tool({ args, execute })` definition to an MCP tool (zod schema → JSON schema, `toToolOutput` → MCP content). It runs **inside the container** because tools read workspace files and use workspace-scoped internal API credentials (`OPENCODE_SERVER_PASSWORD`, `ARCHE_WORKSPACE_SLUG`). That rules out serving it from the BFF.

Registered in runtime config as a local MCP server (`mcp.servers.arche_tools = { type: "local", command: ["node", "/opt/arche/arche-tools/server.js"] }`). Tool ids become `arche_tools_<tool>` (exact prefixing follows the v2 MCP naming rule verified in task 1.1). `agent-config-transforms.ts` (`injectAlwaysOnAgentTools`, `materializeAgentToolMaps`) remaps old ids to new ones.

**Caller identity.** `learning.js` reads `context.agent`. MCP has no standard caller-agent field. The v2 adapter passes agent and session through MCP request `_meta` if OpenCode 2 forwards it (task 1.1). Otherwise the spawner adds a hidden `caller_agent` argument that the agent prompt pre-fills. If neither works, the tool returns `caller_identity_unavailable` (spec: workspace-tools).

**Code Mode.** OpenCode 2 opts MCP servers into Code Mode by default. `arche-tools` output (charts, documents) is consumed by the UI through tool-part metadata, so the spawner sets `arche_tools` to direct invocation if Code Mode would hide per-tool parts. This is verified in task 1.1.

*Alternative: port to the v2 plugin API.* Rejected by the user: it keeps the tools OpenCode-only and they would have to be redone for each harness.

This applies to both runtime kinds: the v1 image can also load stdio MCP, so phase 2 ships `arche-tools` on v1 first and de-risks it before the runtime switch.

### D6. v2 runtime config generator lives in the v2 adapter

`runtime-artifacts.ts` keeps building a harness-neutral intermediate model (agents, model defaults, connector MCP targets, provider gateway targets, skills, permission guards, knowledge policy). Each adapter exposes `renderRuntimeConfig(model)` → files to write (`opencode.json`, `AGENTS.md`, skills dir). The v1 renderer is today's output, byte-identical (hash-stable, so `appliedConfigSha` does not churn). The v2 renderer emits the new schema:

| v1 | v2 |
|---|---|
| `mcp.<key> {type, url, headers, enabled}` | `mcp.servers.<key> {type, url, headers, disabled}` |
| `agent.<id> {prompt, model, tools, permission}` | `agents.<id> {system, model: "provider/model", permissions[]}` |
| `provider.<id>.options.baseURL/apiKey` | `providers.<id> {package, settings.baseURL, settings.apiKey}` |
| permission maps (`bash`, `edit`, `write`, `task`) | ordered `[{action, resource, effect}]` with `shell`, `edit`, `subagent` |
| (implicit ask) | explicit `{action:"external_directory", resource:"*", effect:"ask"}` |

Configuration that must not be overridable and needs no caller predicate (deny writes to KB paths, workspace and runtime-config paths) goes into `policies`, not `permissions`, because the migration guide says overrides cannot stop users from adding servers or agents. Self-delegation is caller-dependent and v2 policies have no caller predicate, so it follows D9: the same prompt-level delegation constraint v1 uses, plus a per-agent `{action:"subagent", resource:"<self>", effect:"deny"}` permission rule placed last. That is stronger than v1, which only has the prompt constraint.

Splitting the intermediate model from rendering is the step that makes a later Codex `config.toml` or Claude Code `.mcp.json`/`CLAUDE.md` renderer a local addition.

### D7. Legacy archive: export through the v1 adapter, store in Postgres

Table `LegacySessionArchive` (`id`, `slug`, `sessionId`, `parentId?`, `title`, `createdAt`, `updatedAt`, `messages Json` (Arche `WorkspaceMessage[]`), `archivedAt`, unique `(slug, sessionId)`, cascade on user delete). Mirrored in `schema.sqlite.prisma` for desktop.

**When.** In `startInstance`, when the recorded kind is `opencode-v1` (or null):
1. If the v1 container is still running, export through it.
2. Otherwise start `OPENCODE_V1_IMAGE` on the existing `arche-opencode-share-<slug>` volume in archive mode (no MCP, no providers), export, and stop it.
3. On success, start v2 with a **new** state volume `arche-opencode2-share-<slug>`. The v1 volume is left untouched and removed in the contract phase (task 8.2), which makes rollback possible.
4. On failure, fail the start with `legacy_archive_failed` and log; the next start retries (spec: legacy-session-archive). *Revised 2026-10-21 (task 8.4): this originally started v1; v1 is no longer a runtime.*

Export is idempotent (upsert on `(slug, sessionId)`) and resumable.

*Alternative: parse OpenCode 1.x storage files directly.* Rejected: the storage format is internal and changed during 1.x. The v1 API returns exactly what the UI already renders.

*Desktop:* the desktop bundle ships both binaries for one release (`opencode` = v2, `opencode-v1` for export), and `prepare-desktop-runtime.sh` downloads both. The legacy binary is dropped in the contract phase.

`actions` for sessions merge live sessions (from the adapter) with archived sessions (from the table, flagged `archived: true`). Mutations on archived ids return `session_archived` before touching the runtime.

### D8. Enforce the seam with lint

`eslint.config.mjs` gets a `no-restricted-imports` rule: `@opencode-ai/*`, `@opencode/*` and `@/lib/harness/adapters/**` are forbidden outside `src/lib/harness/adapters/**` and `src/lib/harness/registry.ts`. `src/lib/opencode/` is deleted at the end of phase 1. Any leftover import fails the build.

### D9. The v2 acceptance bar is parity with what v1 guarantees today

*Added 2026-10-21, after phase 3–5 implementation.* The v2 adapter is accepted when it provides at least the guarantees the v1 adapter actually provides in production, plus anything stronger OpenCode 2 offers natively. It is not held to guarantees v1 never had. The earlier phases blocked v2 startup by requiring, among other things, caller-scoped non-overridable self-delegation enforcement (v1 only has a prompt constraint), gap-free event replay across arbitrary reconnect cut points (v1's stream is live-only; the client re-hydrates from snapshots), and gateway-endpoint pinning against project config overrides (v1 merges project config too).

How to apply it:
- For each gate, the v2 adapter documents what v1 does, shows v2 does at least the same against the pinned runtime (live probe or captured fixture), and records any remaining shared weakness as a known risk instead of a v2 blocker.
- A v2 behavior that is weaker than v1 is still a blocker: it stays a typed refusal (`runtime_unsupported` / `runtime_config_unsupported`) until fixed.
- Security guards are never weakened to reach parity. Where OpenCode 2 can express a stronger guard cheaply (ordered permissions, `policies`), v2 uses it.
- Shared weaknesses found this way (for example, project config overriding a provider endpoint) are tracked as follow-ups for both adapters, not fixed by refusing v2.

## Risks / Trade-offs

- **[OpenCode 2 headless details are undocumented in what we could read]** (serve flags, basic-auth support, health path, event endpoint, MCP `_meta` forwarding, Code Mode opt-out) → Task 1.1 is a time-boxed spike against a real 2.x container that produces `adapters/opencode-v2/NOTES.md` before any v2 code. If v2 lacks basic auth, the container gets a tiny auth-checking reverse proxy in the entrypoint (same port, same `opencode:<password>` scheme), so the spawner and BFF stay unchanged.
- **[OpenCode 2.0 is days old]** → The v2 kind ships behind `ARCHE_DEFAULT_RUNTIME_KIND` and is enabled on internal workspaces first. The pinned version goes in `versions/opencode.version` and is bumped deliberately.
- **[Event translation drops something the UI relied on implicitly]** → Phase 1 golden tests: record real v1 event streams from fixtures, assert that `reduce(translate(events))` equals today's `reduce(events)` state for each fixture.
- **[Tool id rename breaks saved agent configs or flows that reference tool names]** → The remap lives in the spawner, so stored agent configs are untouched. Flows that name tools in prompts keep working because the agent sees descriptive tool names. Task 4.5 audits `kickstart/agents` and flow definitions for hard-coded tool ids.
- **[Archive export slows the first v2 start]** → Export only fetches messages for sessions not already archived, and the start progress screen gets a "migrating history" state. A background pre-archive job for running v1 instances (task 6.4) archives most workspaces before they ever restart.
- **[Two adapters double the maintenance window]** → The v1 adapter is frozen (bug fixes only) from phase 3 and removed in task group 8 once `SELECT count(*) FROM instances WHERE runtime_kind IS DISTINCT FROM 'opencode-v2'` is 0 among running instances.
- **[Contract shaped too closely to OpenCode]** → Checked against the ACP mapping (D4) during review of `contract.ts`. Every operation must have an ACP or "Arche-side" answer.

## Migration Plan

Phases are separate PRs and deploys. Each one is releasable and revertible on its own. Task groups in tasks.md: phase 1 = groups 1–3, phase 2 = group 4, phases 3–4 = group 5, phase 5 = group 6, phase 6 = group 7, phase 7 = group 8.

1. **Seam (pure refactor).** Contract, registry, v1 adapter (moved code), BFF event translation, client reducer on Arche events, lint rule, `src/lib/opencode/` deleted. No DB change, no behavior change. Rollback: revert the PR.
2. **arche-tools MCP on v1.** Ship the MCP server in the current image, remap tool ids, remove the plugin tools. Rollback: revert the PR. Containers pick up the previous image on restart.
3. **Expand schema.** `Instance.runtimeKind`, `LegacySessionArchive` (additive, safe for blue-green).
4. **v2 adapter + v2 image + config renderer**, default still `opencode-v1`. Enabled per instance via an admin action for internal testing.
5. **Archive + switch.** Archive-on-start, background pre-archive, sessions UI for archived sessions, Slack/flow recovery. Then flip `ARCHE_DEFAULT_RUNTIME_KIND=opencode-v2`. Rollback: set the default back to `opencode-v1`. Instances restart on their untouched v1 volume. Archived rows are harmless. *Revised 2026-10-21 (task 8.4): v1 was retired as a runtime in this change instead. `ARCHE_DEFAULT_RUNTIME_KIND` is gone, every start is v2, a running v1 instance reports stopped and migrates on its next start, and only the read-only history reader, the pinned image/binary and the SDK remain until step 7.*
6. **Desktop** on the same sequence (both binaries bundled).
7. **Contract.** After all running instances are v2: remove the v1 adapter, `@opencode-ai/sdk`, the legacy image/binary and the v1 volumes (with a dry-run listing first). `runtimeKind` stays (it is the multi-harness selector).

## Open Questions

- Exact v2 MCP tool-id prefixing and whether Code Mode must be disabled for `arche-tools` (answered by spike 1.1; affects only the remap table in task 4.4).
- Whether OpenCode 2's shared background-service model changes resource use per container (measured in phase 4; no design impact expected because each container still runs one service).
