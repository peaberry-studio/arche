## Context

See `proposal.md` for motivation and `specs/zendesk-action-permissions/spec.md` for the behavioral contract.

Zendesk configuration is encrypted JSON containing credentials, five legacy boolean permission flags, and optionally the generic `mcpToolPermissions` map. The embedded Zendesk MCP server currently uses the booleans to filter `tools/list` and to reject disabled operations. Runtime configuration separately expands `mcpToolPermissions` into exact OpenCode tool permissions.

OpenCode 1.18.18 evaluates MCP approval policy by the sanitized MCP tool name. MCP tools provide the permission pattern `*` and no argument metadata, so `create_ticket(publicComment: true)` and `create_ticket(publicComment: false)` cannot receive different policies. The connector also cannot initiate an OpenCode permission request after inspecting arguments; MCP elicitation is not enabled by the pinned OpenCode runtime.

Permission events do carry the session, message, and call identifiers. Arche transforms an OpenCode tool call ID into the corresponding tool-part ID and retains tool inputs in the per-session chat store, which provides a separate path for building an approval preview.

## Goals / Non-Goals

**Goals:**

- Make one canonical action-policy map the source of truth for Zendesk permissions.
- Preserve one Zendesk API request when an update contains both field changes and a comment.
- Keep `deny` enforceable at the connector boundary and use OpenCode only for the interactive distinction between `ask` and `allow`.
- Migrate legacy settings conservatively and support a staged rollout while old and new application versions share connector records.
- Show a deterministic, connector-specific approval preview before a Zendesk permission response can be submitted.

**Non-Goals:**

- Add argument-aware permissions to OpenCode or a general approval broker inside the connector gateway.
- Enable MCP elicitation or replace OpenCode's existing `once`, `always`, and `reject` responses.
- Change generic tool-permission behavior for non-Zendesk connectors.
- Add Zendesk role, requester, organization, brand, or field-level authorization.
- Distinguish reading public comments from reading internal notes; listing ticket comments remains one independently configurable read action.

## Decisions

### 1. Store canonical policies separately and derive compatibility projections

Add a versioned `zendeskActionPermissions` object to encrypted Zendesk configuration. Its keys are the complete supported action names and its values use the existing connector permission action type: `deny`, `ask`, or `allow`.

```text
zendeskActionPermissions
├── search_tickets
├── get_ticket
├── list_ticket_comments
├── create_ticket_public
├── create_ticket_internal
├── update_ticket_fields
├── update_ticket_with_public_comment
└── update_ticket_with_internal_note
```

This object is the only authoritative state after migration. The legacy boolean `permissions` object and legacy entries in `mcpToolPermissions` remain temporarily as derived compatibility projections, not independently editable policy. Keeping a distinct key avoids changing the type of an existing field while old and new web versions can read the same connector record.

The Zendesk settings API accepts and returns the canonical map. During the compatibility release it also continues accepting the old boolean request shape, normalizing it into canonical actions. Saving canonical policies dual-writes a conservative legacy projection:

- Existing read tool policies project one-to-one.
- Legacy `create_ticket` receives the most restrictive public/internal create policy.
- Legacy `update_ticket` receives the most restrictive field/public/internal update policy.
- A legacy boolean gate remains enabled only when none of the actions it covers is denied; the projected old tool policy handles `ask` and may over-prompt a less restrictive variant.

This guarantees an older runtime can be more restrictive, but cannot bypass a canonical `ask` or `deny`. A later contract change may remove the projections after mixed-version and rollback support is no longer required.

Alternative considered: make `mcpToolPermissions` itself canonical. This minimizes storage changes but leaves legacy and new tool names mixed in one generic map, makes connector-side validation ambiguous, and lets the generic settings endpoint become a second representation. A connector-specific versioned map provides a clear migration boundary.

Alternative considered: change the five existing booleans directly to action strings. This is rejected because old code requires booleans and would treat the shared record as invalid during a blue-green deployment.

### 2. Normalize every read path with a restrictive merge

