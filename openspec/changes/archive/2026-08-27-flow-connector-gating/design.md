## Context

See `proposal.md` — Why for the production incident and the false-failure mechanics.

Current mechanics that shape this design (verified in code):

- The gate (`getUnavailableMcpConnectorError` in `apps/web/src/lib/flows/session-executor.ts`) runs inside `runFlowPromptAndReadOutput()` before **every** prompt: agent steps, the internal compaction call, AI condition evaluation, and compaction steps. It fetches the workspace runtime config (`client.config.get`), resolves the agent (`node.targetAgentId ?? default_agent`), derives required MCP server keys from the agent's **full tool map** (`extractRequiredMcpServerKeys`), then polls `client.mcp.status` with backoff up to the readiness window.
- Runtime MCP server keys have the form `arche_<type>_<connectorId>` (see `buildMcpServerKey`); `AgentCapabilities.mcpConnectorIds` entries are connector ids (the same vocabulary `arche_<type>_<id>` keys are built from). Connector ids are cuid-style and contain no underscores.
- Flows are per-user (`flow.userId`, `executionUserId`); definitions are stored as JSON and re-parsed by `validateFlowDefinition` on every execution, so adding an optional node field needs no DB migration.
- The static pre-flight (`connector-requirements.ts`) derives requirements from each agent node's `AgentCapabilities.mcpConnectorIds` via the common workspace config, and the run route blocks with `missing_connectors` when `checkMissingConnectorRequirements` finds a declared connector not enabled for the execution user.
- The alias machinery in `remapAgentConnectorTools` (admin connector id → user's connector) exists because **admin-authored** agent tool maps reference admin connector ids. User-authored flow declarations reference the user's own connectors, so no aliasing is needed for them.

## Goals / Non-Goals

**Goals:**

- A step that does not declare a connector is never blocked or delayed by any connector's state.
- Connector need becomes a per-step declaration with accurate, named failures and standard retry semantics.
- Zero added cost for flows with no declarations (they must skip the gate entirely, including the config fetch).

**Non-Goals:**

- Flow-level connector declarations (a flow-wide list unioned into every step). Per-step covers the acceptance criteria; a flow-level default can be added later without schema breakage.
- Declaring connectors on condition, compaction, human, merge, or Slack nodes — those never call connector tools.
- Runtime interception of tool calls against undeclared disconnected servers (what the model sees when it voluntarily calls a dead connector's tool is OpenCode's existing tool-error behavior).
- Fixing the compaction call's agent resolution (it resolves to `default_agent`); only its gating changes.
- Problems C (KB write bypass) and D (KB policy prompt sync) from the same diagnostic — separate changes.

## Decisions

### D1: `requiredConnectors` as an optional field on agent nodes, holding connector ids

- `FlowAgentNode` gains `requiredConnectors: string[]` (absent ≙ empty). Identifiers are connector ids — the same vocabulary as `AgentCapabilities.mcpConnectorIds` — not server keys, so definitions stay stable if the server-key scheme ever changes.
- Alternatives considered:
  - *Infer requirements from the prompt template*: templates are free text and reference connectors semantically ("pull our email stats"), never by tool prefix. Too fragile to be a correctness gate.
  - *Flow-level field*: redundant with per-step; deferred (see Non-Goals).
  - *Keep agent-level granularity, only downgrade the failure to a warning*: fails the acceptance criterion that a genuinely required connector should still hard-fail with an accurate error.

### D2: The gate takes an explicit declaration list; empty list means no gate at all

- `runFlowPromptAndReadOutput()` gains `requiredConnectors?: Array<{ id: string; displayName?: string }>`. When it is absent/empty, `getUnavailableMcpConnectorError()` returns immediately — no `config.get`, no `mcp.status`, no polling. This makes the fix a strict improvement in step latency for undeclared flows (today every step pays at least one config fetch + one status call).
- Agent-node execution passes the node's declarations (main prompt only). The compaction call, condition evaluation, and compaction nodes pass nothing and are therefore ungated by construction — no per-executor gating logic to forget.
- `extractRequiredMcpServerKeys` (tool-map-derived) becomes dead and is removed. Agent resolution inside the gate (`resolveRuntimeAgentId`) is no longer needed for gating.

### D3: Declaration → server key resolution against the runtime config, by exact id-suffix match

- The gate already fetches the runtime config; it resolves each declared id to a server key by finding the `arche_*` key in `config.mcp` that ends with `_${id}`. Connector ids contain no underscores, so the last segment is unambiguous (e.g. declared `cm9abc…` → `arche_custom_cm9abc…`).
- No declared match in the runtime config means the connector is not provisioned for this workspace → treated as unavailable → the accurate `flow_mcp_connector_unavailable` failure (spec: "Declared connector is not configured in the workspace").
- Alternatives considered:
  - *Hydrate the connector's type from the DB and call `buildMcpServerKey`*: adds a service dependency and a DB round-trip to a module that is deliberately decoupled (it only talks to the OpenCode client). Suffix matching against data already in hand is equivalent.
  - *Reuse the alias logic from `remapAgentConnectorTools`*: only needed for admin-authored tool maps; flow declarations are user-authored against their own connectors.

### D4: Display names hydrated once at the node-executor layer

- `session-executor.ts` stays free of service dependencies. `executeAgentNode` hydrates `displayName` for the declared ids via `connectorService.findManyByIds` (one query, only when the node declares connectors) and passes `{id, displayName}` entries down. The gate's error uses `displayName ?? serverKey`, replacing the old prompt-hint scraping (`readConnectorNameHints`), which only ever worked for custom connectors with injected hint blocks. The hint parser is removed with the rest of the tool-map path.

### D5: Static pre-flight derives requirements from declarations, keeping its result shape

- `getFlowConnectorRequirements()` iterates agent nodes and emits one `FlowConnectorRequirement` per **declared** connector id, resolving `connectorType` from connector records (the function already calls `connectorService.findManyByIds` for custom names; extend to all declared ids). The `agentId`/`agentName` fields stay and identify the node's resolved agent for attribution in the UI.
- `checkMissingConnectorRequirements()` is unchanged — it already operates on the requirements list; with declaration-scoped input its `missing_connectors` blockage becomes accurate by construction.
- Consequence (accepted): the pre-flight no longer warns about "agent has connector tools but user lacks the connector" for undeclared flows. That heads-up was exactly the false positive this change removes.

### D6: `flow_mcp_connector_unavailable` becomes retryable

- One entry in `isRetryableFlowRunError()`. Post-change the error means "a connector this step explicitly needs is down", which is the transient-infrastructure shape the retry policy exists for (same class as `instance_unavailable`, `fetch failed`).
- Trade-off: a permanently revoked token now burns the full retry budget (~5 attempts over ≈18 min with default backoff) before terminal failure. Accepted; audit events already record each failed attempt.

### D7: Editor exposure in the node inspector

- The agent-node panel in `flow-node-inspector.tsx` gains a connector multi-select fed by the user's enabled connectors (same source the connectors settings use), persisting connector ids. Absent selection ≙ no requirements, which is the default for new and existing nodes.

## Risks / Trade-offs

- [Flows that use a connector without declaring it lose the readiness grace period after instance start] → Accepted by design (spec scenario "Disconnected connector is not declared by the step"). If the model calls a still-connecting server's tool, OpenCode surfaces a tool error to the model, which typically retries within the step. Users who want the old guarantee declare the connector and get the window back.
- [Suffix-match resolution could mis-resolve if connector ids ever contain underscores] → Documented constraint in D3; ids are cuid-style. Add a defensive check that the matched key's type segment is a known connector type if it costs nothing.
- [Retry budget consumed by permanently dead declared connectors] → See D6; bounded by existing retry caps and backoff, observable via audit events.
- [Users may not discover the new field, leaving flows ungated] → The failure mode they'd experience is a runtime model error naming the tool/server, which is strictly more accurate than today's behavior. Editor copy should state what declaring does (waits and fails accurately).
- [Old code reading new definitions] → Old `validateFlowDefinition` reconstructs nodes from known fields only, so a `requiredConnectors` field is ignored (not rejected) by the previous version — safe during a blue-green deploy overlap.

## Migration Plan

1. Deploy is a single additive change: no DB migration (definitions are JSON, re-validated on read), no config schema change. Existing definitions validate unchanged.
2. After deploy, previously failing flows (the production incident class) start executing immediately because they declare nothing.
3. Rollback: revert the deploy. Definitions that gained `requiredConnectors` in the meantime remain loadable (previous code ignores the field); those flows simply return to ungated behavior.
