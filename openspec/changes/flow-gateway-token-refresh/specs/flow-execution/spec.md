## Purpose

Defines the behavioral contract for gateway-token freshness during flow execution: that a flow run starts with a full-TTL gateway token, that token freshness is maintained between flow steps without aborting concurrent runs, and that gateway authentication failures are recoverable through the standard flow retry policy.

## ADDED Requirements

### Requirement: Flow runs start with a full-TTL gateway token

A flow run SHALL refresh provider access when it starts on an already-running workspace, regardless of how recently the workspace last synced providers, so the gateway token issued for the run carries the full configured TTL. The refresh SHALL still defer while another run is active in the workspace, and SHALL still proceed through the standard provider-sync lock and credential-hash comparison.

#### Scenario: Flow starts long after the last interactive sync

- **WHEN** a flow run starts on a workspace that is already running and whose provider sync is younger than the freshness threshold
- **THEN** provider access is refreshed anyway and the flow starts with a freshly issued gateway token

#### Scenario: Another run is active when the flow starts

- **WHEN** a flow run starts while an unrelated run is active in the same workspace
- **THEN** the forced refresh is deferred, the concurrent run is not interrupted, and the flow proceeds

### Requirement: Provider access is refreshed at flow step boundaries

A flow run SHALL attempt a provider-access refresh before each step executes, after the run's cancellation and lease checks for that step. Because a flow's own message run is finalized between steps, the refresh SHALL defer only when an unrelated run is active in the workspace. A failed step-boundary refresh SHALL NOT fail the flow run; authentication failures surface from the step execution itself.

#### Scenario: Multi-step flow crosses the token TTL

- **WHEN** a flow runs longer than the gateway token TTL and reaches a step boundary
- **THEN** provider access is refreshed before the next step starts and the next step's gateway calls succeed

#### Scenario: Boundary refresh fails

- **WHEN** the step-boundary provider-access refresh fails
- **THEN** the flow continues to the next step and the failure is logged as a warning

### Requirement: Gateway authentication failures are retryable

A flow step failure caused by an invalid or expired gateway token SHALL be classified as retryable by the flow retry policy. A retry SHALL refresh provider access before resuming and SHALL resume execution at the failed node.

#### Scenario: Step fails with an expired gateway token

- **WHEN** a flow step fails with an `invalid_token` error from the provider gateway
- **THEN** the run is scheduled for retry under the standard backoff policy instead of failing terminally
