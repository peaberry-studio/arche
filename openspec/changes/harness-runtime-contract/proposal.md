## Why

OpenCode 2.0 shipped with a server API rewritten from scratch, a new client package (`@opencode/client`), a new config schema and a plugin runtime that does not run 1.x plugins. Arche is pinned to OpenCode 1.18.18 and talks to it directly in about 60 server and client modules: server actions, flows, Slack, learning, the spawner, desktop mode, and a browser event reducer that consumes raw OpenCode events piped through `/api/w/[slug]/events`. A direct port would rewrite all of that in place and leave Arche just as coupled to OpenCode 2 as it is to OpenCode 1 today.

Arche also wants to become a hub where a session can run on different harnesses (OpenCode, Codex, Claude Code) with shared connectors, the KB and the agent catalog. That needs exactly the seam the migration forces anyway. This change introduces that seam and uses it to complete the OpenCode 1 → 2 migration. Only one adapter is in scope: the shape stays honest, and other harnesses arrive later without touching the UI.

## What Changes

- Introduce an **Arche-owned harness runtime contract** (`src/lib/harness/`): session lifecycle (create, get, list, children, update, delete), prompt, abort-family-and-confirm-idle, permissions (list, reply), model and agent listing, health, and a stream of **normalized Arche events**. All server code (actions, API routes, flows, Slack, learning, spawner, desktop host) calls the contract and never an OpenCode client.
- **Normalize events in the BFF.** `/api/w/[slug]/events` translates harness events into a versioned Arche event schema before writing them to the browser. The client reducer consumes only Arche events. **BREAKING** (internal wire format between the BFF and the browser; both deploy together).
- Ship **two adapters behind the contract during the transition**: `opencode-v1` (extracted from today's code, no behavior change) and `opencode-v2` (built on `@opencode/client`). The adapter is chosen per instance from a recorded runtime kind, so containers already running on v1 keep working during blue-green deploys. The v1 adapter is deleted in a follow-up once no v1 instance remains.
- **Migrate the workspace runtime to OpenCode 2.0**: workspace image base, desktop binary, and the generated runtime config (`opencode.json` → v2 schema: `mcp.servers`, `agents`, `providers`, ordered `permissions` array with `shell`/`edit`/`subagent` actions, explicit `external_directory: ask`). **BREAKING** for the workspace image and the runtime config format.
- **Move Arche custom tools out of the OpenCode plugin API** into a harness-agnostic **`arche-tools` MCP server** (stdio, inside the workspace) that reuses the existing tool implementations (chart, diagram, document, email, flow, learning, presentation, session_history, spreadsheet). Every harness that speaks MCP gets them unchanged. **BREAKING** for tool ids as seen by agents; agent tool maps are remapped by the spawner.
- **Archive OpenCode 1.x session history as read-only**: before a workspace switches to v2, its v1 sessions are exported into an Arche-owned archive and shown in the sessions UI as read-only conversations. They are not continued on v2.
- **Record the ACP decision**: evaluate the Agent Client Protocol as the adapter interface. Model the contract so it maps onto ACP concepts, but do not adopt ACP as the transport in this change (rationale in design).

**Non-goals**: Codex or Claude Code adapters; an aggregated per-user MCP connector endpoint; cross-harness handoff; choosing a harness in the UI; performance work beyond not regressing turn latency. These build on this change and are proposed separately.

## Capabilities

### New Capabilities
- `harness-runtime`: the contract between Arche and an agent harness: required operations, per-instance adapter selection, error semantics, and the guarantee that no caller outside the adapter depends on a harness SDK.
- `workspace-event-stream`: the browser-facing event stream: a versioned, harness-neutral event schema, translation in the BFF, heartbeat, reconnect, and snapshot hydration semantics.
- `workspace-tools`: Arche's built-in agent tools delivered as a harness-agnostic MCP server inside the workspace, including the tool inventory, identity/context passing, and remapping of agent tool permissions.
- `legacy-session-archive`: read-only preservation of OpenCode 1.x session history across the runtime migration.

### Modified Capabilities
- `workspace-startup`: health checks go through the runtime adapter's health operation instead of a hard-coded OpenCode `/global/health` path; deadline and cancellation guarantees are unchanged.

## Impact

- **Code (apps/web)**: new `src/lib/harness/` (contract, Arche event types, adapter registry, `opencode-v1/`, `opencode-v2/`). `src/lib/opencode/` is absorbed into the v1 adapter and deleted with it. Touched consumers: `src/actions/opencode.ts` (renamed to `src/actions/workspace-sessions.ts`), `src/app/api/w/[slug]/{events,chat/prompt,chat/permissions}`, `src/app/api/internal/learning/*`, `src/app/api/u/[slug]/learning/runs/[runId]/cancel`, `src/lib/flows/*`, `src/lib/learning/*`, `src/lib/slack/*`, `src/lib/spawner/{core,runtime-artifacts,agent-config-transforms,mcp-config,runtime-config*}.ts`, `src/lib/runtime/workspace-host-{web,desktop}.ts`, `src/lib/providers/credential-mutations.ts`, and workspace hooks, components and types that import `@/lib/opencode/*` (UI-facing types move to `src/types/`).
- **Dependencies**: add `@opencode/client` (2.x); keep `@opencode-ai/sdk` 1.18.18 until the v1 adapter is removed; drop `@opencode-ai/plugin` from the workspace image; add an MCP server SDK to `infra/workspace-image/arche-tools`.
- **Infra**: `versions/opencode.version` → 2.x; `infra/workspace-image/{Containerfile,entrypoint.sh}`; `opencode-config/tools` → `arche-tools/` MCP server; desktop runtime binary and config dir.
- **Database**: additive migration: `Instance.runtimeKind` (nullable, default `opencode-v1` for existing rows) and a `LegacySessionArchive` table. No destructive changes.
- **Specs**: `workspace-startup` delta. `flow-run-lifecycle` and `model-providers` mention OpenCode as an implementation detail; their requirements are unchanged.
