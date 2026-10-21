# OpenCode V2 contract spike (task 1.1)

## Current status: v1-parity acceptance (2026-10-21, design D9)

This section supersedes every earlier "blocked", "deferred" or "UNVERIFIED"
statement below where they conflict. The acceptance bar is design D9: v2 must
give at least the guarantees v1 gives in production today, plus what 2.0.32
offers natively. Gaps that v1 shares are recorded as known risks, not v2
blockers. Everything here was checked against the local `opencode` 2.0.32 with
`@opencode/client@2.0.32`, using isolated loopback servers, repository-local
scratch, a fake provider and a synthetic gateway (never the host service or
real keys).

| Gate | Accepted behavior and evidence | Known risk (shared with v1 unless marked) |
| --- | --- | --- |
| 4. Execution | `sessionStatus` is `session.active()`; retry backoff, permission waits and background sessions report busy, absence is idle (as v1). Family abort interrupts leaf-first, cancels the inbox, retries unconfirmed aborts, rediscovers descendants and confirms the whole family inactive, otherwise `execution_termination_unconfirmed`. Live: parent + two busy children confirmed; a continuously restarted child is unconfirmed after 10s (`adapter-live.probe.test.ts`). | Confirmation takes one family snapshot once all known sessions are idle; a child restarted right after it is missed. Retry is plain `busy`. |
| 5. Files/prompt | Every v1 attachment form: workspace `file://` URIs of any MIME (runtime sniffs bytes) and jpeg/png/gif/webp data URIs; other forms rejected (v1's builder never emits them). No-reply is Arche-side: `resume:false` queues input without a provider call; the next prompt delivers it first. Synchronous prompts go through shared execution with a 60s family-idle bound. Busy refusal, run admission, cursor capture and per-message usage booking work through the real adapter. `message.list` sends `order` only on the first page (2.0.32 rejects `order` with `cursor`). | v2-only: no-reply input is not in history until the next turn and an abort cancels it. No caller in `src` uses no-reply today. |
| 6. Provider access | Sync keeps v1's guarantees (per-workspace lock on both paths, scoped gateway tokens, hash/TTL freshness, active-run deferral, `location.reload` with bounded recovery, freshness only after success, no key logging). Arche credentials carry the label `arche-managed:<runtimeId>`; managed-provider entries are purged, unrelated unlabelled entries kept. Replacement-first, then stale entries removed inactive-first (credentials apply without reload). Live: sync, refresh, revocation without fallback, unrelated entry preserved. | Project config can override an allowed provider's `baseURL` in v1 and v2 alike; mitigated by config-path edit policies (gate 9) and gateway token versioning. A partial sync failure can leave mixed credentials until the next sync (no freshness recorded). `location.reload` vs. a run starting after the deferral check (same race as v1 dispose). |
| 6b. Zen/Go routing | 2.0.32 gives every Zen and Go model its own `https://opencode.ai/inference/<family>/` endpoint, which wins over the provider-level gateway `baseURL`, and treats any `opencode` key as an OpenCode Console account (polled every minute). v2 workspaces get `OPENCODE_MODELS_URL` → `/api/internal/models/api.json`: the models.opencode.ai catalog (cached 5 min, last good copy on upstream failure) with those endpoints rewritten to `<gateway>/opencode[-go]/inference/...`, which the gateway forwards to `https://opencode.ai/inference/...` (the token may arrive as Bearer, `x-api-key` or `x-goog-api-key`; none is forwarded). The managed `opencode` credential sets `metadata.server` to an Arche path that 404s, which 2.0.32 reads as "no Console config". Live: free Zen model replies through the gateway with usage recorded. | v2-only: until the first catalog refresh after a fresh state volume, the bundled snapshot still points Zen at opencode.ai and such a request fails with 401 (no secret leaves Arche; the scoped gateway token does). |
| 7. Events | Production `subscribeOpenCodeEvents` is wired. The same conversation was captured on 1.18.18 and 2.0.32 and replayed with reconnects at five cut points (`__tests__/captures`, `reconnect-golden.test.ts`): every variant converges to the continuously connected client, and v2's final snapshot equals the live state including accounting (v1 only after ignoring step parts). Snapshots include undelivered inbox input. Live BFF check (`subscription-live.test.ts`): heartbeat ≤10s, closing a subscriber does not interrupt the session, connect failures return 502. See `__tests__/CAPTURE.md` "Reconnect parity acceptance". | In-flight text/reasoning missing from snapshots until the part ends (v1 too). Stale-snapshot races can revive a resolved permission or regress a tool state (v1 too; v1 also loses text there, v2 does not). v2-only: a running subagent tool has `metadata: {}` in the snapshot, so the delegation card links to the child only after progress/completion. Connect pages every session in the location first, which could exceed the 8s connect deadline on very large workspaces. |
| 9. Config guards | Production-rendered config round-trips through `config.get`. Agent `system` equals v1's prompt (same transforms, same order). Each agent ends with a native `subagent:<self>` deny; the execution guard's non-primary `subagent * deny` matches v1. KB, workspace and runtime-config paths (`opencode.json(c)` at any depth, `.opencode/**`, `AGENTS.md`) are `tool.use` deny policies; a permissive project `.opencode/opencode.json` cannot lift them ("Blocked by configuration policy"; negative control succeeds without them). Self-deny enforced live; primaries cannot run as subagents (`config-guards.probe.mjs`). | Per-agent permissions (self-deny, execution deny) can be re-allowed by a planted `.opencode/opencode.json`; tools cannot write it, but shell policies are string matches, as in v1. Policies are not a sandbox. |

Since 2026-10-21 OpenCode 2 is the only runtime. The v1 adapter was reduced to
a read-only history reader (`adapters/opencode-v1/reader.ts`) used to archive a
workspace's conversations on its first v2 start; there is no v1 start, fallback
or rollback (see `infra/README.md`). A workspace whose config v2 cannot render,
or whose history export fails, fails to start and retries on the next start.
Sections below are the historical record from when both runtimes ran; mentions
of v1 starts, the v1 golden and the default switch no longer apply. Live acceptance of 5.7, 6.7 (local, not
staging) and 7.2 is recorded at the end of `tasks.md`; MCP servers render with
`codemode: false` so connector tools stay individually permissioned.

## Second goal-fix execution verification (2026-10-20; updates gates 4–5 below)

`node src/lib/harness/adapters/opencode-v2/__tests__/execution-local.mjs`
from `apps/web/` passed against the isolated 2.0.32 pair (exit **0**). Workspace
`.txt` files, directory references and PNGs retain their URI/name in history;
inline PNGs retain bytes/MIME/name. Text and both PNG sources reached the
loopback fixture provider. The adapter now maps these verified file forms,
rejecting other MIME/URI forms explicitly before selection or prompt mutation.
Desktop-specific file URIs, other image/document formats, no-reply and synchronous
completion remain unsupported; this is not complete prompt acceptance.

The probe also verified nested/background activity, then showed that an empty
`active()` map after leaf-first interrupts still leaves queued input. Explicit
inbox cancellation removes that input without delivery. The adapter's abort
primitive now cancels the observed inbox and rechecks it, returning
`execution_termination_unconfirmed` if input remains. This is not atomic family
termination: retry, late/tool-created descendants and complete idle confirmation
remain unverified, so `sessionStatus` and startup gates remain closed.
Real-adapter HTTP/shared-execution regressions cover these primitives, cursor
and reply/accounting transforms, and refusal to create/book usage for unverified
execution; successful production run settlement is not claimed.

## Second goal-fix provider verification (2026-10-20)

Reran `node src/lib/harness/adapters/opencode-v2/__tests__/providers.probe.mjs`
from `apps/web/` with the installed 2.0.32 pair: exit **0**. The disposable
store purge, gateway replacement and revocation assertions passed, and the
location-scoped endpoint-override assertion still reproduced a successful
`/bypass/fixture/chat/completions` request using the project-supplied fixture
credential. This is evidence for keeping the production sync gate closed, not
successful production refresh/revocation acceptance. No real provider key or
workspace store was used. Protected routing and managed-store ownership still
require a verified solution before production token issuance or freshness writes.

## Bounded credential-purge follow-up (2026-10-20)

**Correction to the earlier deferral:** removing one active credential is unsafe,
but that observation does **not** make credential revocation impossible on 2.0.32.
The reasonable purge-before-replacement workaround below is now runtime-verified.
Full production sync remains deferred for narrower reasons, not the old fallback
claim. Reproduce from `apps/web/` with:

```sh
node src/lib/harness/adapters/opencode-v2/__tests__/providers.probe.mjs
```

The probe creates its own foreground loopback server, repository-local HOME/XDG
and scratch, synthetic credentials, and authenticated synthetic gateway. It lists
every credential, removes inactive predecessors before active entries, asserts
the store empty, and creates only replacement gateway credentials. All entries
being purged were created by this probe; no real store or key is read or changed.
The child environment inherits no provider credentials. Process, gateway sockets
and scratch are removed in `finally`; key values are never printed.

**Verified with the matched SDK and binary:**

- After reload, exact synthetic bearer/API-key identity reaches the gateway and
  the fixture response is returned for all nine production runtime IDs:
  `openai`, `anthropic`, `fireworks-ai`, `huggingface`, `openrouter`, `zai`,
  `opencode`, `opencode-go`, and `ollama`. The Ollama package uses the renderer's
  `aisdk:@ai-sdk/openai-compatible` spelling. A separate custom provider also
  consumes `credential.create({integrationID: providerID, ...})`, even though its
  provider record omits `integrationID`; absence of that field alone is **not** a
  credential-mapping blocker. Synthetic explicitly configured models are used;
  this does not establish production catalog/discovery completeness.
- Purging all replacements and reloading causes all nine generation attempts to
  fail. No old key is sent: eight reach the gateway without a credential and are
  rejected with 401; Z.ai rejects locally because its key is absent. Explicit
  configured models can still report `enabled:true` after revocation, so catalog
  availability alone cannot establish effective provider access.
- A provider deny policy prevents generation before any gateway request. However,
  a provider **allowlist does not pin that provider's endpoint**. With a global
  allow for the custom ID, a project `.opencode/opencode.json` overrides its
  `baseURL` and key; a location-scoped session successfully calls the separate
  `/bypass/fixture/chat/completions` stub path. This is an actual same-ID endpoint
  bypass of routing settings, not a policy-deny bypass. Production's rendered
  project file and a provider-ID allowlist are insufficient gateway-only proof.
- File-backed `settings.apiKey` replacement plus reload works for native and
  custom providers too. It still needs protected placement and safe atomic
  writes; it does not fix the endpoint override above. The pinned live OpenAPI
  and SDK expose config patching of **shell only**, not provider/policy updates.
- `fireworks-ai` works; the extra `fireworks` config ID has no runtime package
  and rejects generation. The prompt primitive now resolves Arche's canonical
  `fireworks` selection back to `fireworks-ai`, matching list-model normalization;
  two real-adapter HTTP regressions cover switching and already-selected models.

**Remaining production boundary:** preserve unknown/non-Arche credential entries,
establish a managed-store ownership invariant before any purge, enforce protected
gateway endpoint/package configuration, then implement serialized refresh,
active-run deferral, token issuance, bounded reload recovery and freshness only
after consistency. No production purge/sync success was introduced from this
probe. Its typed failure now names gateway-only endpoint enforcement, managed
credential ownership and complete orchestration instead of claiming the verified
credential mechanism is unverified. Startup and protected-config guards remain
unchanged. The focused suite passes **121 tests**; focused ESLint passes.

## Goal-fix recheck (2026-10-20, SC-1 / SC-3 / SC-8 / SC-10)

Re-read the native V2 migration, config, client and policies guides and reran
`node src/lib/harness/adapters/opencode-v2/__tests__/runtime.probe.mjs` from
`apps/web/` against the installed binary and client, both **2.0.32**. The probe
now asserts the two rollout blockers instead of relying on the earlier narrative:

- A native `agents.policy_probe.policies` self-delegation deny is absent from
  `config.get()`'s canonical document, although the agent itself is loaded. This
  is config retention evidence, not a successful enforcement test. The documented
  policy statement still contains only action/resource/effect, with no caller
  predicate. A global target deny would also block legitimate other callers;
  per-agent permissions would be overridable. Neither satisfies D6.
- Create/activate two synthetic OpenAI credentials, confirm only the replacement
  is active, then remove it: the older credential becomes active again. Both
  synthetic entries are removed and the final credential list is empty. No key
  values or credential-list payloads are logged. This verifies fallback behavior,
  **not** effective gateway routing or safe provider revocation.

The probe also passed the existing authenticated readiness, CRUD, pagination,
files and idle-interrupt checks. It used only repository-local disposable storage,
an isolated whitelisted child environment, ephemeral authentication and loopback
serve; no host service or real provider credentials were used. The first recheck
attempt exposed an incorrect probe assumption (`config.get()` returns entries,
not a `data` envelope); it was corrected from the installed declarations and the
complete probe then passed.

`__tests__/runtime-http.test.ts` adds **14 deterministic tests** through the real
`createOpenCodeV2Runtime` and matching `@opencode/client`, mocking only connection
resolution and HTTP transport. Native envelopes, 204s, root-scoped short-page
pagination, recorded message/accounting snapshots, selected-agent/model ordering,
caller message IDs, cancellation forwarding, permission decisions, interrupt and
missing-session errors are exercised. Neither adapter primitives nor client
methods are mocked. These tests are transport regressions, **not** live model,
family-idle, protected-renderer, gateway-sync or startup acceptance evidence.
All 121 focused runtime/client/provider/renderer tests passed; focused ESLint
passed.

**Deferred, not bypassed:** protected production rendering and startup (SC-1),
effective provider refresh/revocation and complete execution-idle/attachment
semantics (SC-3), and their production success-path acceptance (SC-8 / SC-10). No
production renderer, provider or startup guard was relaxed. V2 still refuses
startup; provider sync still fails without mutation/freshness; idle confirmation
still refuses. Config-file credential replacement/reload was unverified at this
recheck; the bounded follow-up above verifies its mechanism, not protected
production enforcement. Event acceptance is independently
owned and cannot justify opening any of these gates. Default remains V1.

## Event continuation (2026-10-20, SC-2 / SC-9)

**Production subscription remains guarded:** `subscribeOpenCodeEvents` returns
typed `runtime_unsupported` before credential lookup or transport, naming the
remaining unfinished-snapshot overlap, missed-enqueue and session/control parity
gaps. SC-2 / SC-9 full acceptance is deferred, not enabled by a partial mapping.
The separate adapter-internal `connectOpenCodeEvents` transport is implemented
and directly tested with the installed 2.0.32 client. It resolves on authenticated
SSE headers (not the first payload), scopes located events and unlocated session
notifications, and releases only the subscriber on cancellation. Partial
tool/message and inbox lifecycle semantics live in the
Arche reducer, as modes under the existing closed event types; no adapter payload
buffering or per-event HTTP requests were added. V1 golden parity remains intact.

A fresh isolated local capture's complete text, tool/permission/final-reply and
mixed reasoning conversations matched their native snapshots during offline
replay. Transport regressions use the actual installed client with mocked HTTP;
synthetic attachments/metadata/errors are not MCP acceptance. See
`__tests__/CAPTURE.md` for the verified native control-message ID basis, coverage,
and explicit limits: arbitrary unfinished-snapshot/delta overlap, missed inbox
enqueue across reconnect, and complete session/control parity remain unresolved.
This is not unrestricted full-parity acceptance or image/manual acceptance and
does not relax startup, protected-policy, provider-sync or family-idle gates.

## Phase-3 continuation (2026-10-20, client/runtime 2.0.32; event row superseded above)

The matching `@opencode/client@2.0.32` is now installed and lockfile-pinned. The
earlier dependency blocker below is historical, **not** the current blocker.
V2 read operations and the workspace-files bridge now have their own adapter;
recorded kinds select V1/V2 independently. Unknown kinds still fail before
container contact. The deployment default remains `opencode-v1`.

**V2 startup is still blocked.** Adapter availability is not startup readiness.
`checkRuntimeStartupSupport` refuses V2 before password generation, container
cleanup or DB writes. Required caller-scoped policies, effective gateway access,
and execution/family-idle semantics are not verified. No speculative mapping may
turn those failures into success. The audited admin action remains implemented,
but its requested V2 start currently returns `runtime_unsupported` safely.

| Gate | Confirmed on the matched local pair | Still UNVERIFIED / fail-closed boundary |
| --- | --- | --- |
| 1. Serve/storage | Isolated foreground loopback `serve` starts/stops; matching client reports 2.0.32. Both pinned workspace images build and pass network-disabled smoke checks. | Restart/storage upgrade and resource usage. |
| 2. Auth/health | Basic `opencode` works with `OPENCODE_SERVER_PASSWORD`; missing/malformed auth returns 401; client `server.info` proves readiness. Both images reject missing/wrong auth; entrypoint forces the supplied server password over an inherited `OPENCODE_PASSWORD`. Health unit tests abort at the per-request deadline and propagate losing-probe cancellation. | Location discovery can lag global readiness, so smoke checks explicitly wait for configured agents/skills. No auth proxy is needed. |
| 3. Session API | Matched SDK create/get/rename/delete; explicit workspace directory; parent-filtered children and root-only lists; a short page with a cursor is followed until an empty final page; missing get throws `SessionNotFoundError`. | Cross-location isolation beyond the explicit directory filter, nonempty permission/error fixtures. |
| 4. Execution | Idle interrupt and missing-session rejection; slow parent and explicit background child both appear in `active`. Interrupting the parent leaves the child running; interrupting both clears that map. Permission waits remain active. | Retry, queued-input drain, nested/late/tool-created children remain unverified. `sessionStatus` still refuses with `runtime_unsupported:v2_family_idle_confirmation_unverified`; observed foreground acknowledgements do not prove the complete idle contract. |
| 5. Files/prompt | Native file read returns bytes. `find` is bounded/fuzzy and respects `.gitignore`; `list` includes ignored entries. Fake-provider text prompts succeed; supplied message IDs survive delivery; agent/model switches are reflected in `get`. Text-only prompt mapping is implemented. | `resume:false` leaves an inbox item, NOT a delivered no-reply message, so no-reply explicitly refuses. Attachment URI/multipart semantics and synchronous completion remain unsupported rather than dropping fields. |
| 6. Provider access | Single-active deletion reactivates an older key, but purge-before-replacement works. All nine runtime provider IDs and a custom provider generate through the synthetic gateway with their replacement credential; purging and reloading revokes them without old-key fallback. A provider deny blocks requests. File-backed API-key replacement also works. | Provider-ID allows do not pin endpoints: a project config redirects an allowed custom provider to a bypass stub. Managed-store ownership, protected routing, serialization/run deferral and complete token/freshness orchestration remain unverified. Sync still returns typed `sync_failed` without mutation. See bounded follow-up above; do not retain the older claim that credential mapping/purge revocation is impossible. |
| 7. Events | Internal matched-client transport resolves on SSE headers; Arche-owned partial updates, inbox staging/delivery and selected captured full conversation parity are implemented/tested. Per-kind ordinals, caller IDs, per-message usage and source call IDs are preserved. | Production subscription returns typed `runtime_unsupported` before transport: arbitrary unfinished-snapshot/live overlap, missed enqueue at reconnect, full session/control parity and manual/image acceptance remain unverified. No payload buffering or per-event HTTP workaround is introduced. See current event note and `__tests__/CAPTURE.md`. |
| 8. MCP | Matched config preserves `codemode:false`; a synthetic connection probe returned an empty catalog. | Invocation, exact allowlists, session metadata and attachment parity are not proven. Explicit caller fallback must continue failing closed on missing/conflicting identity. |
| 9. Config guards | Actual mapping-only renderer output validates against live 2.0.32 OpenAPI config schema and survives client `config.get`. Agent-level `policies` are silently dropped; policy statements expose only action/resource/effect. | No caller predicate can express the required self-delegation guard. Protected models still return `runtime_config_unsupported` at `guards.selfDelegation`; no guard was weakened to overridable permissions. Protected placement/enforcement remains unverified. |

The files bridge uses the ignore-aware `find(query:"", limit:10000)` inventory for
directory listing, emitting immediate children only. At the bound it returns
`workspace_file_limit_exceeded` rather than silently presenting an incomplete
tree. Search remains fuzzy/ignore-aware with a 50-result bound; read validates
workspace-relative protected paths and decodes native bytes, never calling V1
file endpoints. V2 state volumes are separate from V1 even for an internal test.

Reproduce the credential-free CRUD/files/auth probe from `apps/web/`:

```sh
node src/lib/harness/adapters/opencode-v2/__tests__/runtime.probe.mjs
```

It uses random ephemeral auth, a loopback-only process, a whitelisted child env
and repository-local HOME/XDG/TMPDIR scratch, and removes its process and scratch
in `finally`. It does not use the shared host service or real provider keys.
These probes are not the manual end-to-end acceptance in task 5.7.

Live execution fixtures, golden-test evidence boundaries and the fake-provider
reproducer are documented in `__tests__/CAPTURE.md`. The reproducer emits its
sanitized capture to stdout, with all scratch inside the repository. Full tool
goldens, reconnect/cancellation isolation and end-to-end MCP acceptance are not
claimed. The older 2.1 source-spike event `session.message.content.updated` is
absent from the installed 2.0.32 generated event union.

Image pins are `versions/opencode.version` (2.0.32) and the retained
`versions/opencode-v1.version` (1.18.18). The image check builds both, without
pruning unrelated resources, and validates config/instructions/skills plus native
auth. Desktop preparation deliberately reads the V1 pin until phase 7. Publish
the pinned legacy tag before deployment; do not use release `v6.0.0` (1.17.9).

## Earlier phase-3 local re-check (historical)

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

## Phase-1 v1 event translation measurement (historical; benchmark removed with the v1 runtime)

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
