## Context

`executeFlowNodes` walks one `currentNodeId`; `nextEdge()` takes the first outgoing edge; `executeMergeNode` records a pass-through step. Fork/join adds a second execution mode between a `fork` and its paired `merge` while single-cursor execution stays the default everywhere else.

## Goals

- Parallel branch execution with real concurrency for LLM-bound steps.
- Failure/cancellation semantics that never leave the run in an inconsistent state.
- Deterministic validation so mis-wired forks fail at save/import/run time instead of at runtime.

## Non-goals

- Editor authoring UI, human/slack nodes inside branches, dynamic joins (see proposal).

## Decisions

### Branches get their own OpenCode sessions

The design sketch assumed branches share the parent session. They cannot: a workspace session runs one prompt at a time, and `createActiveRunAfterRuntimeStateCheck` returns `session_busy` (or steals a stale lock) when two runs race on the same `(slug, sessionId)`. Each branch fiber therefore creates its own session via `client.session.create` with the title `<flow session title> · <branch start node name>`. Branch sessions are not attached to the run record (`attachRunSession` stays reserved for the primary session); branch steps are recorded per node as usual, which is what the template context and run timeline consume.

### Steps: per-fiber copies, merged per nodeId

`replaceStep` is immutable and keyed by `nodeId`, so concurrent fibers mutating one array would lose updates. Each fiber starts from a copy of the parent steps and returns its own array; the parent folds fiber results through `replaceStep` after `Promise.all`. Merge order does not matter because keys are unique per node.

### Fail-fast via a shared abort flag

Promises cannot be cancelled, and relying on run-level cancellation alone would keep sibling branches burning tokens after a failure. Each fork creates a `branchState = { aborted }` object shared by its fibers; the fiber that fails (or that cannot confirm termination) sets the flag, and every fiber checks it at the top of its loop and returns `cancelled`. The fork's outcome aggregation gives `termination_unconfirmed` precedence over `failed`, then `cancelled`, then `waiting_for_human` (which validation forbids inside branches and surfaces as `flow_branch_pause_unsupported` if it is ever reached). Run-level cancellation still wins through the existing per-iteration `isRunCancelled` check.

### `currentNodeId` tracks the single cursor only

Fibers run with `trackCurrentNode: false`, so `updateRunCurrentNode` records the fork before branches start and the join/merge afterwards. A retry after a fork failure resumes from the fork and re-runs the whole region; `upsertRunStep` is keyed by `(runId, nodeId)`, so re-run branch steps overwrite cleanly.

### Validation: region containment instead of literal fan-in equality

The design sketch required "the merge has exactly as many incoming edges as the fork has outgoing edges". That is too strict to be sound: a condition node inside a branch may legitimately route several rule targets into the join, breaking equality for a correct graph. The implemented rules express the same guarantee structurally: the branch region is the set of nodes reachable from the branch starts without passing through the join (so containment holds by construction), no region node may dead-end, the join accepts no incoming edges from outside the region, and the graph is acyclic — together these prove every branch path reaches the join. A direct fork→join edge (`fork_branch_empty`) is rejected, so the join is always fed by real branch work.

### Additional structural rule: single outgoing edge outside condition/fork

Nodes other than `condition` and `fork` with more than one outgoing edge are rejected (`multiple_outgoing_edges:<nodeId>`). Today such edges are silently dropped, which is the bug this change fixes; flagging these graphs is intentionally breaking for flows that were already broken at runtime.

### Prisma schema untouched

Fork nodes never record run steps (the runner intercepts them before `executeFlowNode`), so the `FlowNodeType` Prisma enum — and therefore the database — needs no migration. `nodeTypeToPrisma` is typed to exclude fork nodes so the compiler keeps it that way.

## Risks / Trade-offs

- Concurrent branch prompts multiply simultaneous provider load for the workspace (multiple sessions, same credentials) — accepted; per-provider rate limits apply as for interactive use.
- A fork flow edited in the flow editor renders the fork as an unknown node type (no inspector UI yet); definitions round-trip unchanged, and validation keeps edited flows saveable only while the fork topology stays intact.
- Nested forks work by recursion (each with its own join), but nothing in the UI communicates depth limits; recursion depth is bounded by the acyclic validation.

## Open Questions

- Should the run timeline surface branch sessions (currently only branch steps appear)? Defer to a follow-up with the editor UI work.
