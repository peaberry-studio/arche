## Purpose

Defines the behavioral contract for parallel flow execution: how `fork` nodes fan work out into concurrent branches, how branches run and reconverge at their paired `merge` node, which graph topologies are valid, and how failure and cancellation propagate through a fork.

## ADDED Requirements

### Requirement: Fork nodes fan out into parallel branches

A `fork` node SHALL start one independent branch per outgoing edge. Each branch SHALL execute as its own traversal with its own session on the workspace instance, so branch steps run concurrently. The fork SHALL record no run step of its own, and execution SHALL continue from the fork's paired join node only after every branch has reached it.

#### Scenario: Two agent branches run concurrently

- **WHEN** a flow reaches a `fork` with two outgoing edges into agent nodes that reconverge at the fork's join
- **THEN** both agent steps execute on separate sessions and the merge node executes once after both have finished

#### Scenario: Branch outputs are available after the join

- **WHEN** a node after the join references `{{steps.<branchNode>.output}}`
- **THEN** the template resolves with the corresponding branch output

### Requirement: Branch failures fail the fork without running the join

If any branch fails, or cannot confirm runtime termination, the fork SHALL report that outcome upstream, sibling branches SHALL stop on their next execution step, and the join node SHALL NOT execute. A cancelled run SHALL cause all branches to exit. The merge node of a failed fork SHALL NOT be recorded.

#### Scenario: One branch fails while a sibling is running

- **WHEN** a branch step fails while a sibling branch is still executing
- **THEN** the sibling branch stops at its next loop iteration and the run fails with the first branch failure's error

#### Scenario: The run is cancelled during a fork

- **WHEN** the run is cancelled while branches are executing
- **THEN** every branch exits through the cancellation check and the run settles as cancelled

### Requirement: Fork topology is validated before execution

Flow definition validation SHALL reject: nodes other than `condition` and `fork` with more than one outgoing edge; a fork whose `joinNodeId` does not reference an existing `merge` node; two forks declaring the same join; a fork with fewer than two branches or with a direct fork→join edge; a branch that dead-ends before reaching the join; `human` or `slack` nodes inside a branch region; and incoming edges into a join from outside the fork's branch region.

#### Scenario: Multi-edge node is rejected

- **WHEN** a definition gives an `agent` node two outgoing edges
- **THEN** validation fails with `multiple_outgoing_edges` naming the node, instead of silently dropping the second edge at runtime

#### Scenario: Dangling branch is rejected

- **WHEN** a fork branch reaches a node whose edges do not lead back to the fork's join
- **THEN** validation fails instead of executing a branch that never reconverges

### Requirement: Definitions without forks are unaffected

A definition with no `fork` nodes SHALL execute exactly as before the change, and a `merge` node that no fork targets SHALL remain a pass-through.

#### Scenario: Existing flow keeps its execution order

- **WHEN** a definition that contains no `fork` nodes runs after the change
- **THEN** its steps execute in the same order and with the same outcomes as before
