# OpenCode 2.0.32 local event evidence

Captured 2026-10-20 with the installed `opencode` binary and installed
`@opencode/client@2.0.32`. Run from `apps/web`:

```sh
node src/lib/harness/adapters/opencode-v2/__tests__/capture-local.mjs
```

The manual probe uses a short-lived foreground loopback server, random in-memory
Basic-auth password, isolated HOME/XDG directories, a scratch project under the
repository, and a loopback OpenAI-compatible stub with a dummy key. Only the
fixture provider is permitted. No host-service discovery/restart, real provider
credentials, package installation, or deployment is used. Both servers are
stopped and the exact generated scratch directory is removed in `finally`.
The probe is deliberately not part of deterministic Vitest runs.

The full sanitized SDK capture is emitted to stdout, not written outside the
repository. `fixtures.ts` retains selected actual
text/tool/permission payloads and snapshots from the first successful SDK run,
plus mixed reasoning/text payloads from the second. Event IDs, durable sequence
numbers and mixed-envelope timestamps are normalized; workspace paths are
replaced by `/workspace`. Payload values, native message IDs and message
timestamps are retained. These are local-binary fixtures, not image acceptance.
Synthetic metadata/attachment/error cases in unit tests are not live captures.

## Confirmed observations

- `/api/event` delivers `data`, not V1 `properties`. Text and reasoning start,
  delta and end events have a message ID and **per-kind** ordinal: the first
  reasoning part and first text part both have ordinal zero. Snapshot array
  positions therefore cannot be used directly as text/reasoning IDs.
- Native `message.list` items do not contain a session ID. Add the requested
  `sessionID` before calling `toHarnessMessage`; do not infer it from event IDs.
- Native assistant messages provide per-step cost/tokens. Session usage updates
  are cumulative (two steps yielded 22 input / 6 output tokens versus 11 / 3
  per assistant message). Only message accounting becomes a `step-finish` part.
  The existing Arche accounting contract exposes input/output, not separate
  cache/reasoning counters.
- Actual `read` events: input-start contains name; called contains parsed input
  but no name; success contains text content/metadata but neither name nor
  input. A completed snapshot contains all fields and the same tool call ID.
- Permission asked/list snapshots agree on ID, session ID, action, resources and
  source tool/message ID. While waiting for a permission, `session.active()`
  contains that session as `{type:"running"}`. Replying once emitted replied
  then tool-success. Read metadata (`truncated:false`) survived snapshots.
- `switchAgent`/`switchModel` followed by `get` reports the new agent/model;
  separate agent/model-switched records appear in history.
- A normal prompt with `id:"msg_fixture_text"` returns that ID and the delivered
  historical user message retains that ID. Its creation timestamp is the
  delivery timestamp, not necessarily the inbox acknowledgement timestamp.
- Prompt `resume:false` with `id:"msg_fixture_caller"` remains in the inbox,
  leaves `active()` empty, and creates **no historical user message** during the
  observation window. It is not a delivered no-reply message. Enqueued events
  must not be converted into durable historical user messages prematurely.
- A slow parent and explicitly created child both reached the local stub and
  appeared in `active()`. Backgrounding the child retained both active entries.
  Interrupting the parent with `resume:false` returned `interrupted:true` and
  left the child active; interrupting the child then yielded an empty active
  map. Parent interruption alone is not family-idle confirmation.
- Interrupt emitted step-failed `{type:"aborted",message:"Step interrupted"}`
  and execution-interrupted. Step-failed has neither agent/model nor original
  creation timestamp; step-ended similarly cannot create a full message.

## Why subscription fails closed

`subscribeOpenCodeEvents` returns typed `runtime_unsupported` with an explicit
`UNVERIFIED` detail before connecting. Safe synchronous translations and snapshot
transforms are implemented/tested, but a partial live stream is not represented
as a working subscription. Complete reduce/live/snapshot equivalence is **not**
claimed. Only text-prefix/permission goldens and hydration-after-stream parity
pass under the present Arche reducer.

The permitted changes exclude the shared Arche schema/reducer. Completing D2
requires Arche-owned partial-message/tool updates, raw tool-input semantics,
authoritative content replacement/removal, and replay/hydration reconciliation.
Tool patches must merge by native call ID without inventing missing names or
inputs. Message patches must address the exact message and preserve prior
agent/model/timestamps while updating completion/errors/accounting. An inbox
event cannot safely provide a durable user-message timestamp before delivery.
Session rename also needs the reducer to apply incoming titles (it currently
keeps existing titles). None of this should introduce adapter cross-event state
or per-event snapshot HTTP requests.

`OpenCodeEvent` is the installed generated `EventSubscribeOutput` union. Despite
the package also declaring a broader `V2Event`, it does not admit
`session.message.content.updated`; that 2.1 spike mapping is not claimed here.

## Still UNVERIFIED

- Late/nested/tool-created child discovery; queued-input drain/cancellation;
  retry and background subagent termination beyond the explicitly created child.
- MCP direct/Code Mode metadata and actual chart/document/file tool results;
  identity propagation. Synthetic metadata preservation tests are not evidence
  of MCP transport behavior.
- Multi-part authoritative replacement, reconnect/hydration races, stale delta
  duplication, subscriber isolation and complete event parity.
- Image behavior and manual UI/end-to-end acceptance. No default runtime flip.

## Verification at handoff

- Baseline web suite: 537 files / 5,557 tests passed; 5 files / 19 tests skipped.
- Final web suite: 544 files / 5,657 tests passed; 5 files / 19 tests skipped
  (includes concurrent main/other-agent tests).
- Focused transform/events suite: 29 tests passed.
- Full lint: zero errors, 18 unrelated existing warnings. Focused lint of these
  TS/MJS files: no warnings or errors.
- Typecheck: 241 existing test diagnostics, zero production-source diagnostics
  and no diagnostics in these delegated files; matches the PRD gate.
