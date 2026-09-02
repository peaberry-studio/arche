## Purpose

Defines the behavioral contract for flow run lifecycle integrity: which inconsistent `running` runs the scheduler recovers, what a finalization failure does to the flow's lease, and how users stop active runs.

## ADDED Requirements

### Requirement: Stale-run recovery covers released and expired leases
The scheduler SHALL recover a `running` flow run — marking it failed as stale-recovered — when its flow's lease is released (`leaseExpiresAt` is null) or expired (`leaseExpiresAt` in the past), provided the run is not scheduled for retry. A flow whose lease has been released SHALL NOT keep an unrecoverable `running` run.

#### Scenario: Orphaned run behind a released lease
- **WHEN** a flow run is in `running` state and the flow's lease has been released (`leaseExpiresAt` is null)
- **THEN** the next scheduler recovery pass marks the run failed as stale-recovered and the flow can run again

#### Scenario: Orphaned run behind an expired lease
- **WHEN** a flow run is in `running` state and the flow's lease expired
- **THEN** the next scheduler recovery pass marks the run failed as stale-recovered

#### Scenario: Run scheduled for retry is not recovered
- **WHEN** a `running` flow run has a retry scheduled
- **THEN** recovery does not mark it stale-recovered

### Requirement: Finalization failure preserves the lease
When finalizing a completed execution fails, the system SHALL NOT release the flow's lease. The run's state SHALL be preserved and the lease SHALL be left to expire so that stale-run recovery resolves the run.

#### Scenario: Finalization throws
- **WHEN** the finalization of a finished flow run fails with an error
- **THEN** the flow's lease is not released
- **AND** the failure is logged with the flow id and run id
- **AND** the run remains recoverable by the scheduler once the lease expires

### Requirement: Users can stop an active flow run
The flows UI SHALL offer a stop control for a flow whose latest run is active (`running` or `waiting_for_human`) on the flows list page and the run history header, and for each `running` run on its run card. The control SHALL call the existing run-cancel endpoint and SHALL NOT bypass or duplicate its permission checks; a `waiting_for_human` run card SHALL keep its dedicated human-response cancel affordance instead of a second stop control.

#### Scenario: Stop from the flows list
- **WHEN** a flow's latest run is active and the user views the flows list
- **THEN** the run control shows a stop action in place of the run action
- **AND** confirming it cancels the run via the cancel endpoint and refreshes the list

#### Scenario: Stop from the run history
- **WHEN** the flow detail view shows an active run
- **THEN** the header offers the stop action and a `running` run card offers a per-run stop action

#### Scenario: Cancel permission is enforced by the API
- **WHEN** a user without permission to cancel the run invokes the stop action
- **THEN** the cancel endpoint rejects the request and the UI surfaces the error

### Requirement: Cancelling or recovering a run settles its in-flight steps
When a run is cancelled or recovered as stale, its step records that are still `pending`, `running`, or `waiting_for_human` SHALL be settled to `failed` with the corresponding error (`flow_run_cancelled` / `flow_run_stale_recovered`). Already-final step records SHALL be left untouched. Step settling SHALL happen in the same service operation that settles the run, because the runner never revisits step rows after cancellation and stale runs have no living runner.

#### Scenario: Stop leaves no spinning step
- **WHEN** a user cancels an active run whose current step is `running`
- **THEN** the step record is settled to `failed` with error `flow_run_cancelled` and the run history no longer renders it as in-flight

#### Scenario: Recovery settles orphaned steps
- **WHEN** stale-run recovery marks orphaned `running` runs as failed
- **THEN** the in-flight steps of those runs are settled in the same tick

### Requirement: Provider syncs never dispose the instance under an active run
A provider-access sync that disposes the workspace instance SHALL re-check for active runs immediately before the dispose — not only before the sync starts — because disposing aborts any in-flight generation. Credential writes SHALL still complete when a run appears during the sync; only the destructive dispose SHALL be skipped, deferring provider-discovery reload to a later sync. Dispose decisions and session-family aborts SHALL be logged with their targets so runtime `MessageAbortedError` reports can be correlated with their source.

#### Scenario: A run starts while a sync is in flight
- **WHEN** a run registers in the workspace after the sync's initial deferral check but before the dispose fires
- **THEN** the credential writes are kept, the dispose is skipped, and the run's generation is not aborted

#### Scenario: No run starts during the sync
- **WHEN** no active run is present after the credential writes complete
- **THEN** the instance is disposed to reload provider discovery as before
