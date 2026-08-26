## 1. Flow definition schema and validation

- [x] 1.1 Add optional `requiredConnectors: string[]` to the agent node type in `apps/web/src/lib/flows/types.ts` (absent ≙ no requirements), and parse/validate it in `apps/web/src/lib/flows/validation.ts`: reject non-array values and entries that are not non-empty trimmed strings; normalize by trimming and deduplicating. Absence stays valid. Verify with new cases in `src/lib/flows/__tests__/validation.test.ts` (malformed rejected, absent accepted, list normalized).
- [x] 1.2 Check `editor-graph.ts` default node creation and `import-export.ts` node round-trip so the field survives editor creation, import, and export (add passthrough where nodes are rebuilt). Verify with `src/lib/flows/__tests__/import-export.test.ts` and `editor-graph.test.ts` cases that the field round-trips and defaults to absent.

## 2. Runtime gate rescoping

- [x] 2.1 Rework `getUnavailableMcpConnectorError()` in `apps/web/src/lib/flows/session-executor.ts`: accept an explicit list of `{ id, displayName? }` declarations; when the list is empty, return `null` immediately without any `config.get`/`mcp.status` call; when non-empty, fetch the runtime config once, resolve each declared id to the `arche_*` server key ending in `_${id}` (unresolved id → unavailable), keep the existing polling/backoff window, and fail with `flow_mcp_connector_unavailable:<displayName ?? serverKey>`. Remove the now-dead `extractRequiredMcpServerKeys` and `readConnectorNameHints` (and `resolveRuntimeAgentId` if nothing else uses it). Verify via updated `src/lib/flows/__tests__/session-executor.test.ts`.
- [x] 2.2 Add `requiredConnectors?: Array<{ id: string; displayName?: string }>` to `runFlowPromptAndReadOutput()` params and thread it to the gate. Verify existing `session-executor.test.ts` calls compile and pass unchanged.
- [x] 2.3 In `apps/web/src/lib/flows/node-executor-agent.ts`: when the node declares connectors, hydrate display names with one `connectorService.findManyByIds` call and pass the entries to the **main** prompt call only; the compaction call passes nothing (ungated). Verify with a `node-executors.test.ts` case asserting the compact call never receives requirements and the main call receives hydrated names.
- [x] 2.4 Add gate-scoping tests in `session-executor.test.ts`: (a) no declarations → no `config.get`/`mcp.status` interaction and prompt proceeds with a dead connector present; (b) declared connector connects within window → proceeds; (c) declared connector stays disconnected → fails naming the displayName; (d) declared id absent from runtime `mcp` map → fails as unavailable. Verify all pass.

## 3. Static pre-flight rescoping

- [x] 3.1 Rework `getFlowConnectorRequirements()` in `apps/web/src/lib/flows/connector-requirements.ts` to derive requirements from agent-node `requiredConnectors` (resolving `connectorType`/`connectorName` via `connectorService.findManyByIds` for all declared ids), keeping the `FlowConnectorRequirement` shape with the node's resolved agent for attribution. `checkMissingConnectorRequirements()` stays as is. Rewrite `src/lib/flows/__tests__/connector-requirements.test.ts`: declared-and-missing → requirement; agent-tools-only (undeclared) → no requirement.
- [x] 3.2 Update `src/app/api/u/[slug]/flows/__tests__/routes.test.ts` expectations so `missing_connectors` blocking is only asserted for declared connectors, and verify the detail route surfaces declared-only requirements.

## 4. Retry policy

- [x] 4.1 Add `flow_mcp_connector_unavailable` to `isRetryableFlowRunError()` in `apps/web/src/lib/flows/retry-policy.ts` and add coverage (new `src/lib/flows/__tests__/retry-policy.test.ts` if none exists): error is retryable, attempts bounded by the standard plan. Verify tests pass.

## 5. Flow editor UI

- [x] 5.1 Add a connector multi-select to the agent-node panel in `apps/web/src/components/flows/flow-node-inspector.tsx`, fed by the user's enabled connectors (same data source as the connectors settings), persisting connector ids into `requiredConnectors`, with copy explaining that declared connectors are waited for and fail accurately. Verify with a `flow-node-inspector.test.tsx` case: selecting/deselecting connectors updates the node definition; empty selection keeps the field absent.

## 6. Final verification

- [x] 6.1 Run `pnpm test` and `pnpm lint` from `apps/web/` — both green.
- [ ] 6.2 Run `bash scripts/check-podman-images.sh` from the repo root — images build.
- [x] 6.3 Run `openspec validate flow-connector-gating --strict` — change validates.