A single Zendesk normalization function produces a complete canonical map for settings reads, MCP inventory, tool execution, and managed runtime generation. It uses the canonical map when present and otherwise migrates legacy values in memory.

For a legacy record, each replacement action combines all applicable values and chooses the most restrictive result using:

```text
allow < ask < deny
```

The mappings are:

```text
search_tickets                         ← allowRead + search_tickets policy
get_ticket                             ← allowRead + get_ticket policy
list_ticket_comments                   ← allowRead + list_ticket_comments policy
create_ticket_public                   ← allowCreateTickets + allowPublicComments + create_ticket policy
create_ticket_internal                 ← allowCreateTickets + allowInternalComments + create_ticket policy
update_ticket_fields                   ← allowUpdateTickets + update_ticket policy
update_ticket_with_public_comment      ← allowUpdateTickets + allowPublicComments + update_ticket policy
update_ticket_with_internal_note       ← allowUpdateTickets + allowInternalComments + update_ticket policy
```

A false boolean contributes `deny`; a true or missing boolean contributes `allow`; a missing tool policy contributes `allow`. A complete record with no permission fields therefore retains the current full-access default.

Normalization occurs before validation and does not require the user to open settings. A successful canonical save records the versioned map and refreshes its compatibility projections atomically with the encrypted config update.

Alternative considered: migrate only when settings are saved. This is rejected because workspaces and gateway requests may use a connector before its settings are opened, which could temporarily discard an existing restriction.

### 3. Replace composite writes with visibility-specific tools

Keep the three existing read tool names. Replace `create_ticket` and `update_ticket` in the new inventory with:

- `create_ticket_public`
- `create_ticket_internal`
- `update_ticket_fields`
- `update_ticket_with_public_comment`
- `update_ticket_with_internal_note`

The creation schemas omit `publicComment`; visibility comes from the tool identity. `update_ticket_fields` omits both `comment` and `publicComment`. Each visibility-specific update requires `comment`, omits `publicComment`, and retains optional subject, priority, status, type, and assignee fields so a comment and field changes remain one Zendesk update.

Tool definitions carry their canonical action key. `tools/list` filters out `deny`; execution resolves the definition and performs the same deny check before argument validation or network I/O. `ask` and `allow` are both executable at this layer because only the managed OpenCode runtime can conduct the approval exchange.

Alternative considered: retain one tool and instruct the model to ask the user before public communication. Prompt instructions are not an authorization boundary and can be skipped, so this is rejected.

Alternative considered: separate comments into `add_public_comment` and `add_internal_note` tools that cannot update fields. This is simpler but changes the current atomic update behavior and can leave a ticket partially changed if a second request fails.

### 4. Derive managed runtime permissions from canonical Zendesk policies

The MCP configuration builder uses a connector-type policy adapter. For Zendesk it receives the normalized canonical map; other connectors continue reading generic `mcpToolPermissions` unchanged. Agent connector-tool remapping then expands every canonical action into the exact sanitized MCP tool name and OpenCode action.

Denied Zendesk actions are still included in the generated exact policy map as `deny`, even though the MCP server omits them. This preserves defense in depth if tool discovery is stale. `ask` and `allow` map directly to OpenCode. Because each public/internal variant has a different tool name, OpenCode's session-wide `always` response remains scoped to that atomic action.

The generic tool-permissions UI is not rendered inside Zendesk settings. During the transition, the generic tool-permissions endpoint either delegates Zendesk updates to the canonical adapter or rejects Zendesk writes with an explicit instruction to use the Zendesk settings endpoint; it must never persist an independent effective Zendesk policy.

Alternative considered: implement approvals in the connector gateway. That requires durable suspended requests, session routing, timeout handling, and a second approval event protocol, duplicating behavior OpenCode already provides.

### 5. Correlate permission requests with tool parts for previews

Keep OpenCode permission transport unchanged. Enrich a visible Zendesk permission in Arche by joining:

