## Why

Flow runs fail wholesale on connectors the failing step never uses. Before every prompt of every node, the executor gates on the MCP readiness of **every connector enabled in the resolved agent's tool map** (`extractRequiredMcpServerKeys` in `apps/web/src/lib/flows/session-executor.ts`), not on what the step actually needs. In production (workspace `inaki`), one revoked Mailerlite OAuth token took down three flows (`cmp9ruda5…`, `cms6lj9xv…`, `cmpph8x5…`) from 2026-08-24 even though no failing step touched Mailerlite: the primary agent has 85 custom connector tools enabled, so any dead connector among them blocks every step that runs on that agent. The failure is terminal (`flow_mcp_connector_unavailable` is not in `isRetryableFlowRunError`), arrives only after a 15–30s readiness polling stall, and the error text names a connector unrelated to the step's work, which misleads diagnosis.

Two aggravations verified in code:

1. **Auxiliary prompts inherit the gate.** The compact call in `node-executor-agent.ts` sends no `agent`, so it resolves to `default_agent` — a node targeted at a clean subagent is still gated by the primary agent's dead connectors. AI condition evaluation (`node-executor-condition.ts`) and compaction nodes (`node-executor-compaction.ts`) are gated the same way, although they only ever summarize or classify text.
2. **The static pre-flight has the same shape.** `getFlowConnectorRequirements` derives "this flow needs these connectors" from each agent node's `AgentCapabilities.mcpConnectorIds` (the full agent-level list), and the run route blocks with `missing_connectors` accordingly — so a deleted connector on an agent also blocks flows that never use it.

There is no concept of "which connectors this step needs" anywhere in the model; granularity is per-agent across the whole chain (capabilities, static pre-flight, runtime gate).

## What Changes

- Add an optional `requiredConnectors` field (list of connector ids, same vocabulary as `AgentCapabilities.mcpConnectorIds`) to `agent` flow nodes, so connector needs become expressible per step.
- Rescope the runtime MCP readiness gate in `session-executor.ts`: it waits/checks **only** the connectors declared on the executing node. Nodes with no declarations are not gated at all — a disconnected connector can no longer block a step that does not declare it.
- A declared connector that is absent from the runtime config or not `connected` after the readiness window fails the step with `flow_mcp_connector_unavailable:<connector>`, naming exactly the declared connector.
- Stop gating auxiliary prompts entirely: output compaction, AI condition evaluation, and compaction nodes never declare connectors, so they are never gated.
- Rescope the static pre-flight (`connector-requirements.ts`) to derive requirements from node declarations instead of agent capability lists, so `missing_connectors` only blocks flows that declared a connector the execution user does not have enabled.
- Make `flow_mcp_connector_unavailable` retryable under the standard flow retry policy: post-change it means "a connector this step explicitly needs is down", which is the transient-infrastructure shape retries exist for.
- Expose `requiredConnectors` in the flow editor's agent-node inspector as a connector multi-select.
- Remove the now-dead toolmap-derived requirement extraction (`extractRequiredMcpServerKeys`).

Behavior change (intended, per the problem statement): flows that relied on the old implicit per-agent gate lose the readiness grace period for connectors they use but did not declare; their steps run immediately and any tool call against a disconnected server surfaces as a runtime model error instead.

## Capabilities

### New Capabilities
- `flow-execution`: Behavioral contract for executing flow runs against workspace sessions — MCP connector readiness gating scoped to per-node declared connector requirements, ungated auxiliary prompts, and connector-availability failure semantics for flow steps.

### Modified Capabilities
- (none — `workspace-startup` is unaffected; no existing spec covers flow execution.)

## Impact

- `apps/web/src/lib/flows/types.ts` — agent node type gains optional `requiredConnectors`.
- `apps/web/src/lib/flows/validation.ts` — parse/validate `requiredConnectors` (absent or list of connector-id strings).
- `apps/web/src/lib/flows/session-executor.ts` — gate accepts an explicit set of required connector ids, resolves them to runtime MCP server keys, skips when empty; remove `extractRequiredMcpServerKeys`.
- `apps/web/src/lib/flows/node-executor-agent.ts` — pass node `requiredConnectors` to the main prompt call; compact call passes none.
- `apps/web/src/lib/flows/node-executor-condition.ts`, `node-executor-compaction.ts` — no gate (no declared connectors).
- `apps/web/src/lib/flows/connector-requirements.ts` — requirements derived from node declarations.
- `apps/web/src/lib/flows/retry-policy.ts` — `flow_mcp_connector_unavailable` retryable.
- `apps/web/src/components/flows/flow-node-inspector.tsx` — agent-node connector multi-select.
- `apps/web/src/app/api/u/[slug]/flows/[id]/route.ts` and `.../[id]/run/route.ts` — unchanged call sites; semantics change via `connector-requirements.ts`.
- Tests: `src/lib/flows/__tests__/session-executor.test.ts`, `connector-requirements.test.ts`, `validation.test.ts`, `retry-policy` coverage, `src/components/flows/__tests__/flow-node-inspector.test.tsx`, and flows API route tests.
- No DB migration: flow definitions are stored as JSON and re-validated on read; existing definitions without `requiredConnectors` remain valid.
