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

## Current subscription and parity evidence (SC-2 / SC-9)

**Production subscription is guarded.** `subscribeOpenCodeEvents` returns typed
`runtime_unsupported` before credential lookup or transport because unfinished
snapshot/delta overlap, missed inbox enqueue at reconnect and full session/control
parity remain unresolved. A regression proves it opens no production transport.
There is no test-only runtime flag or gate bypass; the runtime contract still
calls only this guarded wrapper. SC-2 / SC-9 full acceptance remains deferred.

The separate adapter-internal `connectOpenCodeEvents` transport is implemented
and directly tested using the installed client. It returns after authenticated
SSE **headers**, without waiting for a first event. Its initial
location/session inventory scopes notifications that lack a location; located
events are filtered to the workspace. Only ownership IDs/cursors are retained
in the adapter, not cross-event message/tool payloads. Translation remains a
synchronous per-event function, with no per-event HTTP requests. Connect failures
are typed; caller cancellation or iterator exit releases only the subscription,
never session execution. The BFF continues owning its existing connect deadline
and ten-second heartbeat.

Partial updates use discriminated modes under the existing closed Arche event
types: `message.upserted` (full, patch, stage, commit), `message.removed`
(including staged cancellation), and `part.upserted` (including tool patches).
The shared reducer merges call IDs, retains explicit raw input while pending,
applies addressed completion/errors/accounting, and stages inbox input until
delivery supplies its durable timestamp. Ended text is authoritative, including
shorter replacement. V1's default full-upsert behavior remains unchanged and its
frozen golden suite passes. Session renames opt into replacement semantics.

The isolated capture was rerun on **2.0.32** during this fix. A temporary offline
replay check (removed afterward, not a filesystem-dependent CI test) reduced its
entire event stream and matched **complete** native conversation snapshots for
text, read/permission/tool plus final reply, and mixed reasoning/text sessions.
This included instruction records, delivered user messages, agent/model,
creation/completion times, tool metadata, and accounting, without hydration.
System/synthetic message identity is not guessed: installed
`dist/chunks/shared-events-m77rqa4a.js:13` defines `messageIDFromEvent` as
`eventID.replace(/^evt_/, "msg_")`; lines 628–648 apply it to instructions and
synthetic events. The new capture also verified instruction IDs against native
message snapshots. Synthetic-only tool attachment/chart/error tests remain
separately labeled as synthetic evidence, not live MCP acceptance.

Deterministic tests additionally cover native snapshot transforms at text
reconnect cut points, stale events against completed snapshots, shared pending
tool updates awaiting hydration, permissions, retries/errors, children/rename,
source failure/reconnect, quiet headers-only streams, auth/location isolation,
and subscriber-local cancellation through the real installed client with mocked
HTTP transport. They do not prove every possible concurrent hydration race.

`OpenCodeEvent` is the installed generated `EventSubscribeOutput` union. Despite
the package also declaring a broader `V2Event`, it does not admit
`session.message.content.updated`; that 2.1 spike mapping is not claimed here.

## Native replay/cursor recheck (SC-2 / SC-9, 2026-10-20)

The same capture command above now asserts a concrete unfinished-text reconnect
counterexample against **2.0.32**, not only completed-conversation parity. Its
synthetic provider pauses after each of two text chunks, so both snapshots/logs
are read while the same assistant message remains unfinished. These are probe
barriers, not production buffering.