```text
permission.sessionId  → ChatStore.messages[sessionId]
permission.messageId  → assistant message
permission.callId     → tool part id
```

The transformed tool part contains the tool name and validated model-produced input. A Zendesk-specific preview formatter whitelists fields from the known action schema and produces:

- connector display name and human-readable action;
- public or internal visibility from the atomic tool name;
- ticket ID for updates;
- subject and comment body when present;
- optional status, priority, type, assignee, and tags when present.

The formatter does not render arbitrary metadata or connector configuration. React text rendering remains escaped, long comments are contained in a scrollable/pre-wrapped region, and preview values are not added to audit metadata or logs.

Permission and tool-part events can arrive in either order, so preview selection is reactive. Permission hydration also hydrates the referenced session messages, including delegated child sessions. For a recognized Zendesk action, response controls remain disabled while its referenced tool input is unavailable; the UI shows a loading or retrieval error rather than allowing a blind approval. Generic permission cards retain their existing fallback.

Alternative considered: use permission-event metadata. OpenCode emits empty metadata for MCP tools, and changing the embedded MCP server cannot populate the pre-execution OpenCode request.

### 6. Use one domain-oriented Zendesk editor

Replace boolean switches and the nested generic tool section with segmented `Deny`/`Ask`/`Allow` controls grouped as ticket reading, ticket updates, public communication, and internal communication. The editor loads and saves the complete canonical map through the Zendesk settings route.

There is no longer a cross-field rule requiring ticket creation plus one enabled comment type: public and internal creation are independently valid actions. Saving uses the existing authenticated, CSRF-protected, ownership-checked, encrypted update and audit path, adds the canonical policy values to the existing Zendesk-settings audit event, and emits the workspace-config-changed signal used by generic tool policies.

## Risks / Trade-offs

- [More MCP tools increase prompt size and tool-choice surface] → Keep descriptions concise, encode visibility in names, and test that each action produces the intended payload.
- [An older runtime cannot express different policies for variants of one composite tool] → Dual-write the most restrictive aggregate legacy tool policy, accepting temporary over-restriction rather than under-enforcement.
- [`ask` is not enforceable for a client that bypasses managed OpenCode and directly calls the MCP gateway] → Keep `deny` connector-enforced, document managed-workspace approval as the trust boundary, and do not present `ask` as a gateway-level guarantee.
- [Permission events may precede or outlive their tool part] → Correlate by stable IDs, hydrate referenced sessions, disable Zendesk approval responses until the preview resolves, and retain explicit retry/error UI.
- [Session-wide approval can authorize later calls] → Atomic tool names limit the grant to one visibility and operation class; keep the existing button copy explicit.
- [Canonical and compatibility fields can drift] → Centralize normalization and projection, update both in one encrypted-config write, and never read compatibility fields once a valid canonical version is present except for rollback projection checks.
- [Retiring composite names can interrupt an in-flight workspace] → Treat runtime regeneration/restart as the activation boundary and do not mutate already-running OpenCode config in place.

## Migration Plan

1. **Expand release:** add canonical parsing, restrictive in-memory migration, dual-write compatibility projections, settings API support for both request shapes, and tests. Keep the existing UI and composite tools active during this release so every running web version understands the new config key before it is written by users.
2. **Activation release:** switch the Zendesk UI to canonical action policies, publish the atomic tool inventory, derive runtime permissions from the canonical adapter, add approval previews, and stop advertising composite tools in newly generated runtime configurations.
3. Regenerate or restart affected workspace runtimes through the existing config-change lifecycle; already-running runtimes continue with their previous tool inventory until that boundary.
4. Retain legacy booleans, composite policy projections, and legacy-input parsing for at least one rollback window. Remove them only in a separately reviewed contract change after no deployed version depends on them.

Rollback from the activation release restores the previous UI and composite tools. The compatibility projection remains readable by the older version and is intentionally at least as restrictive as the canonical policies, so rollback may temporarily hide or over-prompt an action but SHALL NOT silently grant broader access. Connector credentials and the canonical map remain intact.
