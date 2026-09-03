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

#### Scenario: Instance becomes healthy again after a dispose
- **WHEN** a sync disposes the instance
- **THEN** the sync waits for the instance health endpoint to report healthy (bounded timeout) before returning, because dispose exits the OpenCode process and callers immediately create sessions against it

#### Scenario: No run starts during the sync
- **WHEN** no active run is present after the credential writes complete
- **THEN** the instance is disposed to reload provider discovery as before

### Requirement: Unconfirmed termination settles the message run
When a prompt's runtime termination cannot be confirmed, the flow run SHALL remain preserved for lease-expiry recovery, but its tracked message run SHALL be settled to `failed` with the termination cause instead of lingering in `running` until the message-run timeout, because a lingering lock blocks provider syncs for the workspace.

#### Scenario: Abort confirmation times out
- **WHEN** the abort of a session family does not reach a confirmed idle state within the confirmation window
- **THEN** the message run is marked failed with the termination cause and the flow run remains recoverable

### Requirement: A skipped dispose withholds the provider sync record
A provider-access sync whose dispose was skipped due to an active run SHALL NOT record a fresh provider sync state, so subsequent syncs retry the full sync — re-writing credentials and disposing — once the workspace is idle, instead of short-circuiting on a fresh timestamp while the instance runs on stale cached discovery. A sync that runs with disposal intentionally disabled SHALL still record its state.

#### Scenario: Discovery reload is not lost after a skipped dispose
- **WHEN** a sync writes new gateway tokens but skips the dispose because a run started during the sync
- **THEN** no fresh sync state is recorded and the next sync after the workspace idles re-writes credentials and disposes

### Requirement: Empty assistant output errors name the model and part profile
When a flow step completes without assistant text, the raised error SHALL keep the stable `flow_no_assistant_output` code and append the provider, model, and the part-type profile the assistant messages contained, so reasoning-only, tool-only, and truly empty responses are distinguishable in run history and logs.

#### Scenario: Model replies without text parts
- **WHEN** the latest assistant messages contain no `text` parts (for example only reasoning and tool parts)
- **THEN** the step fails with `flow_no_assistant_output` suffixed by the provider, model, and observed part types
