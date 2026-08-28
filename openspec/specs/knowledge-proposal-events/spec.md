## Purpose

Keeps the workspace Curator badge (pending knowledge review proposals) live during a session by pushing proposal-change notifications from the server boundaries that create proposals to the user's connected browser sessions over the existing workspace event stream.

## Requirements

### Requirement: Proposal creation notifies the owning user's connected sessions
The system SHALL emit a knowledge-proposals-changed notification to the browser sessions of the user on whose behalf a knowledge review proposal was created, for every creation path (learning tool submissions from workspace containers and MCP knowledge tool submissions). The notification SHALL NOT be emitted when proposal creation fails.

#### Scenario: Learning run creates proposals while the workspace is open
- **WHEN** a learning run creates one or more proposals via the learning tool while the user's workspace page is open in a browser
- **THEN** the pending-proposal badge count updates without a page reload and without opening the Curator

#### Scenario: MCP knowledge tool submits a proposal
- **WHEN** an MCP knowledge tool call successfully creates a knowledge review proposal for a user with a connected browser session
- **THEN** that user's pending-proposal badge count updates

#### Scenario: Proposal creation fails
- **WHEN** a proposal creation request fails validation or persistence
- **THEN** no notification is emitted and badge state is unchanged

### Requirement: Notifications are scoped per user
A knowledge-proposals-changed notification SHALL only be delivered to event streams authenticated for the same user the proposal belongs to. Users SHALL NOT receive notifications about other users' proposals.

#### Scenario: Another user is connected
- **WHEN** a proposal is created for user A while user B (a different user) has an open workspace event stream
- **THEN** user B's stream receives no notification and user B's badge is unchanged

### Requirement: Notifications ride the existing workspace event stream
The notification SHALL be delivered over the user's established workspace event stream, multiplexed with the runtime events already carried there, and SHALL NOT require the browser to open additional connections. Delivery SHALL be best-effort: when no stream is connected, or delivery fails, proposal creation still succeeds and the pending count converges through the existing refresh paths.

#### Scenario: Notification arrives on the open stream
- **WHEN** a proposal is created while the user's workspace event stream is connected
- **THEN** the notification is delivered on that stream as an event distinguishable from runtime chat/session events

#### Scenario: No browser connected
- **WHEN** a proposal is created and the user has no connected event stream
- **THEN** proposal creation completes successfully and nothing is queued for later delivery

### Requirement: Client refresh coalesces bursts and recovers after reconnect
The client SHALL refresh its pending-proposal count from the server upon receiving a knowledge-proposals-changed notification, coalescing a burst of notifications into at most one count refresh within a short debounce window. The client SHALL also refresh the count when the event stream is established or re-established, so notifications missed while the stream was down are recovered.

#### Scenario: Curator run proposes in a burst
- **WHEN** several notifications arrive in quick succession (a curator run proposing multiple files)
- **THEN** at most one count refresh runs after the burst settles and the badge shows the server-side count

#### Scenario: Stream reconnects after missed proposals
- **WHEN** proposals were created while the event stream was disconnected and the stream then reconnects
- **THEN** the client refreshes the pending count and the badge reflects the proposals created during the gap

### Requirement: Chat event processing remains unaffected
A knowledge-proposals-changed notification passing through the client event pipeline SHALL NOT alter chat messages, session status, permissions, or workspace-file refresh behavior driven by runtime events. Runtime events on the stream continue to be processed exactly as before the notification existed.

#### Scenario: Notification arrives mid-conversation
- **WHEN** a notification arrives while a conversation is streaming a response
- **THEN** the conversation's messages, parts, and session status are unaffected and continue updating normally
