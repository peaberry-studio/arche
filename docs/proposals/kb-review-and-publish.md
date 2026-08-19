# Knowledge writes, review, and publish

Design-only proposal. No behavior change in this PR.

Status: proposed
Depends on: `#473` (`963fe6b`, unify knowledge curator)
Target follow-up: one implementation PR (or a short stacked pair: enforcement, then publish semantics)

## 1. Problem

After `#473` the UI looks like one Knowledge Review surface, but it is two queues with a one-way gate between them.

| Tab | What it actually is |
|---|---|
| **Proposals** | `KnowledgeReviewChange` rows (`open` / `needs_rebase`) |
| **Pending publish** | Uncommitted git diffs in the workspace working tree |

The **intended happy path** after unification:

```
learning_propose / MCP kb:write
        → Proposals
        → Apply          (workspace-agent writes the file)
        → Pending publish
        → Publish        (commit + push, hash-gated)
```

What users hit instead, every few chat turns:

```
Agent write/edit
        → Pending publish
        → Publish blocked   ("No reviewed changes to publish…")
        → Submit for review (creates origin=workspace, status=open; file stays dirty)
        → Proposals
        → Apply             (often a no-op: bytes already match)
        → Pending publish
        → Publish works
```

That last path is coded on purpose (`submitWorkspaceDiffForReview`, `origin: 'workspace'`). It is the recovery hatch for unreviewed working-tree writes. It became the default experience because **agents can still write the vault**.

`#473` closed the exit (publish requires an applied review + hash) and left the entrance open (OpenCode `write` / `edit` / `bash` on the working tree).

## 2. Why Pending publish fills up during chat

Pending publish is not a review inbox. It is `GET /git/diffs`.

The chat stream forwards `file.created` / `file.edited` / `file.deleted` as `workspace-updated`, and the shell refreshes diffs. Any OpenCode `write` or `edit` lights the Knowledge badge on that turn.

This is **not** auto-learn. Auto-learn is `AUTO_LEARNING_MIN_MESSAGES = 12` plus a 24h cooldown, and it is instructed to call `learning_propose` only.

Who can dirty the tree today:

| Actor | Writes files? | Creates proposals? |
|---|---|---|
| `assistant` (`tools: "all"`) | Yes (`write`, `edit`, `bash`) | Yes (`learning_propose` is always injected) |
| `knowledge-curator` (new catalog) | No (read/list/glob/grep) | Yes |
| `knowledge-curator` (existing workspace config) | Yes, if the workspace was never re-kickstarted. Spawn does not rewrite curator tools or prompt. | Yes |
| `requirements`, `seo` | Yes | Yes |
| copywriter, support, ads, performance | No | Yes |
| MCP `create_kb_article` / `update_kb_article` / `delete_kb_article` | No | Yes |
| Explore editor | Yes (user) | Only via Submit for review |
| Apply | Yes (workspace-agent `/files/write`) | N/A |

Filesystem denies at spawn only cover `opencode.json`, `AGENTS.md`, `.gitkeep`, `node_modules`. There is **no** deny for Knowledge Base files.

Prompt rules are inconsistent with the gate:

- New curator: "Never write, edit, or run shell commands that modify KB files."
- Assistant: "delegate learn/remember/store to `knowledge-curator`." It is **not** told to never write the vault.
- Generated `AGENTS.md` still says the curator "must ask for explicit confirmation before any KB write" (`kickstart/build.ts`). That is pre-unification copy.

## 3. Product decisions

Agreed before this proposal:

1. **Chat agents never write the Knowledge Base.** The only legal agent/MCP persistence path is a proposal (`learning_propose` or MCP `kb:write`). Apply is the only agent-originated write.
2. **User edits in Explore go straight to Pending publish.** They must not enter Proposals. The user reviews the git diff there (including conflicts) and Publish ships them.
3. **This document is design-only.** Implementation is a follow-up PR.

## 4. Target behavior

Two writers, two queues, one publish action.

