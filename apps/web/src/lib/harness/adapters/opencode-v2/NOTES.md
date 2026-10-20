# OpenCode V2 contract spike (task 1.1)

## Phase-3 local re-check (2026-10-20)

**Partial implementation; V2 is not enabled.** The installed foreground binary is
`opencode v2.0.32`, whereas the source spike inspected client `2.1.0`. Installing
dependencies was denied by execution permissions (including the preceding
phase's missing MCP SDK/lockfile). The denied installation was not retried.
`@opencode/client` has therefore not been installed or added without a matching
lockfile. Raw HTTP evidence below does **not** establish client compatibility.
An npm-metadata re-check found exact client version `2.0.32` is published (latest
was `2.1.1` at that check); a future authorized install can test the matched pair
rather than assuming spike client `2.1.0` is compatible.
The registry returns `runtime_unsupported` for `opencode-v2`, including file
operations; it must never send V1 requests to a recorded V2 instance. Keep the
deployment default and image/version pins on V1 until the remaining gates pass.

Two short-lived, loopback-only foreground servers were exercised with an
ephemeral password, no inherited provider credentials, and isolated HOME/XDG and
temporary directories inside the repository. Both processes were terminated and
their scratch directories removed. No shared host service, model generation,
gateway request, or production mutation was used. Documentation for native V2
migration, config, permissions, policies, MCP, API and the client was re-read.

| Re-check | Observed result on local 2.0.32 | Remaining boundary |
| --- | --- | --- |
| Command/auth/readiness (gates 1–2) | `serve --help` accepts hostname/port; foreground `serve --hostname 127.0.0.1 --port <ephemeral>` starts and terminates. `OPENCODE_SERVER_PASSWORD` authenticates Basic `opencode`; missing auth returns 401. `/api/info` initially returns 503, then 200 with `version: "2.0.32"` and `capabilities.persistentPty: true`. | Image behavior, wrong-auth test, `OPENCODE_PASSWORD` precedence, restart/storage and resource measurements remain **UNVERIFIED**. A TCP accept/OpenAPI 200 is not readiness. |
| Session API (gate 3) | Create/get return raw HTTP `{data: SessionInfo}`. Session info contains `id`, `projectID`, `cost`, `tokens`, `time`, `title`, `subpath`, `location`. List returns `{data, cursor:{previous,next}}`; even a one-item page has non-null next/previous. Empty children/messages return empty data with null cursors. Rename/delete return 204. Get of the deleted session returns 404 with `_tag: "SessionNotFoundError"`, `sessionID`, `message`. | Full pagination termination must be tested (do not stop merely because a short page has a cursor). Directory isolation, real child families, model/agent selection, and SDK error decoding remain **UNVERIFIED**. |
| Status/abort (gate 4) | `/api/session/active` returns `{data:{}}` when idle. Interrupt of the existing idle session returns `{interrupted:false}`. | Busy/retry/permission/queued/background work, late children and actual family termination remain **UNVERIFIED**. These observations are not abort confirmation. |
| Prompt/files (gate 5) | Live OpenAPI exposes `/api/fs/list`, `/api/fs/find`, `/api/fs/read/*`. List/find return `{location,data: FileSystem.Entry[]}`; read streams binary, unlike V1's JSON file-content shape. Find accepts query/type/limit; list allows outside-location paths. | No prompt or file read/search was executed. Ignore-aware bounded fuzzy parity and path safety remain **UNVERIFIED**; V2 needs its own typed files bridge, not V1 endpoints or an unvalidated sidecar substitution. |
| Provider sync (gate 6) | Live OpenAPI exposes credential create/list/remove/activate and location reload. Reload on the empty isolated location returns 204. | No credential was created or read. Integration mapping, gateway-only access, revocation/fallback, active-run deferral and post-reload effective access remain **UNVERIFIED**. Do not claim successful sync or record freshness from reload alone. |
| SSE (gate 7) | Authenticated `/api/event` emits `data: {id,type:"server.connected",data:{}}`, blank-line framed, followed by `: heartbeat`. Closing the HTTP reader needs no interrupt request. | No model-derived events captured; live/snapshot equivalence, reconnect races, subscriber isolation and the SDK connect deadline remain **UNVERIFIED**. BFF's existing ≤10s heartbeat is still required. |
| MCP/identity (gate 8) | Empty `/api/mcp` and `/api/permission/request` return `{location,data:[]}`. | With MCP installation blocked, normalized tool names, direct-vs-Code Mode metadata, session `_meta`, agent attribution and actual exact allowlists remain runtime-**UNVERIFIED**. Existing explicit attribution fallback must still fail closed when missing/conflicting. |
| Config/security (gate 9) | Live OpenAPI exposes `/api/config` and `/api/experimental/config`; docs describe native fields and policy placement. | Renderer tests are separate from runtime enforcement. Policy precedence, protected system placement, shell bypass resistance and caller-dependent self-delegation remain **UNVERIFIED** unless explicitly recorded by a later check. Never silently approximate a security guard. |

The source-spike operation table below remains useful for implementation, but its
**UNVERIFIED** labels are not superseded except for the exact local observations
above. Task 5.5, image rollout and manual 5.7 acceptance stay blocked; do not use
these credential-free probes as an end-to-end acceptance result.

### Config renderer handoff

The adapter renderers now accept an Arche-owned intermediate model. V1 rendering
is byte-identical under equivalence tests, and existing artifact hash tests are
unchanged. V2 native mapping has deterministic tests for primary/subagents,
spreadsheet-only allowlists, connector/provider targets and direct
`arche_tools` invocation. These tests are **not runtime enforcement evidence**.

The documented policy statement is only `{action, resource, effect}`; it has no
caller-agent predicate. A global `subagent:<id>` deny would prevent legitimate
delegation by other agents, while a per-agent permission deny is overridable and
does not satisfy D6. Therefore every protected V2 model currently returns the
typed `runtime_config_unsupported` error at `guards.selfDelegation`. Mapping-only
snapshots explicitly disable that required guard; production artifacts never do.
Do not remove this refusal until a verified non-overridable implementation exists.
No image/version pin was bumped and no SDK adapter was represented as functional.

During final checks an unowned `arche-tools/pnpm-lock.yaml` appeared in the working
tree. It was preserved, not authored or installed by this phase. The final web
suite passes with that file present; its existence does not verify MCP execution
or the unavailable V2 client dependency.

## Scope and evidence boundary

Research date: 2026-10-20. This is a documentation/source spike, not a runtime acceptance test. The pipeline brief explicitly permits no live container for 1.1, superseding the original task's container requirement. No container, local OpenCode service, model, production endpoint, or credential was used. No dependency, lockfile, runtime config, or task checkbox was changed.

The brief requests installation outside the repository, but the delegated runtime constraint prohibits writing there. Instead, Python's HTTP client fetched the published npm tarball and inspected it with `tarfile` over `io.BytesIO`, without extracting, installing, importing, or executing it. No scratch directory was needed. This resolves the location conflict without adding `@opencode/client` to `apps/web` before phase 3.

Evidence labels used below:

- **DOC**: published V2 documentation/API reference, fetched on the research date (mutable, not a release pin).
- **PACKAGE**: inspected published `@opencode/client@2.1.0` declarations and generated request implementation. This is the real V2 network client, **not** `@opencode-ai/sdk/v2`, which is the existing V1 SDK subpath.
- **SOURCE**: upstream source at the immutable commit below; supplementary implementation evidence, **not proof that the same code shipped in a particular image**.
- **UNVERIFIED**: not empirically exercised against the selected 2.x image. All endpoint behavior, ordering, identity forwarding, auth, and UI compatibility remain runtime-UNVERIFIED even where a signature is PACKAGE-confirmed. Phase 3 must re-check every UNVERIFIED item before relying on it and update this file.

### Reproducible sources

| ID | Evidence |
| --- | --- |
| P | npm metadata: <https://registry.npmjs.org/@opencode/client/latest>; resolved version `2.1.0`. Exact archive: <https://registry.npmjs.org/@opencode/client/-/client-2.1.0.tgz>. SHA-256 `2f8ac3ccc32d5a64010684b692c9b80f84c6d96410021aa0bdfa0e4a08b5d621`; registry SHA-1 `b78afbb08013d9f47eff600be1e91ceb11951c65`. Metadata has no `gitHead`. |
| P files | `package/package.json`, `dist/promise/generated/client.d.ts`, `dist/promise/generated/types.d.ts`, `dist/promise/client.d.ts`, `dist/promise/generated/client-error.d.ts`, and generated HTTP requests in `dist/chunks/rpc-runtime-nv358xrg.js`. |
| D0 | <https://opencode.ai/v2/docs/> |
| D1 | <https://opencode.ai/v2/docs/migrate-v1> — API/plugin breaks, native config, unsupported V1 fields. |
| D2 | <https://opencode.ai/v2/docs/build/client> — `OpenCode.make`, headers, subscriptions, service lifecycle. |
| D3 | <https://opencode.ai/v2/docs/api> and <https://opencode.ai/v2/openapi.json> — routes and schemas. Raw JSON fetched successfully with the web-fetch tool; Python urllib received HTTP 403. |
| D4 | <https://opencode.ai/v2/docs/mcp-servers> — Names, Permissions, Context, local/remote config. |
| D5 | <https://opencode.ai/v2/docs/config>, <https://opencode.ai/v2/docs/permissions>, <https://opencode.ai/v2/docs/policies> |
| D6 | <https://opencode.ai/v2/docs/cli> — shared service versus explicit server. |
| S | <https://github.com/anomalyco/opencode/tree/930c0c8b6a3c41ceb73b9372f878b5a1186b4d4e> (resolved `dev` once, then read raw files at that SHA). |
| ACP | <https://agentclientprotocol.com/protocol/session-setup>, <https://agentclientprotocol.com/protocol/prompt-turn>, <https://agentclientprotocol.com/protocol/session-list> — conceptual comparison only, not a transport adoption. |

P exports the Promise client by default, and separate `/effect` and `/service` entrypoints. Its dependencies are `@opencode/schema@2.1.0` and `@opencode/protocol@2.1.0`; no installation was performed. The chosen research version does not change `versions/opencode.version` or select a deployment image. Do not assume all 2.0.x images implement a 2.1.0 client contract.

**Contract drift:** D3's OpenAPI `info.version` is `0.0.1` (not the runtime version). At fetch time its session list/update omit `archived`, whereas P includes it; the API overview also omits `permission.saved.update`, which P exposes. Use only the common, inspected subset below and compare the eventual pinned image's `/openapi.json` with the chosen client. A `security: []` in the generated OpenAPI is not evidence of unauthenticated access; source has outer authentication middleware.

## Headless server, auth, health, events

| Concern | Finding and evidence | Runtime status / phase-3 check |
| --- | --- | --- |
| Headless command | SOURCE `packages/cli/src/commands/commands.ts:550` declares `serve`, `--hostname`, `--port`, repeatable `--cors`, and service/stdio modes; `commands/handlers/serve.ts` forwards host and port. Candidate for Arche remains `opencode serve --hostname 0.0.0.0 --port 4096` in the container, without `--service` or `--stdio`. Desktop binds loopback. | **UNVERIFIED** for the image entrypoint and binary flags. Check `serve --help`, startup, signal handling and restart; do not start the host's shared background service. |
| Server password | SOURCE `packages/cli/src/env.ts:10` reads `OPENCODE_PASSWORD`, then legacy `OPENCODE_SERVER_PASSWORD`. `server-process.ts:84–96` uses this for foreground serve, otherwise generates a random password; `--service` instead uses its service config. `packages/server/src/auth.ts` fixes username to `opencode`; `middleware/authorization.ts:32–38` decodes Basic auth. | **UNVERIFIED** that the chosen image honors the legacy variable and rejects missing/wrong auth. Explicitly set a nonempty ephemeral password; never log it. Avoid an inherited `OPENCODE_PASSWORD` silently overriding Arche's password. No auth proxy is justified by current source; the design's proxy fallback remains conditional on the actual image test. |
| Health/readiness | PACKAGE `client.server.info()` → `GET /api/info`, returning `{ version, pid, urls, paths, capabilities? }`, **not** `{ healthy: true }`. SOURCE `packages/server/src/process.ts:187–214` authenticates boot-time probes and returns 503 starting/stopping, 500 failed, 200 ready. | **UNVERIFIED** actual readiness responses. Adapter should require authenticated success, validate V2 version/shape, preserve bounded probe/start deadlines. Do not reuse `/global/health` or treat any TCP accept as ready. Confirm location/model readiness separately where needed. |
| Events | PACKAGE `client.event.subscribe({ signal })` → `GET /api/event`, SSE. The public client returns `AsyncIterable<V2Event>`. D2: lazy, one shared connection per client, base headers, subscriber-local cancellation, live-only, no replay/reconnect. SOURCE `handlers/event.ts`: `server.connected` first, comment heartbeat every 15 seconds. | **UNVERIFIED** wire frames, flush, cancellation isolation and reconnect. Arche must supply its own ≤10-second heartbeat; upstream's 15 seconds is insufficient. Bound connection establishment only, not stream lifetime. Closing a tab must never invoke interrupt. |

Use `OpenCode.make({ baseUrl, headers: { Authorization: authHeader } })` (P/D2); preserve the existing workspace-specific authorization boundary. The docs' generic Bearer-header example is not proof that foreground serve accepts Bearer auth. Do not use pairing links or query-string passwords for BFF traffic. `Service.ensure()` can start a host process and is not a container connection factory.

## V1 → V2 operations (design D1 coverage)

All V2 method names below were read in P, with paths checked in generated request code and D3. `id` in route descriptions means the relevant session ID; SDK input names use `sessionID`. Expected SDK rejections must be caught **inside the adapter** and converted to Arche typed results; P returns Promise values directly, not V1's ubiquitous `{ data, error }` wrapper. Paginated collections still contain `data` and `cursor`; agent/model lists contain `{ location, data }`.

| Contract operation / V1 implementation | V2 client and endpoint | Adaptation or written workaround |
| --- | --- | --- |
| Health (`/global/health`) | `server.info()`; `GET /api/info` | See readiness checks above. |
| Session create (`session.create`) | `session.create({ title?, parentID?, agent?, model?, location? })`; `POST /api/session` | Returns `SessionInfo` directly. Specify workspace directory for roots; children inherit parent location. Native model reference is `{ providerID, id, variant? }`, not V1 `modelID`. |
| Session get (`session.get`) | `session.get({ sessionID })`; `GET /api/session/{id}` | Normalize optional title, `parentID`, epoch timestamps and status into Arche's record. |
| Session list (`session.list`) | `session.list({ directory?, parentID?, cursor?, limit?, order? })`; `GET /api/session` | Follow `cursor.next` to exhaustion when full inventory is required (docs default to newest 50). Use workspace directory scope; never accidentally list another location. |
| Children (`session.children`) | **No `session.children` method.** `session.list({ parentID, directory?, cursor? })`; `GET /api/session?parentID=…` | Exhaust pagination per parent, traverse recursively with visited IDs. Filter is immediate children, not a proven transitive family. Check the root with `get`: an empty list is not evidence it exists. Include archived children if necessary; semantics/defaults require image verification. |
| Status (`session.status`) | **No `session.status` method.** `session.active()`; `GET /api/session/active` | Returns map `sessionID → { type: "running" }`. D3 defines foreground drains owned by this process; absent means inactive, not nonexistent. Combine with successful `get` and family discovery. Treat running as busy, including retries/waits until proven otherwise; do not copy V1 absent-status behavior blindly. See abort limitations below. |
| Update title (`session.update`) | `session.update({ sessionID, title })`; `PATCH /api/session/{id}` | Returns void/204; re-read only if the contract requires the updated record. SOURCE `handlers/session.ts:229` treats an empty title as a request to generate a title; do not assume it clears the title. |
| Delete (`session.delete`) | `session.remove({ sessionID })`; `DELETE /api/session/{id}` | D3 says deletes children too. Preserve Arche archive-mutation rejection before contacting runtime. |
| Messages (`session.messages`) | `message.list({ sessionID, cursor?, order?, limit? })`; `GET /api/session/{id}/message` | Not `session.messages()`. Exhaust pages in chronological order; records are a `type` union, not `{ info, parts }`. Normalize assistant `content`, tool states, files, errors, cost/tokens. |
| Prompt (`session.promptAsync` / parts, agent, model) | `session.prompt({ sessionID, text, files?, agents?, skills?, id?, metadata?, delivery?, resume? })`; `POST /api/session/{id}/prompt` | Returns a `SessionInboxUser`, not completion. There is **no selected-agent/model or arbitrary parts field** on this input. For an existing idle session use `session.switchAgent({ sessionID, agent })` → `POST /api/session/{id}/agent` and `session.switchModel({ sessionID, model })` → `POST /api/session/{id}/model` before prompt, under the same Arche submission lock. `agents[]` are mentions, not selected agent. Join text parts; map workspace files/images to `files: [{ uri, name? }]`. URI/data-URI support, ordering, and lossless handling of any other input parts are **UNVERIFIED**; reject unsupported parts explicitly rather than silently dropping them. |
| Abort primitive (`session.abort`) | `session.interrupt({ sessionID, resume? })`; `POST /api/session/{id}/interrupt` (`resume` is a query parameter) | Returns `{ interrupted: boolean }`, not confirmation of idle. Verify target exists first: SOURCE handler calls `session.interrupt` without the `get`/not-found translation used elsewhere. Do not return success for unknown IDs or an unconfirmed interrupt. |
| Pending permissions (`permission.list`) | `permission.request.list({ location? })` → `GET /api/permission/request`; `permission.list({ sessionID })` → `GET /api/session/{id}/permission` | Normalize `{ id, sessionID, action, resources[], message?, source?, metadata? }` into title/kind/resource fields consistently with asked events. Filter to the authorized workspace and include descendants. No V1 `permission.v2.asked` assumption. |
| Permission reply (`permission.reply`) | `permission.reply({ sessionID, requestID, decision, message? })`; `POST /api/session/{id}/permission/{requestID}/reply` | `decision` accepts exactly `once`, `always`, `reject`. Verify permission belongs to the requested session/family. D5 says reject also rejects other pending asks in that session; test UI resolution. |
| Available models (`provider.list` + transforms) | `model.list({ location? })`; `GET /api/model` (also `model.default`, `provider.list/get`) | Normalize provider/model IDs, capability, variant and price fields; credentials and policy affect availability. |
| Agents (`app.agents`) | `agent.list({ location? })`; `GET /api/agent` | Normalize `{ location, data: AgentInfo[] }`; preserve primary/subagent and disabled filtering. |
| Provider-access sync (`PUT/DELETE /auth/{provider}`) | `credential.list/create/remove/activate`; `GET/POST /api/credential`, `DELETE /api/credential/{credentialID}`, `POST /api/credential/{credentialID}/activate`; alternatively `integration.connect.key` → `POST /api/integration/{integrationID}/connect/key` | No direct V1 auth PUT equivalent. Proposed credential replacement sequence and blocking unknowns below. |
| Provider dispose + health wait (`POST /instance/dispose`) | **No instance dispose/shutdown method.** `location.reload()` → `POST /api/location/reload` | D3 says rebuilds **every loaded location**, cancels pending forms/permissions, running sessions use fresh services at next step boundary; waits for replacement builds. Not process exit. Defer while Arche runs are active; after reload, probe info plus affected location/model availability with bounded deadlines. Token-cache invalidation remains **UNVERIFIED**. |
| Event subscription (`event.subscribe`, `/event`) | `event.subscribe({ signal })`; `GET /api/event` | Translate on the server to Arche `v: 1` events, filter locations/session ownership, drop unmodeled event types. See inventory below. |
| Runtime config (`renderRuntimeConfig`, D6) | No API required; adapter renders files from neutral model | Write native V2 config, instructions and skills; use protected policy placement, not a browser-visible SDK type. Config map below. |

### Orchestration stays Arche-side

`execution.ts` must retain provider refresh, family-busy refusal, cursor capture, message-run creation, bounded wait, latest-assistant extraction and accounting. These are not replaced by a prompt acknowledgement or `session.wait()`. P does expose `session.wait({ sessionID })` at `POST /api/experimental/session/{id}/wait`, but it does not replace family discovery, run outcomes, deadlines or usage bookkeeping. Message-count cursors need complete chronological snapshots; native message IDs are useful but a cursor semantic change is not part of the seam refactor. V2 assistant messages expose `cost`, `tokens`, `error`, `finish`, and `model`, unlike V1 step-finish accounting.

**Abort-family workaround:** get the root, paginate/discover descendants, interrupt leaf-first, rediscover while stopping (catch newly spawned children), and confirm every discovered session inactive before the shared deadline. Transport errors, incomplete discovery, unresolved background work or expired deadline must yield `execution_termination_unconfirmed`, never guessed success. SOURCE/D3 only promise foreground drains from `active`; whether background subagents/tools escape that inventory is **UNVERIFIED and rollout-blocking**. `interrupt` acknowledgement alone cannot meet the spec. Test retries, permissions, queued inbox inputs, nested children, disappearing children, and a child that never stops. The correct `resume` setting and queued-input cancellation strategy are **UNVERIFIED**; do not assume an interrupt drains pending inbox work.

**Errors:** P's Promise client can reject with declared JSON errors or `ClientError` reasons (`Transport`, `UnexpectedStatus`, `UnsupportedContentType`, `MalformedResponse`, `SseEventTooLarge`). Decode the actual error tag/status/detail inside the adapter; map session-not-found, session-busy and transport failures without exposing SDK types. Do not turn every 404 into `session_not_found` (location/permission/agent can be missing). `session_archived`, `runtime_unsupported` and run-bookkeeping failures are Arche-side checks; `caller_identity_unavailable` is an Arche tool failure. Exact runtime error fixtures are **UNVERIFIED**.

### Provider sync workaround (not yet an implementation)

The baseline is `src/lib/opencode/providers.ts`: serialized sync, scoped short-lived gateway tokens, enabled-provider hash/TTL, special default OpenCode access, active-run deferral, dispose and bounded recovery. Preserve these guarantees.

P confirms `credential.create({ integrationID, value: { type: "key", key }, activate? })`, listing entries with `id`, `integrationID`, `active`, and `value`, removal by ID, and activation. **`credential.update` changes a label only; it does not replace a key.** Proposed phase-3 path: resolve actual integration IDs through `integration.list/get`, identify only Arche-managed entries, create/activate a replacement with the fresh scoped gateway token, then remove the replaced managed entry. On disable, revoke/remove managed entries without accidentally falling back to another credential/environment key. Do not delete unrelated accounts or log `credential.list()` (it contains secret values). Preserve per-workspace serialization and record sync freshness only after the intended state is usable.

**UNVERIFIED:** provider-ID → integration-ID association, custom gateway providers' credential resolution, whether key connection validates a gateway token upstream, create/activate cache invalidation, safe revocation/fallback behavior, and reload recovery. There is no evidence for blindly passing the old provider ID as an integration ID. Alternative if credential APIs cannot represent the gateway: render scoped `providers.<id>.settings.apiKey` (secret-safe file permissions/environment substitution), atomically replace config, reload at idle, and verify effective catalog/access; this is a written workaround, not a verified equivalence. If neither path passes, keep the instance on V1 and return sync failure. Do not persist a successful sync timestamp after a partial replacement or failed reload.

## Event names and snapshot parity

P's event payload is `event.data`, not V1 `properties`. Examples read from `types.d.ts`:

| V2 event family | Payload / proposed Arche mapping |
| --- | --- |
| `server.connected` | Connection marker only; not a replay boundary or idle signal. |
| `session.created`, `session.renamed`, `session.metadata.updated`, `session.agent.selected`, `session.model.selected`, `session.moved`, `session.forked` | Session facts → `session.upserted` or the corresponding Arche metadata update. Event timestamps/partial fields must normalize to the same session shape as snapshots. |
| `session.deleted` | `session.removed`. |
| `session.execution.started/succeeded/failed/interrupted`, `session.status`, `session.retry.scheduled` | Busy/idle/retry and `session.error`; failures carry `data.error: { type, message, status? }`. These are not V1 `session.error` frames. |
| `session.inbox.enqueued/delivered/cancelled` | User input lifecycle; map actual durable user messages, not acknowledgement twice. Reconcile with message snapshots. |
| `session.step.started/streamed/ended/failed` | `data.assistantMessageID`, agent/model, usage/finish/snapshot information → `message.upserted`, step parts and error metadata. |
| `session.text.started/ended/delta`, `session.reasoning.started/ended/delta` | `data.sessionID`, `assistantMessageID`, `ordinal`; delta adds `delta`, ended adds complete `text`. → text/reasoning part lifecycle and `part.delta`. Stable proposed part key uses message + kind + ordinal, never an event ID. |
| `session.tool.input.started/ended/delta`, `session.tool.called/progress/success/failed` | `data.id` is the call ID, `assistantMessageID` is the message. Input-start supplies name; called supplies parsed input; progress supplies metadata; success supplies `content` and optional metadata. → tool pending/running/completed/error. Snapshot tool states are `streaming/running/completed/error`; map streaming to Arche pending. |
| `session.message.content.updated` | Authoritative assistant content replacement; reconcile part IDs, updates and removals with snapshot transform. |
| `permission.asked`, `permission.replied` | Asked `data.id` is permission ID; replied uses `data.requestID` plus `reply`. → `permission.asked/resolved`, using the same normalization as pending-permission snapshots. |
| `filesystem.changed` | `data.file`, `data.event: add/change/unlink` → one `workspace.touched` per source notification. No V1 `file.edited` assumption. Step-ended `files` may also signal mutations. |

These are **PACKAGE-confirmed names, not recorded live fixtures**. Todo-specific event emission, removed-message semantics, images/files, charts/documents and subagent parts remain **UNVERIFIED**. Do not claim native support for every Arche part kind; use `unknown` with the original type when necessary. Preserve cost/usage without double counting step and cumulative usage events.

**Translation gap to resolve in phase 3:** tool-success events do not repeat name/input, tool-called events include input but not name, text-start does not contain complete text, and session updates are partial. A purely stateless full-object upsert cannot invent missing fields. Design stable IDs and patch/merge semantics consistent with snapshots (or seek a design clarification if adapter state is necessary). Do not await snapshot HTTP requests on each delta or buffer until completion; that violates design D2's latency requirement. Live-only SSE also leaves a subscribe/snapshot race: reconnect hydration must reconcile replacements/deltas without duplicates. Capture deterministic V2 fixtures and prove golden parity before shipping; no such fixtures or latency measurements were produced by this spike (task 2.6 owns the benchmark).

## Config and Arche-tools findings

D1/D4/D5 confirm the following native V2 rendering targets; P is a client declaration package, not a runtime config validator. The published `$schema` URL accepts deprecated V1 fields too; it must not be used as evidence that old syntax is the intended native shape.

| Existing input | Native target / caveat |
| --- | --- |
| `mcp.<key>`, `enabled` | `mcp.servers.<key>`, inverse `disabled`. Local command array and environment still supported; remote gateway header auth should use `oauth: false`. |
| `agent`, `prompt`, `disable`, separate variant | `agents`, `system`, `disabled`, `model: "provider/model#variant"`; agent sampling options under `request.body`. |
| `provider`, `npm`, `options.baseURL/apiKey` | `providers`, `package` (AI SDK packages prefixed `aisdk:`), `settings.baseURL/apiKey`. Verify each actual gateway transport; do not change endpoint semantics. |
| V1 permission maps/tool booleans | Ordered `permissions: [{ action, resource, effect }]`, last match wins; `bash → shell`, `write/patch → edit`, `task → subagent`. Agent-specific rules must preserve the exact tool allowlist. |
| Implicit external-path prompt | Explicit `{ action: "external_directory", resource: "*", effect: "ask" }`; V2 otherwise permits external paths by default. |
| Non-overridable guards | Protected system/global `policies`, e.g. `action: "tool.use"`, resource `edit:<protected-path-pattern>`, effect `deny`. Policies use `tool.use`, **not** the permission action `edit` directly. `subagent:<target-id>` can block a target, but a workspace-global rule cannot express caller-dependent self-delegation; phase 3 must preserve those per-agent guards without globally banning valid delegation. Placement/enforcement and shell bypass resistance are **UNVERIFIED**; policies are not a filesystem sandbox. |
| File definitions | `AGENTS.md`, preferred `.opencode/agents/`, `.opencode/skills/<id>/SKILL.md`; supported old definitions remain compatible. V1 plugins do **not** run in V2. |

### Exact MCP names and Code Mode

D4 **Names** defines `<server>_<tool>`; each character outside letters, digits, `_`, `-` becomes `_`. Therefore server `arche_tools`, tool `chart` becomes **`arche_tools_chart`**, not `arche-tools.chart` or `arche_tools__chart`. This is a rule, not a claim that all existing tool modules export that exact single tool; inventory actual registered names in task 4.4. Detect normalization collisions. Permission actions match the normalized name, so broad deny first then individual allowed `arche_tools_<name>` rules preserves spreadsheet-only agents.

D4 confirms per-server `codemode: false` for both local and remote MCP; default is true. Candidate V2 fragment (not installed or executed):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "arche_tools": {
        "type": "local",
        "command": ["node", "/opt/arche/arche-tools/server.js"],
        "codemode": false
      }
    }
  }
}
```

This path comes from design D5 and is a planned artifact, not an existing installed server. Direct invocation is the conservative selection to keep per-tool UI visibility. D4 says Code Mode groups tools under `tools.<normalized-server>.<normalized-tool>` and permissions still match `<server>_<tool>`. **UNVERIFIED:** whether default Code Mode hides/repackages per-tool parts, and whether direct mode preserves MCP content/metadata as Arche's chart/document attachments. Inspect actual tool-success events and hydrated snapshots in both modes; a config flag alone does not prove UI parity. Do not put this V2 shape into the V1 renderer during phase 2.

### Caller identity / `_meta`

D4 **Context** explicitly documents `CallToolRequest.params._meta["ai.opencode/sessionID"]` for session-originated direct and Code Mode calls over stdio and HTTP. SOURCE `packages/core/src/mcp/client.ts:372–375` constructs exactly that metadata when `sessionID` exists. The inspected call interface accepts `name`, `args`, `sessionID` — **not arbitrary caller metadata or agent ID**. There is no evidence that the network adapter can forward custom prompt `_meta` into MCP calls.

Thus **session metadata is DOC/SOURCE-supported, runtime-UNVERIFIED; agent metadata is unsupported by the inspected evidence, not confirmed forwarding**. Do not invent `ai.opencode/agentID`. Session correlation alone is not an authentication credential and must not authorize proposals/history. Continue workspace-scoped internal API authentication and ownership checks.

Possible design-D5 fallback: explicit `caller_agent` (and session context when metadata is missing), prefilling instructions as described in the design. This is model-supplied input, not hidden/trusted identity; the MCP server must validate it against authenticated runtime/Arche context for the actual invocation. Merely reading the session's current agent can race a switch and is not proof of the caller. Until reliable attribution is demonstrated, learning/session-history calls without resolvable required context return **`caller_identity_unavailable` and perform no side effect**. Agent-attribution transport/validation is a phase-3 blocker, not something this documentation declares solved.

## ACP mapping (D4; coverage, not adoption)

ACP capability negotiation is mandatory for optional methods. These are future-adapter answers, not claims that every ACP agent implements them. Native OpenCode HTTP remains the selected transport.

| Arche contract operation | ACP concept or explicit Arche-side answer |
| --- | --- |
| Health | Process/connection lifecycle plus `initialize`; no assumed HTTP health method. Arche owns readiness/deadlines. |
| Create | `session/new` with cwd and MCP configuration. |
| Get | Arche session index; optional `session/load` restores/replays history, not a read-only metadata GET. |
| List | Optional capability-gated `session/list`; otherwise Arche's persisted index. |
| Children | Arche-maintained parent/child graph or harness extension; not provided by the inspected ACP core. |
| Status | Arche tracks in-flight prompt and completion/stop reason, permission state and updates; no assumed global status-map RPC. |
| Update title | Arche-owned metadata plus agent-originated `session/update` (`session_info_update`); no assumed client title-mutation method. |
| Delete | Arche-owned retention/index removal with explicit adapter deletion capability. Current session-list docs mention optional `session/delete`, but the linked unversioned delete page returned 404 during research; not a verified base method. `session/close` only frees active resources and is not historical deletion. |
| Messages / cursor / latest reply | Capability-gated `session/load` replay of `session/update`, persisted in Arche's normalized history; random-access snapshots need an Arche store or extension. |
| Prompt parts | `session/prompt` content blocks, respecting negotiated prompt capabilities. Selected agent/model configuration needs adapter-specific/capability-gated config, not arbitrary assumed prompt fields. |
| Abort primitive | `session/cancel` notification; confirmation is the original prompt's cancelled response, not sending the notification. |
| Abort family / confirm / wait | Arche orchestration of child graph and each prompt's completion acknowledgement with bounded deadlines; unavailable confirmation → `execution_termination_unconfirmed`. |
| Pending permissions | Agent → client `session/request_permission`; Arche tracks pending request IDs per session/family for list access. |
| Reply once / always / reject | Respond to `session/request_permission` using the offered option ID (allow/reject once/always where offered); cancellation is a separate cancelled outcome. Never invent a response option. |
| List models / agents | Harness capabilities/configuration inventory or Arche-owned catalog; no assumed universal global catalog method. |
| Provider-access sync / reload recovery | Arche-side credential/gateway configuration and supervised process lifecycle; ACP authentication is not a provider-auth PUT API. |
| Subscribe events | `session/update` message/thought/tool chunks → Arche events, with server-side fan-out, heartbeat, reconnect history and workspace notifications owned by Arche. |
| Config rendering | Arche-side adapter files/process launch; `session/new` MCP config where supported. |
| Run bookkeeping / usage | Arche message-run persistence, usage updates, cursor tracking, path/attachment resolution and accounting; same orchestration as D1. |

This preserves D4's decision: session lists/replay are optional rather than universally absent, but persistent history, child discovery, provider gateway injection and multi-subscriber server transport still require Arche responsibilities/extensions. No ACP bridge is introduced here.

## Phase-3 verification gate / limitations

Every item below is **UNVERIFIED** and must be resolved against the exact pinned image/client pair before v2 reliance:

1. Serve flags/entrypoint, version compatibility, isolated V2 storage, restart behavior and resource usage. No empirical image digest/version was recorded.
2. Basic auth with ephemeral credentials (good, bad, missing), env precedence, and authenticated readiness codes; keep container networking private.
3. All mapped request/response/error shapes, directory isolation, collection pagination, parent filters and permission-family visibility. No live API fixtures were recorded.
4. Family termination including late children, retry, waiting permissions, queued input and background tools; test a non-stopping child and enforce failure deadline.
5. Prompt selection/serialization, file and image URI semantics, provider refresh before execution and atomic busy/run-bookkeeping behavior.
6. Provider credential discovery/replacement/removal, gateway-only access and reload recovery. Prove revoked providers cannot fall back to other credentials; no live secrets in fixtures.
7. SSE wire shape, connect deadline, base auth, reconnect/snapshot race, non-aborting close, heartbeat and no buffering. Prove snapshot/live equivalence and stable part IDs from captured redacted fixtures.
8. MCP normalized names, exact tool allowlists, stdio session `_meta`, reliable agent attribution or fail-closed behavior, and chart/document metadata in direct versus Code Mode calls.
9. Rendered config validation against the pinned runtime, policy precedence/protected placement, KB write guards and per-agent self-delegation restrictions. The mixed-version public schema is not a substitute for these tests.

No live-runtime gate, production mutation, migration, UI walkthrough or golden V2 fixture capture was attempted. Task 1.1's operation mapping is complete under the brief's source-spike allowance; the runtime unknowns above are intentionally not presented as completed acceptance checks.

## Phase-1 v1 event translation measurement

`pnpm exec vitest bench --run src/lib/harness/adapters/opencode-v1/__tests__/events.bench.ts`
replays a 2,000-event text-stream workload expanded from the existing v1 regression
fixtures. On this macOS development host the measured per-event translation cost
was p50 **0.000541 ms**, p99 **0.001708 ms** across 40,000 samples
(acceptance bound: p99 < 0.5 ms).
Translation is synchronous; the adapter yields each translated event before
reading the next upstream chunk. The golden oracle is the unchanged legacy
reducer, retained only under adapter tests. These are regression fixtures, not a
new live-container capture; empirical capture and the manual v1 UI walkthrough
remain outstanding.
