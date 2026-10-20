## Purpose

Preserves users' OpenCode 1.x conversation history when a workspace moves to OpenCode 2.x: sessions are exported into an Arche-owned archive and stay readable, but are no longer runnable.

## ADDED Requirements

### Requirement: v1 sessions are archived before a workspace switches runtime
Before an instance first starts with a runtime kind other than `opencode-v1`, the system SHALL export every v1 session of that workspace (metadata, messages, and parts in the Arche schema) into the archive, while the v1 data is still readable. The switch SHALL NOT proceed until the export has succeeded or the workspace has no v1 sessions.

#### Scenario: Workspace with history switches to v2
- **WHEN** an instance with 40 v1 sessions starts for the first time as `opencode-v2`
- **THEN** all 40 sessions are in the archive before the v2 runtime starts serving the user

#### Scenario: Export fails
- **WHEN** archiving the v1 sessions fails
- **THEN** the instance starts as `opencode-v1`, the failure is logged with the slug, and the switch is retried on the next start

### Requirement: Archived sessions are readable but not runnable
The sessions UI SHALL list archived sessions apart from live ones and SHALL render them read-only with the same message renderer. Prompting, aborting, renaming, or replying to permissions on an archived session SHALL be rejected with the typed error `session_archived`.

#### Scenario: User opens an archived session
- **WHEN** a user selects an archived session
- **THEN** its conversation is shown with no composer and a notice that it was created on the previous runtime

#### Scenario: Prompt sent to an archived session
- **WHEN** a client submits a prompt to an archived session id
- **THEN** the request fails with `session_archived` and nothing reaches the harness

### Requirement: Integrations bound to v1 sessions recover
A Slack thread or DM binding, flow run, or message run that references a v1 session SHALL NOT fail permanently after the switch. Slack bindings SHALL start a new live session on the next message, and in-flight v1 runs SHALL be settled as failed with `runtime_migrated`.

#### Scenario: Slack thread continues after migration
- **WHEN** a user replies in a Slack thread bound to a v1 session that is now archived
- **THEN** a new live session is created, the binding is updated, and the reply is answered

### Requirement: Archive access is scoped to the workspace owner
Archived sessions SHALL be readable only by users authorized for the owning workspace, with the same checks as live sessions, and SHALL be deleted when the workspace user is deleted.

#### Scenario: Other user requests an archived session
- **WHEN** a user requests an archived session belonging to another workspace
- **THEN** the request is rejected as not found
