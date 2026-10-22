## MODIFIED Requirements

### Requirement: Health checks are bounded by a per-request deadline
The system SHALL cap each health-check request to a fixed, short timeout and SHALL return a stable `healthcheck_timeout` result when that deadline expires, rather than waiting on the transport's internal timeout. A request that expires SHALL be aborted so it cannot keep running after the deadline. The health check SHALL be performed through the runtime adapter of the instance's runtime kind, so the probed endpoint follows the harness in use.

#### Scenario: Health check never responds
- **WHEN** a health check request to the instance's runtime health endpoint does not respond within its per-request deadline
- **THEN** the health check returns `healthcheck_timeout` and the request is aborted

#### Scenario: Health check responds within the deadline
- **WHEN** a health check request reports the runtime healthy before its per-request deadline
- **THEN** the health check returns a healthy result

#### Scenario: Health is probed through the instance's adapter
- **WHEN** an instance recorded as `opencode-v2` is health-checked
- **THEN** the probe uses the `opencode-v2` adapter's health operation and its deadline and cancellation guarantees are unchanged
