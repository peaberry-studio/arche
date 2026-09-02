## 1. Fork node type

- [x] 1.1 Add `ForkFlowNode` (`{ id, type: 'fork', name, joinNodeId }`) to the `FlowNode` union in `apps/web/src/lib/flows/types.ts`.
- [x] 1.2 Parse and validate `fork` nodes in `apps/web/src/lib/flows/validation.ts` (`joinNodeId` required non-empty string); narrow `nodeTypeToPrisma` in `apps/web/src/lib/flows/node-executor-utils.ts` to exclude fork so step records stay type-safe without a Prisma migration.

## 2. Fork/join topology validation

- [x] 2.1 Add `validateFlowGraph` to `validation.ts`: at most one outgoing edge for nodes other than `condition`/`fork`; fork joins must exist, be `merge` nodes, and be unique per fork; at least two branches and no direct fork→join edge; branch region containment (every branch edge stays in the region or targets the join, no dead ends); no `human`/`slack` nodes inside a branch region; no incoming join edges from outside the region. Verify with `validation.test.ts` cases for each rule plus backward-compatible definitions.
- [x] 2.2 Remap `joinNodeId` when the join node is renamed in `apps/web/src/lib/flows/editor-graph.ts` (`updateNodeReferences`). Verify with an `editor-graph.test.ts` case.

## 3. Parallel execution in the runner

- [x] 3.1 Split `executeFlowNodes` in `apps/web/src/lib/flows/runner.ts` into an internal `runFlowNodes` that carries the step list through its outcome and a wrapper preserving the public outcome type; add `stopBeforeNodeId`, `trackCurrentNode`, and `branchState` params.
- [x] 3.2 Handle `fork` nodes in the loop: spawn one fiber per outgoing branch (own OpenCode session, own steps copy, own visited set, shared abort flag, stopping at the join), aggregate outcomes with `termination_unconfirmed` > `failed` > `cancelled` precedence, merge branch steps into the parent context, continue single-cursor execution from the join with `previousOutput` reset to `null`.
- [x] 3.3 Verify with `runner.test.ts`: branches run and both outputs reach a downstream `{{steps.<nodeId>.output}}` template; a branch failure fails the run without executing the merge; branch steps appear in the merged context; branch sessions are created per branch; definitions without forks execute unchanged.

## 4. OpenSpec and checks

- [x] 4.1 `openspec validate parallel-flow-execution --strict` passes.
- [x] 4.2 eslint clean on changed files; affected vitest suites pass.