```
Chat / curator / auto-learn / MCP
        │
        │  learning_propose | create/update/delete_kb_article
        ▼
   Proposals (open)
        │  user: Apply / Reject / Rebase / Regenerate
        ▼
   Apply writes working tree
        │
        ├──────────────────────────────────────┐
        │                                      │
        ▼                                      ▼
 User edits a file in Explore          Pending publish
 (workspace-agent /files/write)        = current git diffs
        │                                      │
        └──────────────────────────────────────┤
                                               ▼
                                   Publish (no proposal required
                                   for user edits)
                                               │
                                               ▼
                                   git commit + push
                                   applied reviews → published
```

### 4.1 What each tab is for

- **Proposals** — staged suggestions that are **not** on disk yet (or that need rebase). Only agent/MCP/curator work lands here.
- **Pending publish** — the working tree vs `HEAD`. This is the pre-flight view before shipping: user edits, applied proposals, and conflict resolution.
- **Publish** — commits and pushes **every non-conflicted current diff**. The user has already seen those diffs in Pending publish.

### 4.2 What goes away

- **Submit for review** on a pending diff. That button exists only to retrofit a review row onto bytes that are already written. After this change, user edits do not need a review row, and agents must not write those bytes in the first place.
- The Publish error *No reviewed changes to publish. Apply changes from Knowledge Review first…* for a tree that only has user edits.
- The three-step loop for an already-written file.

Discard stays. Conflicts still block Publish.

### 4.3 Publish rules

| Working-tree path | Publish? |
|---|---|
| User Explore edit, no review row | Yes. Manifest includes the path. No hash required. |
| Applied proposal, working tree still matches `appliedHash` | Yes. Manifest includes the path + hash. Row → `published`. |
| Applied proposal, user then edited the file | Yes. Treat as a user override: include the path, **omit** the stale hash so the agent does not return `reviewed_content_changed`. Row → `published`. |
| Open / needs_rebase proposal, file also dirty from a user edit | Yes, the user edit ships. The open proposal is now stale and should move to `needs_rebase` (existing apply-time logic already handles a drifted base on the next Apply). |
| Conflicted path | No. Existing conflict gate. |
| Dirty path from a leftover agent write (pre-migration) | Yes, same as a user edit. The user is looking at the diff and choosing to ship or discard. |

`unreviewed_changes_present` stays, but the manifest becomes **all current diff paths**, not only applied-review paths. Its job is still "do not commit a file the BFF did not list."

### 4.4 What agents may do

- Read the vault (`read`, `list`, `glob`, `grep`, and related inspect tools).
- Call `learning_propose`.
- Delegate to `knowledge-curator`.
- Use MCP read tools. MCP write tools remain proposal-only.

They must not persist vault bytes through `write`, `edit`, or shell redirection.

## 5. Implementation plan

One follow-up PR is enough if it ships enforcement and publish semantics together. Split only if the diff is too large: (1) stop agent writes, (2) relax publish for user edits and remove Submit for review.

### Phase A — Stop chat from writing the vault

Enforcement must not depend on re-kickstart. Existing workspaces keep their `CommonWorkspaceConfig.json` until someone re-applies a template. Spawn already reads that file and injects always-on tools; it must also strip writers.

1. **Spawn transform** (source of truth at runtime)

   Add something like `denyAgentKnowledgeWrites` next to `injectAlwaysOnAgentTools` in `apps/web/src/lib/spawner/agent-config-transforms.ts`, and call it from `buildBaseWorkspaceConfig` in `runtime-artifacts.ts`.

   For every agent that has a tool map:

   - `write: false`
   - `edit: false`

   Do this even if the stored config or the agent form has them enabled. Catalog defaults are not enough.

2. **Kickstart catalog**

   - `assistant.json`: stop using `tools: "all"`. List explicit tools **without** `write` / `edit`. Keep `bash` for now (see residual risk). Update the prompt: never write, edit, or delete Knowledge Base files; persist only via `learning_propose` or by delegating to `knowledge-curator`.
   - `requirements.json` and `seo.json`: drop `write` / `edit`.
   - `knowledge-curator.json`: already read-only. Keep it that way.
   - `kickstart/build.ts` shared `AGENTS.md` rules: replace "curator must ask for confirmation before any KB write" with the two-queue rule (agents propose; users edit in Explore and publish from Pending publish).

