## Purpose

Defines the event stream the workspace UI consumes: a versioned, harness-neutral schema produced by the BFF, together with its delivery, heartbeat, reconnect, and hydration semantics, so the browser never depends on a harness's wire format.

## ADDED Requirements

### Requirement: The browser receives only Arche events
The workspace event endpoint SHALL translate every harness event into an Arche event before writing it to the browser, and SHALL drop harness events with no Arche equivalent. Every Arche event SHALL carry a schema version and a type from a closed set: `session.upserted`, `session.removed`, `session.status`, `session.error`, `message.upserted`, `message.removed`, `part.upserted`, `part.delta`, `part.removed`, `permission.asked`, `permission.resolved`, `workspace.touched`, plus Arche workspace notifications.

#### Scenario: Harness emits a known event
- **WHEN** the harness emits a text delta for a message part
- **THEN** the browser receives a `part.delta` event carrying session id, message id, part id, and the delta text

#### Scenario: Harness emits an event Arche does not model
- **WHEN** the harness emits an event type with no Arche mapping
- **THEN** nothing is written to the browser for that event

#### Scenario: File changes in the workspace
- **WHEN** the harness reports a file was created, edited, or deleted, or the todo list changed
- **THEN** the browser receives a single `workspace.touched` event

### Requirement: Part payloads use Arche part kinds
Message parts in events and in message snapshots SHALL use the Arche part kinds: text, reasoning, file, image, tool (with pending, running, completed, error states), permission, step-start, step-finish, patch, agent, subtask, retry, and unknown. A harness part with no mapping SHALL be delivered as `unknown` with its original type name.

#### Scenario: Tool call completes
- **WHEN** the harness reports a tool call finished with output
- **THEN** the part is delivered as kind `tool` with state `completed`, the tool name, input, output, and title

#### Scenario: Unmapped part kind
- **WHEN** the harness emits a part of a kind Arche does not model
- **THEN** the part is delivered as `unknown` with the original type preserved for debugging

### Requirement: Snapshots and live events produce the same state
Message and session snapshots returned by the server SHALL use the same Arche schema as live events, so applying the snapshot and then the live events yields the same state as receiving every event from the start.

#### Scenario: Client hydrates after reconnecting
- **WHEN** the browser reconnects, loads a session snapshot, and then applies live events
- **THEN** the rendered conversation matches the conversation of a client that stayed connected

### Requirement: The stream stays alive and never controls execution
The endpoint SHALL send a heartbeat at least every 10 seconds, SHALL bound only the upstream connect with a deadline, and SHALL release the upstream subscription when the browser disconnects. Closing or failing the stream SHALL NOT abort any harness session.

#### Scenario: Browser tab closes during a run
- **WHEN** the browser disconnects while a session is busy
- **THEN** the upstream subscription is released and the session keeps running to completion

#### Scenario: Upstream is unreachable
- **WHEN** the harness event endpoint does not accept the connection within the connect deadline
- **THEN** the endpoint responds `502` with `{ error: 'event_stream_unavailable' }`

### Requirement: Translation does not add noticeable latency
Translating harness events SHALL be synchronous and per event, with no buffering across events, so the BFF forwards each delta as soon as it arrives.

#### Scenario: Streaming text
- **WHEN** the harness emits a sequence of text deltas
- **THEN** each delta is written to the browser before the next upstream event is read
