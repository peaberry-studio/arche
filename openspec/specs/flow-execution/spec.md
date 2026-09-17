## Purpose

Defines the behavioral contract for executing flow runs against workspace sessions with respect to MCP connector availability: which connector requirements a flow step may declare, when connector readiness may block execution, how auxiliary (non-user-facing) prompts are treated, and the failure and retry semantics when a genuinely required connector is unavailable.

## Requirements

### Requirement: Connector readiness gating is scoped to declared step requirements
A flow step SHALL be blocked on MCP connector readiness only for connectors explicitly declared as required by that step. A step that declares no required connectors SHALL have its prompt sent to the session regardless of the connection state of any connector, including connectors whose tools are enabled on the step's agent. When a declared connector is not connected within the readiness waiting window — or is absent from the workspace runtime configuration altogether — the step SHALL fail with a `flow_mcp_connector_unavailable` error that identifies exactly the declared connector.

#### Scenario: Disconnected connector is not declared by the step
- **WHEN** a flow step runs on an agent that has connector tools enabled and one of those connectors is disconnected
- **AND** the step declares no required connectors
- **THEN** the step's prompt is sent to the session and the step is not failed for connector unavailability

#### Scenario: Declared connector becomes connected within the readiness window
- **WHEN** a step declares a required connector and that connector reaches connected state within the readiness waiting window
- **THEN** the step's prompt is sent to the session

#### Scenario: Declared connector stays unavailable
- **WHEN** a step declares a required connector and the connector is still not connected when the readiness window expires
- **THEN** the step fails with a `flow_mcp_connector_unavailable` error identifying the declared connector

#### Scenario: Declared connector is not configured in the workspace
- **WHEN** a step declares a required connector whose server is absent from the workspace runtime configuration
- **THEN** the step fails with a `flow_mcp_connector_unavailable` error identifying the declared connector

### Requirement: Auxiliary flow prompts are not connector-gated
Flow-internal auxiliary prompts — output compaction of an agent step, AI evaluation of a condition step, and compaction steps — SHALL NOT be blocked by connector readiness requirements, regardless of which agent resolves them or which connectors that agent has enabled.

#### Scenario: Output compaction with a disconnected connector on the default agent
- **WHEN** an agent step with output compaction enabled completes its main prompt successfully
- **AND** the agent that would run the compaction prompt has a disconnected connector
- **THEN** the compaction prompt is sent to the session without a connector availability failure

#### Scenario: AI condition evaluation with a disconnected connector
- **WHEN** a condition step evaluates its branch via an AI prompt
- **AND** any agent in the workspace has a disconnected connector
- **THEN** the evaluation prompt is sent to the session without a connector availability failure

### Requirement: Flow steps declare connector requirements
A flow definition SHALL allow each agent step to declare an optional ordered set of required connectors, identified by connector id. A definition whose agent step carries a malformed declaration (non-array, non-string entries, empty or whitespace-only ids) SHALL be rejected by flow definition validation; a definition with no declarations on a step SHALL remain valid.

#### Scenario: Malformed declaration is rejected
- **WHEN** a flow definition contains an agent step whose required-connectors declaration is not an array of non-empty strings
- **THEN** flow definition validation rejects the definition

#### Scenario: Absent declaration is valid
- **WHEN** a flow definition contains an agent step with no required-connectors declaration
- **THEN** flow definition validation accepts the definition and the step has no connector requirements

### Requirement: Connector pre-flight checks use declared requirements only
The system SHALL compute a flow's connector requirements solely from the connectors declared by its steps. A flow SHALL NOT be blocked before execution because a connector referenced by an agent's tool configuration is missing or disabled for the execution user, unless a step of that flow declares that connector. A flow that declares a connector the execution user does not have enabled SHALL be blocked before execution with guidance naming the missing connector.

#### Scenario: Agent-level connector missing but not declared
- **WHEN** a flow's agent has a connector enabled in its tools and the execution user no longer has that connector enabled
- **AND** no step of the flow declares that connector
- **THEN** the flow is not blocked before execution for that connector

#### Scenario: Declared connector missing for the execution user
- **WHEN** a flow step declares a required connector and the execution user does not have that connector enabled
- **THEN** the flow is blocked before execution with a missing-connectors result that identifies the declared connector

### Requirement: Declared-connector unavailability is retryable
A step failure caused by `flow_mcp_connector_unavailable` SHALL follow the standard flow run retry policy instead of failing the run terminally on first attempt.

#### Scenario: Connector recovers before retries are exhausted
- **WHEN** a step fails with `flow_mcp_connector_unavailable` and the declared connector becomes connected before retry attempts are exhausted
- **THEN** the run is retried per the retry policy and can succeed on a later attempt

### Requirement: Flow runs start with a full-TTL gateway token

A flow run SHALL refresh provider access when it starts on an already-running workspace, regardless of how recently the workspace last synced providers, so the gateway token issued for the run carries the full configured TTL. The refresh SHALL still defer while another run is active in the workspace, and SHALL still proceed through the standard provider-sync lock and credential-hash comparison.

#### Scenario: Flow starts long after the last interactive sync

- **WHEN** a flow run starts on a workspace that is already running and whose provider sync is younger than the freshness threshold
- **THEN** provider access is refreshed anyway and the flow starts with a freshly issued gateway token

#### Scenario: Another run is active when the flow starts

- **WHEN** a flow run starts while an unrelated run is active in the same workspace
- **THEN** the forced refresh is deferred, the concurrent run is not interrupted, and the flow proceeds

### Requirement: Provider access is refreshed at flow step boundaries

A flow run SHALL force a provider-access refresh before each step after the first executes — after the run's cancellation and lease checks for that step — so every step begins with a gateway token carrying the full configured TTL. Flow steps run for minutes, so a freshness-threshold check at a boundary would skip until the token is nearly expired and hand the next step a token that dies mid-step. The first step of an execution is exempt because the run's entry refresh has just re-issued tokens. Because a flow's own message run is finalized between steps, the forced refresh SHALL defer only when an unrelated run is active in the workspace. A failed step-boundary refresh SHALL NOT fail the flow run; authentication failures surface from the step execution itself.

#### Scenario: Multi-step flow crosses the token TTL

- **WHEN** a flow runs longer than the gateway token TTL and reaches a step boundary
- **THEN** provider access is force-refreshed before the next step starts and the next step's gateway calls succeed

#### Scenario: Boundary refresh fails

- **WHEN** the step-boundary provider-access refresh fails
- **THEN** the flow continues to the next step and the failure is logged as a warning

### Requirement: Gateway authentication failures are retryable

A flow step failure caused by an invalid or expired gateway token SHALL be classified as retryable by the flow retry policy. A retry SHALL refresh provider access before resuming and SHALL resume execution at the failed node.

#### Scenario: Step fails with an expired gateway token

- **WHEN** a flow step fails with an `invalid_token` error from the provider gateway
- **THEN** the run is scheduled for retry under the standard backoff policy instead of failing terminally