| Observation | Verified result |
| --- | --- |
| Global stream contract | The running server's `/openapi.json` declares no parameters for `/api/event`. The native client accepts subscriber cancellation/activity, not a replay cursor. |
| Continuous subscriber | Receives `Hello ` then `fixture`, immediately. |
| Native message snapshots after each chunk | Both contain the same unfinished assistant text part with `text:""`; neither contains the streamed prefix. The envelope has `data` and pagination `cursor`, not a snapshot event watermark. |
| Reconnect with `Last-Event-ID` set to the first delta's actual ID | Receives a fresh connection marker and only `fixture`, not the earlier `Hello `. Snapshot plus this live continuation cannot equal the continuously connected prefix before text completion. |
| Native `session.log({sessionID, follow:false})` | Exists and returns `log.synced` with an aggregate sequence. Before and after the second delta the entire response is the same marker (`seq:6` in this capture). The delta has no durable sequence. |
| Log after completion, with omitted `after`, `after:0`, or `after:1` | Each returns only `log.synced` (`seq:10`), with no historical event payloads, even though the global capture contains enqueue at seq 1 and delivery at seq 4. Reading after the earlier sync sequence likewise works but does not recover missing text. |

Thus the previous statement that no native replay cursor was verified was too
broad: **a per-session durable log cursor and sync marker are verified**, but
they do not supply the required transient text replay, snapshot watermark or
missed enqueue payload in this production-style foreground launch. Do not
treat `log.synced` as a boundary for `message.list` or global SSE.

Supplementary source at the `v2.0.32` tag explains the log result:
[`packages/core/src/bus.ts`](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/bus.ts)
defaults `configured`'s `persist` option to false, gates historical event writes
on it, and implements `log` over stored durable events.
[`packages/core/src/session.ts`](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/session.ts)
filters that log to durable session events and `log.synced`. The installed
`SessionEventDurable` declaration excludes text/reasoning/tool-input deltas and
tool progress. Source is explanatory, not proof of an additional supported
foreground configuration; no persistence switch or embedded-runtime workaround
was added or assumed. Even durable persistence would not alone recover the
missing transient prefix.

The [native client guide](https://opencode.ai/v2/docs/build/client) explicitly
documents global subscriptions as live-only, without replay or automatic
reconnect. Production subscription therefore **remains unsupported**. A
deterministic test now checks both the adapter wrapper and the actual runtime
contract refuse before auth lookup/fetch. There is no production success-path
test or acceptance claim: enabling the partial internal transport would violate
the reconnect requirement. Waiting for ended text, cross-event payload buffering,
per-event snapshot reads, timestamp/content-overlap guessing, upgrading the pin,
or adding a durable Arche relay are not implemented as workarounds.

Full session/control parity also remains incomplete independently of this
counterexample: current translation does not reconstruct complete session
timestamps/outcomes or every agent/model/location, skill/shell, compaction and
revert history/control record. This recheck does not broaden that implementation
or relax any startup/provider/family-idle gate.

## Remaining boundaries

- Late/nested/tool-created child discovery; queued-input drain/cancellation;
  retry and background subagent termination beyond the explicitly created child.
- MCP direct/Code Mode metadata and actual chart/document/file tool results;
  identity propagation. Synthetic metadata preservation tests are not evidence
  of MCP transport behavior.
- Arbitrary in-flight snapshot/live overlap is incompatible with the verified
  native surfaces above: unfinished text can be absent from both snapshots and
  replay. Durable log cursors do not watermark snapshot contents or transient
  deltas. Completed snapshots rejecting old message-addressed events is not a
  universal overlap solution.
- A reconnect that misses inbox enqueue and observes only delivery lacks the
  payload until normal history hydration. Full session timestamp/outcome parity
  and all control-record/content-replacement cases remain unproven. Thus SC-2's
  unrestricted full live/snapshot acceptance is **not claimed complete**.
- Image behavior and manual UI/end-to-end acceptance. No default runtime flip.

## Previous phase verification (historical)

- Baseline web suite: 537 files / 5,557 tests passed; 5 files / 19 tests skipped.
- Final web suite: 544 files / 5,657 tests passed; 5 files / 19 tests skipped
  (includes concurrent main/other-agent tests).
- Focused transform/events suite: 29 tests passed.
- Full lint: zero errors, 18 unrelated existing warnings. Focused lint of these
  TS/MJS files: no warnings or errors.
- Typecheck: 241 existing test diagnostics, zero production-source diagnostics
  and no diagnostics in these delegated files; matches the PRD gate.
