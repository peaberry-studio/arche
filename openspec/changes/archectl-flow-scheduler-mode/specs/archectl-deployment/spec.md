## Purpose

Defines the behavioral contract for the deployment artifacts archectl generates: the rendered env file must satisfy every production-required web setting, the rendered compose stack must run a flow-scheduler runner consistent with the configured scheduler mode, and the update path must converge existing deployments to the current artifacts.

## ADDED Requirements

### Requirement: Generated env files satisfy production-required settings
The env file archectl renders — both the validated template and the bootstrap file written to the target host — SHALL define every setting the web application requires in production, including `ARCHE_FLOW_SCHEDULER_MODE`. For the one-click remote-equivalent topology the flow scheduler mode SHALL be `daemon`, matching the Ansible remote deployment path.

#### Scenario: Fresh deployment boots without scheduler-mode errors
- **WHEN** archectl bootstraps a new server and the web container starts in production
- **THEN** the resolved flow scheduler mode is `daemon` and startup does not fail for a missing scheduler mode

#### Scenario: Rendered template and bootstrap file agree
- **WHEN** the env template and the bootstrap env heredoc are rendered
- **THEN** both declare the same `ARCHE_FLOW_SCHEDULER_MODE` value

### Requirement: The compose stack runs a runner consistent with the scheduler mode
Because the configured mode is `daemon`, the generated compose stack SHALL include a flow daemon service running the web image's flow-daemon entrypoint with the same env file, networks, and workspace host mounts as the web service, and it SHALL NOT start until its database and container-proxy dependencies are healthy.

#### Scenario: Flow dispatch has a runner
- **WHEN** the stack is started from archectl's generated compose
- **THEN** a `flows` service runs the flow-daemon entrypoint, which ticks due flows because the configured mode is `daemon`

#### Scenario: Web process does not double-tick
- **WHEN** the flow scheduler mode is `daemon`
- **THEN** the web service does not start an inline flow scheduler

### Requirement: Updates converge existing deployments
The update script SHALL set `ARCHE_FLOW_SCHEDULER_MODE` in the existing env file idempotently and SHALL create or recreate the flow daemon service alongside the web service, so a deployment updated from any previous version ends up with both the scheduler mode and its runner.

#### Scenario: Pre-existing deployment gains the scheduler mode
- **WHEN** an existing deployment whose env file lacks `ARCHE_FLOW_SCHEDULER_MODE` runs the update script
- **THEN** the env file gains `ARCHE_FLOW_SCHEDULER_MODE=daemon` and no duplicate key is created on repeated updates

#### Scenario: Pre-existing deployment gains the runner
- **WHEN** an existing deployment runs the update script after the compose template gained the flow daemon service
- **THEN** the `flows` service is created and running after the update completes
