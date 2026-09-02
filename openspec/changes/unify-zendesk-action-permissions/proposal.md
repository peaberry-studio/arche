## Why

Zendesk currently has two overlapping permission models: boolean ticket/comment limits enforced by the connector and `deny`/`ask`/`allow` policies applied to MCP tools. This prevents users from requiring approval specifically for public comments or internal notes and makes the settings difficult to reason about.

## What Changes

- Replace Zendesk's boolean permission experience with one `deny`/`ask`/`allow` policy model covering ticket reads, ticket-field updates, public communication, and internal communication.
- Model public and internal Zendesk writes as distinct atomic MCP actions so OpenCode can apply a different policy to each action.
- Enforce `deny` as a connector-side hard boundary while routing `ask` through OpenCode's existing approval flow and executing `allow` without prompting.
- Present Zendesk permissions through one domain-oriented settings surface instead of independent connector-limit and generic tool-policy controls that can conflict.
- Show the proposed Zendesk operation and relevant arguments when approval is required, so users can review the ticket, visibility, content, and field changes before responding.
- Migrate existing boolean permissions and stored Zendesk tool policies to equivalent action policies, preserving the effective restriction whenever old settings conflict.
- **BREAKING**: Replace the composite `create_ticket` and `update_ticket` MCP write tools with visibility-specific and field-update actions; stored policies are migrated to the new tool names.

## Capabilities

### New Capabilities

- `zendesk-action-permissions`: Defines Zendesk's action-level `deny`/`ask`/`allow` policies, approval behavior and previews, atomic MCP operations, and compatibility migration.

### Modified Capabilities

None.

## Impact

- Zendesk connector configuration types, parsing, validation, defaults, and encrypted-config migration.
- Zendesk MCP tool inventory, schemas, execution guards, and tests.
- Connector tool-policy storage and runtime OpenCode permission generation.
- Zendesk settings UI, approval-card/tool-call presentation, settings APIs, and audit metadata.
- Existing workspaces require regenerated runtime configuration to receive the migrated tool names and policies; no new external dependency is expected.
