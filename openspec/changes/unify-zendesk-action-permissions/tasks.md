## 1. Compatibility Data Model

- [x] 1.1 Run `pnpm test` from `apps/web/` before implementation and record whether the existing suite passes as the baseline
- [x] 1.2 Add the complete versioned Zendesk action-policy type, keys, default-allow value, and strict parser, and verify unit tests accept only complete `deny`/`ask`/`allow` maps with known actions
- [x] 1.3 Implement restrictive in-memory normalization from legacy booleans and stored read/create/update tool policies, and verify table-driven tests cover every replacement action, missing settings, and `allow < ask < deny` conflict resolution
- [x] 1.4 Implement the conservative legacy boolean and composite-tool policy projection from canonical actions, and verify tests prove an older runtime is never granted broader access than the canonical map
- [x] 1.5 Update Zendesk config parsing and validation to expose canonical policies while preserving credentials and legacy compatibility fields, and verify existing connector validation tests plus canonical and legacy fixtures pass
- [x] 1.6 Extend the Zendesk settings API to read canonical policies, accept both legacy and canonical request shapes during expansion, dual-write the compatibility projection in one encrypted update, and verify route tests cover authentication, validation, audit metadata, and round trips for both shapes
- [x] 1.7 Prevent the generic tool-permissions endpoint from creating independent Zendesk policy state by delegating to the canonical adapter or returning an explicit unsupported-write response, and verify route tests cannot create a conflicting effective Zendesk policy

## 2. Atomic Zendesk MCP Actions

- [x] 2.1 Define `create_ticket_public`, `create_ticket_internal`, `update_ticket_fields`, `update_ticket_with_public_comment`, and `update_ticket_with_internal_note` schemas, and verify tool-inventory tests assert required fields, omitted `publicComment`, and the absence of legacy composite tools in the activated inventory
- [x] 2.2 Implement public and internal creation payloads whose visibility comes from the tool identity, and verify unit tests assert the exact Zendesk request body for each action
- [x] 2.3 Implement field-only and visibility-specific update payloads while preserving one-request field-plus-comment updates, and verify tests cover comment rejection for `update_ticket_fields`, required comments for visibility-specific tools, optional fields, and empty-update errors
- [x] 2.4 Filter denied actions from `tools/list` and reject direct denied invocations before network I/O, and verify MCP handler and tool tests cover `deny`, `ask`, and `allow` inventory/execution behavior
- [x] 2.5 Update connector MCP route integration fixtures for the atomic actions, and verify `pnpm test -- tests/connectors-mcp-route.test.ts src/lib/connectors/mcp/__tests__/zendesk-handler.test.ts` passes from `apps/web/`

## 3. Managed Runtime Policy Generation

- [x] 3.1 Add a connector-type policy adapter that supplies normalized canonical Zendesk actions while leaving other connectors on generic `mcpToolPermissions`, and verify MCP-config unit tests cover legacy normalization and canonical precedence
- [x] 3.2 Expand canonical Zendesk actions into exact sanitized OpenCode permissions for every agent with the connector enabled, and verify transform tests map `deny`, `ask`, and `allow` independently for public, internal, field-update, and read actions
- [x] 3.3 Keep explicit `deny` entries in generated runtime policy while excluding retired composite names, and verify runtime artifact and desktop workspace-host tests inspect the resulting tool and permission maps
- [x] 3.4 Verify a session-level approval for one atomic Zendesk action does not authorize differently named actions using permission-flow tests against the generated configuration

## 4. Unified Zendesk Settings Experience

- [x] 4.1 Replace boolean switches with grouped three-way `Deny`/`Ask`/`Allow` selectors backed by the complete canonical action map, and verify component tests cover loading, editing, disabled states, and labels for all eight actions
- [x] 4.2 Remove the independently editable generic tool-permissions section from Zendesk settings and remove the old create/comment cross-field constraint, and verify the dialog accepts all-denied creation actions without showing duplicate policy controls
- [x] 4.3 Save the full canonical map through the Zendesk settings API, emit the workspace-config-changed signal after success, and verify UI tests cover success, validation failure, network failure, and unchanged credential preservation
- [x] 4.4 Update Zendesk settings response/request types and connector error copy without changing other connector dialogs, and verify the connector component and route test suites pass

## 5. Zendesk Approval Previews

- [x] 5.1 Correlate pending permissions with per-session messages by session, message, and call IDs, and verify selector/reducer tests handle permission-first and tool-part-first event ordering
- [x] 5.2 Hydrate messages referenced by pending permissions, including delegated child sessions, and verify reconnect tests resolve previews without grafting child permission cards into the parent transcript
- [x] 5.3 Add a Zendesk preview formatter that recognizes atomic tool names and whitelists connector name, visibility, ticket ID, subject, comment, and supported changed fields, and verify unit tests exclude unknown metadata and credentials
- [x] 5.4 Render the formatted preview in the approval card with escaped, contained comment text and disable responses while required Zendesk input is unresolved, and verify component tests cover loading, retrieval failure, public/internal labels, creation, and update previews
- [x] 5.5 Exercise `Allow once`, `Allow for this session`, and `Reject` from a previewed Zendesk permission, and verify interaction tests send the existing response values and never submit while the preview is unavailable

## 6. Rollout and Verification

- [x] 6.1 Prepare the compatibility data-model and API work as an independently deployable expand release, and verify legacy UI requests, legacy connector records, and rollback projections pass before enabling the activation work
- [x] 6.2 After the expand release is available across the fleet, prepare the atomic tools, runtime mapping, unified UI, and previews as the activation release, and verify a regenerated workspace advertises only policy-eligible atomic Zendesk writes
- [x] 6.3 Run `pnpm test` from `apps/web/` and verify the complete Vitest suite passes
- [x] 6.4 Run `pnpm lint` and `pnpm build` from `apps/web/` and verify both commands pass
- [x] 6.5 Run `bash scripts/check-podman-images.sh` from the repository root and treat any image-build failure as blocking
- [x] 6.6 Verify rollback documentation and fixtures retain legacy booleans, composite policy projections, and legacy-input parsing for the agreed rollback window without re-advertising composite tools in activated runtime configuration