3. **Runtime `AGENTS.md` appendix**

   Do not overwrite the stored `AGENTS.md` in `/kb-config` (users customize it). Append a short mandatory block at spawn, same pattern as `withWorkspaceIdentity` in `runtime-config-utils.ts`:

   - Chat agents must not write the Knowledge Base.
   - Agent changes go through Knowledge Review proposals.
   - User edits go to Pending publish and are published from there.

4. **Agent form**

   `write` and `edit` stay in `OPENCODE_AGENT_TOOLS` so existing configs parse, but the form must not present them as effective capabilities. Hide them, or show them disabled with "Knowledge Base writes go through proposals." Saving an agent with those boxes checked must not re-enable them at spawn.

5. **Tests**

   - `agent-config-transforms`: every agent exits spawn with `write`/`edit` false.
   - Kickstart manifest / agent definition tests: assistant is not `all`; requirements/seo have no write/edit.
   - Agent form tests: write/edit are not togglable (or are ignored).
   - `AGENTS.md` builder: new shared rules.

### Phase B — Publish user edits without a proposal

Today two gates block that:

- BFF `POST /api/instances/[slug]/publish-kb` returns `no_reviewed_changes_to_publish` when no diff path has `status === 'applied'`.
- Workspace-agent `commitWorkspacePathsIfNeeded` / `pathsAreWithinManifest` refuse anything outside the reviewed-path manifest.

`verifyReviewManifestHashes` already skips paths with no expected hash. The BFF just never sends those paths.

1. **BFF** (`publish-kb/route.ts`)

   - Build the publish manifest from **all current diff paths** (skip conflicted; those already disable the button).
   - For each path, if `listAppliedKnowledgeReviewChanges` has a row whose `appliedHash` still matches the working tree, attach that hash.
   - If a row exists but the hash no longer matches, include the path and **omit** the hash (user override after Apply).
   - If no row exists, include the path with no hash (Explore edit).
   - Delete the early `reviewedPaths.length === 0` error.
   - After a successful publish, mark applied rows for shipped paths as `published`, including overrides.

2. **Workspace-agent** (`infra/workspace-image/workspace-agent/main.go`)

   - Keep requiring a path manifest whenever the tree is dirty (do not allow "commit whatever is dirty" with an empty body).
   - Keep hash verification **only** for paths that carry a hash.
   - Keep `unreviewed_changes_present` as "every dirty path must be in the manifest."
   - Update `main_test.go` cases that assume a dirty tree with no manifest, or a user-only edit, must fail.

3. **UI**

   - Remove **Submit for review** from `review-panel.tsx` and the `submitWorkspaceDiffForReview` action path from the Knowledge happy path.
   - Keep Discard and conflict actions.
   - Publish stays visible when `diffs.length > 0`, and stays disabled on conflicts.
   - Empty-state copy on Pending publish: user edits and applied proposals create publishable changes; agents do not.
   - Optional copy on Proposals: these changes are not on disk until Apply.

4. **Dead code after the button is gone**

   `submitWorkspaceDiffForReview` / `submitWorkspaceDiffForReviewAction` / `origin: 'workspace'` can stay one release if anything external still calls them; they should have no UI entry. Prefer deleting them in the same PR if grep is clean (MCP does not use this path).

5. **Tests**

   - Publish with only user-authored diffs succeeds and does not require review rows.
   - Publish with a mix of applied + user-edited paths succeeds.
   - Publish with an applied path whose bytes drifted succeeds and still marks the row published.
   - Publish with conflicts still fails.
   - A dirty path omitted from the manifest still fails (`unreviewed_changes_present` / `reviewed_path_manifest_required`).
   - Review-panel tests no longer expect Submit for review.

### Phase C — Only if agent writes still appear after A+B

`bash` remains an escape hatch. Assistant currently gets it via `tools: "all"`. Models usually prefer `write`/`edit`; once those are gone they may `echo` or `tee` into the vault.

Do **not** set `permission.bash = 'ask'` globally. That would prompt on every `ls`.

