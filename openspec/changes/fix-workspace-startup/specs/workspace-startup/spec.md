## Purpose

Defines the behavioral contract for starting an OpenCode workspace instance: health checks must be time-bounded, the total startup must honor its deadline, and instance state transitions must be safe against concurrent startup attempts so a stale request can never destroy a workspace another flow already confirmed.

## ADDED Requirements

### Requirement: Health checks are bounded by a per-request deadline
The system SHALL cap each health-check request to a fixed, short timeout and SHALL return a stable `healthcheck_timeout` result when that deadline expires, rather than waiting on the transport's internal timeout. A request that expires SHALL be aborted so it cannot keep running after the deadline.

#### Scenario: Health check never responds
- **WHEN** a health check request to `/global/health` does not respond within its per-request deadline
- **THEN** the health check returns `healthcheck_timeout` and the request is aborted

#### Scenario: Health check responds within the deadline
- **WHEN** a health check request responds with `healthy: true` before the per-request deadline
- **THEN** the health check returns a healthy result

### Requirement: Total startup does not exceed the startup deadline
The system SHALL treat `ARCHE_START_TIMEOUT_MS` as the total budget for the startup health-check phase, and SHALL NOT allow any individual health check request to exceed the remaining time in that budget.

#### Scenario: Startup deadline is reached
- **WHEN** the elapsed startup time reaches the configured startup budget
- **THEN** the startup health check terminates as a timeout within that budget

### Requirement: DNS and direct-IP probing do not block startup
The system SHALL probe the workspace by DNS hostname and by direct container IP so that neither check can block the other. The system SHALL NOT block startup on a direct-IP request: when the direct-IP probe fails or exceeds its deadline, startup continues with the DNS probe. When either probe confirms health, the losing in-flight request is cancelled.

#### Scenario: Direct IP is blocked but DNS responds
- **WHEN** the direct-IP health probe does not respond within its deadline
- **AND** the DNS hostname health probe returns healthy
- **THEN** the startup completes successfully

#### Scenario: Direct IP responds but DNS does not
- **WHEN** the direct-IP health probe returns healthy before its deadline
- **AND** the DNS hostname probe does not respond within its deadline
- **THEN** the startup continues using the direct-IP address as the workspace base URL

### Requirement: State transitions are keyed to the startup attempt
The system SHALL key instance state transitions to the `containerId` of the startup attempt that created the container. A state change from `starting` to `running` or `error` SHALL only take effect when the instance still references the same `containerId` and is still in `starting`.

#### Scenario: Old attempt fails after another flow confirmed running
- **WHEN** a startup attempt's health check fails after another flow has already moved the instance to `running` for the same `containerId`
- **THEN** the failing attempt does not mark the instance as errored
- **AND** the failing attempt does not stop or remove the container
- **AND** the instance remains `running`

#### Scenario: Old attempt targets a superseded container
- **WHEN** a startup attempt's `containerId` no longer matches the current instance `containerId` because a newer attempt replaced it
- **THEN** the older attempt does not change the instance state
- **AND** the older attempt does not remove the newer container

### Requirement: running is published only after a completed startup
The system SHALL publish the instance as `running` only after the startup flow has completed both the health check and provider synchronization. While a startup attempt is recent and the instance is `starting`, status reads SHALL keep reporting `starting` even when the workspace process responds to a health check. An interrupted startup SHALL be recovered through an explicit reconciliation flow that verifies the container, checks health within a deadline, synchronizes providers, and only then transitions conditionally to `running`.

#### Scenario: Health responds during an in-progress startup
- **WHEN** an instance is `starting` within its startup freshness window
- **AND** the workspace process responds to a health check
- **THEN** a status read returns `starting`, not `running`

#### Scenario: Interrupted startup is reconciled
- **WHEN** an instance is `starting` but its startup attempt was interrupted
- **AND** the container is running and the health check succeeds within a bounded deadline
- **AND** provider synchronization succeeds
- **THEN** the reconciliation flow transitions the instance conditionally to `running`

### Requirement: The client does not wait on a blocked server action indefinitely
The system SHALL arm an independent client-side timeout before awaiting the startup server action. When that timeout expires, the client SHALL surface an error and SHALL NOT allow a late server response to overwrite the timed-out state.

#### Scenario: Startup server action never resolves
- **WHEN** the client starts the workspace and the server action does not resolve within the client timeout
- **THEN** the client shows an error state
- **AND** when the server action later resolves, the client does not overwrite that error state