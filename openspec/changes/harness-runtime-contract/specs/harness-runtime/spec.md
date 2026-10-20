## Purpose

Defines the contract between Arche and the agent harness that runs inside a workspace: the operations Arche relies on, how the adapter for an instance is chosen, how failures are reported, and the isolation that keeps harness-specific SDKs out of every other part of the system.

## ADDED Requirements

### Requirement: The runtime contract covers every operation Arche performs on a harness
The system SHALL expose one runtime contract per workspace instance offering: health check; session create, get, list, list children, update title, delete; prompt with parts, agent, and model; abort a session family and confirm it is idle; list pending permissions and reply to one; list available models; list agents; synchronize provider access; and subscribe to the event stream. Each operation SHALL return a typed result or a typed error, and SHALL NOT throw for expected harness failures.

#### Scenario: Operation succeeds
- **WHEN** a caller lists sessions for a running instance
- **THEN** it receives Arche session records (id, title, parent id, timestamps, status) with no harness-specific fields

#### Scenario: Harness rejects an operation
- **WHEN** the harness responds to an operation with an error
- **THEN** the caller receives a typed error carrying a stable Arche error code and the harness message as detail

#### Scenario: Session does not exist
- **WHEN** a caller gets, prompts, or aborts a session id the harness does not know
- **THEN** the result is the typed error `session_not_found`

### Requirement: No caller outside an adapter depends on a harness SDK
Server actions, API routes, flows, Slack handlers, learning runs, the spawner, workspace hosts, hooks, and components SHALL reach a harness only through the runtime contract. Only adapter modules SHALL import a harness SDK or harness wire types. A static check SHALL fail the build when this rule is broken.

#### Scenario: Module outside an adapter imports a harness SDK
- **WHEN** a module outside an adapter directory imports a harness SDK package or an adapter-internal module
- **THEN** the lint step fails and names the offending import

### Requirement: The adapter is selected from the instance's recorded runtime kind
Each instance SHALL record the runtime kind it was started with. The system SHALL pick the adapter for every operation from that recorded kind, never from a global setting alone. An instance with no recorded kind SHALL be treated as `opencode-v1`. New instances SHALL start with the runtime kind configured for the deployment.

#### Scenario: Old and new runtimes coexist during a deploy
- **WHEN** instance A was started as `opencode-v1` and instance B as `opencode-v2`
- **THEN** operations on A use the `opencode-v1` adapter and operations on B use the `opencode-v2` adapter, in the same process

#### Scenario: Instance restarts after the deployment default changes
- **WHEN** an instance recorded as `opencode-v1` is stopped and started again after the deployment default became `opencode-v2`
- **THEN** it starts as `opencode-v2` and its recorded runtime kind is updated

#### Scenario: Unknown runtime kind
- **WHEN** an instance records a runtime kind that has no registered adapter
- **THEN** operations return the typed error `runtime_unsupported` and do not contact the container

### Requirement: Aborting a session family is confirmed, not assumed
Abort SHALL stop the target session and all its descendant sessions, then confirm through the harness that none of them is busy, within a bounded deadline. When the deadline expires without confirmation, the result SHALL be the typed error `execution_termination_unconfirmed`.

#### Scenario: Family stops in time
- **WHEN** a caller aborts a session with two busy child sessions and all three report idle before the deadline
- **THEN** the abort result is success

#### Scenario: A child keeps running
- **WHEN** a child session still reports busy when the abort deadline expires
- **THEN** the abort result is `execution_termination_unconfirmed`

### Requirement: Permission replies use Arche's response vocabulary
The contract SHALL accept the permission responses `once`, `always`, and `reject`, and each adapter SHALL translate them into the harness's own vocabulary. Pending permissions SHALL be listed with session id, permission id, title, kind, and the resource pattern when the harness provides one.

#### Scenario: User approves once
- **WHEN** a user replies `once` to a pending permission
- **THEN** the harness receives the equivalent single-use approval and the permission stops being pending

### Requirement: Prompt submission preserves the existing run bookkeeping
Submitting a prompt through the contract SHALL keep today's guarantees: refresh provider access before execution, refuse a prompt while the session family is busy, record a message run for usage accounting, and resolve workspace context paths and attachments into prompt parts. These guarantees SHALL hold the same way for every adapter.

#### Scenario: Prompt while session is busy
- **WHEN** a prompt is submitted to a session whose family has a busy session
- **THEN** the submission is rejected with the typed error `session_busy` and no message run is created

#### Scenario: Prompt with attachments
- **WHEN** a prompt includes workspace attachments and context paths
- **THEN** the harness receives them as file parts that resolve inside the workspace