If Pending publish still ticks during chat after Phase A:

- Log `workspace-updated` paths that occur during an OpenCode turn and are not caused by Apply or Explore save.
- Then either deny a small set of write-like bash patterns, or revert working-tree mutations that happen inside a chat turn and did not go through workspace-agent `/files/write` or `/files/delete`.

Out of scope for the first implementation PR unless the residual shows up in review.

## 6. What we are not changing

- Auto-learn thresholds (12 messages, 24h).
- MCP `kb:write` semantics (already proposal-only).
- Proposal state machine (`open` → `applying` → `applied` → `published`, plus reject / rebase / regenerate).
- Apply writing through workspace-agent (that remains the only agent-originated disk write).
- Explore save writing through workspace-agent (that remains the user-originated disk write).
- Knowledge badge = open proposals + diffs. The two counts stay on the two tabs.

## 7. Key files

| File | Change in the follow-up |
|---|---|
| `apps/web/src/lib/spawner/agent-config-transforms.ts` | Force `write`/`edit` off |
| `apps/web/src/lib/spawner/runtime-artifacts.ts` | Call the new transform |
| `apps/web/src/lib/spawner/runtime-config-utils.ts` | Append KB write policy to `AGENTS.md` |
| `apps/web/kickstart/agents/definitions/assistant.json` | Drop `all`; no write/edit; prompt |
| `apps/web/kickstart/agents/definitions/requirements.json` | Drop write/edit |
| `apps/web/kickstart/agents/definitions/seo.json` | Drop write/edit |
| `apps/web/kickstart/build.ts` | Shared `AGENTS.md` rules |
| `apps/web/src/components/agents/agent-form.tsx` | Stop offering write/edit as live tools |
| `apps/web/src/app/api/instances/[slug]/publish-kb/route.ts` | Manifest = all diffs; hash only when it still matches |
| `infra/workspace-image/workspace-agent/main.go` | Hash check only when a hash is sent; tests |
| `apps/web/src/components/workspace/review-panel.tsx` | Remove Submit for review |
| `apps/web/src/lib/learning/proposal-application.ts` | Delete submit-from-diff if unused |
| `ARCHITECTURE.md` | Update Knowledge Base runtime section **in the implementation PR**, not here |

## 8. Risks

- **Capability loss.** Users who relied on the assistant writing notes into the vault must use Explore or ask the curator to propose. That is the product decision.
- **Existing dirty files.** After deploy they sit in Pending publish and become publishable. That is what the user asked for: review the diff, publish or discard.
- **Custom agent configs.** A user who enabled Write in the agent form will see it stop working. The form must say so. Spawn must ignore the stored flag.
- **`bash` residual writes.** Called out in Phase C. First PR should still ship A+B.
- **Hash-gate weakening.** `#473` used hashes so an applied path could not ship later unreviewed bytes. After this change, later bytes on that path are defined as a user override if they reached Pending publish. Defense in depth is "agents cannot write," not "publish refuses drifted applied paths."
- **Old curator configs.** Tool strip at spawn fixes write access without rewriting the stored prompt. The `AGENTS.md` appendix covers the instruction drift.

## 9. Rollout

- Additive on the config side: spawn transform + catalog + copy. No migration, no `DROP`.
- Workspace-agent image must ship with the web change. Publish semantics live in both the BFF and `main.go`. Deploy them together.
- No feature flag required if A and B ship together. If they are split, ship A first (agents stop writing; user edits still need Submit for review until B lands).

## 10. Acceptance

A reviewer should be able to:

1. Chat with the assistant and never see a new Pending publish item appear unless they edited a file or applied a proposal.
2. Ask the curator (or trigger Learn) and see a **Proposal**, not a dirty file.
3. Edit a file in Explore, see it only under Pending publish, and Publish it without Submit / Apply.
4. Apply a proposal, see the file under Pending publish, and Publish it.
5. Apply a proposal, tweak the file in Explore, and still Publish the tweaked bytes.
6. Hit a conflict and be blocked from Publish until it is resolved or discarded.
7. Open a pre-`#473` workspace without re-kickstart and still have `write`/`edit` disabled on every agent.
