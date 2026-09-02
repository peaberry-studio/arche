## Why

The flow runner executes nodes with a single cursor. When a node has multiple outgoing edges, only the first edge is followed — `nextEdge()` in `apps/web/src/lib/flows/node-executors.ts` takes `getFlowOutgoingTargets(...)[0]` and the rest are silently dropped. `merge` is a pass-through, not a join: it neither waits for incoming branches nor aggregates their outputs. A flow that fans out to three hunter agents then merges into a verify step actually executes only the first hunter; the others never run, and `{{steps.<dropped-node>.output}}` references downstream resolve to `null`, failing the run with `unknown_template_variable`. Validation accepts these graphs, so the breakage appears only at runtime.

## What Changes

- Add a `fork` flow node type (`{ id, name, type: 'fork', joinNodeId }`) whose outgoing edges each start an independent parallel branch. `joinNodeId` names the `merge` node where the branches reconverge, making the pairing explicit.
- Execute forks in the runner: when the single cursor reaches a `fork`, the runner spawns one execution fiber per outgoing branch — each an independent `runFlowNodes` traversal with its own visited set, initial `previousOutput`, and a shared fail-fast flag — and runs them via `Promise.all`. When every branch reaches the fork's join node, the parent cursor executes the `merge` node once and continues single-cursor execution.
- Give branches their own OpenCode sessions. A workspace session executes one prompt at a time (`createActiveRunAfterRuntimeStateCheck` fails with `session_busy` while busy), so concurrent branches sharing the parent session would fail spuriously. Each branch session is created from the workspace client with a derived title and is used only for that branch.
- Make branch failures fail the fork: the first branch failure (or runtime-termination uncertainty) sets the shared abort flag so sibling branches exit on their next loop iteration, and the fork reports the failure upstream. If the run is cancelled, all branches exit through the existing cancellation check.
- Merge branch steps into the parent template context: each fiber works on a copy of the step list and the parent merges results per `nodeId` after the branches settle, so `{{steps.<branchNode>.output}}` resolves in nodes after the join. `previousOutput` after a fork is `null` — authors reference branch outputs explicitly.
- Validate the topology at save/import/run time (`validateFlowDefinition`): a node other than `condition` or `fork` may have at most one outgoing edge (extra edges are dropped at runtime today — this is a correctness fix that flags silently broken flows); fork joins must reference an existing `merge`, be unique per fork, declare at least two branches with no direct fork→join edge; every branch must reach the join (no dead ends); `human` and `slack` nodes are not allowed inside a branch region (no pause/notify semantics under parallelism yet); every incoming edge of a join must come from inside its branch region.
- Preserve backward compatibility: definitions without `fork` nodes execute exactly as before, and `merge` nodes without a paired fork remain pass-throughs.

## Non-goals

- No editor UI for authoring fork nodes (palette entry, join picker, canvas rendering). Fork flows are expressible via templates and the API in this change; editor authoring is a follow-up.
- No `human` or `slack` nodes inside branch regions — pausing one branch while siblings run needs branch-state persistence and a fork-aware resume path.
- No dynamic joins (conditional branch counts) and no mid-branch provider token refresh coordination beyond what the per-slug sync lock already provides.
- No change to template resolution: `buildFlowTemplateContext` already exposes every completed step, and `validateFlowPayload` already validates template references against all node ids at save time.
