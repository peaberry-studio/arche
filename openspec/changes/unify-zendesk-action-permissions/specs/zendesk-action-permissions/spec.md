## Purpose

Defines a single action-level permission model for Zendesk so ticket access, public communication, and internal communication can each be denied, approved interactively, or allowed automatically.

## ADDED Requirements

### Requirement: Configurable Zendesk action policies
The system SHALL assign exactly one `deny`, `ask`, or `allow` policy to each of the following Zendesk actions: search tickets, read ticket details, list ticket comments, create a ticket with a public comment, create a ticket with an internal note, update ticket fields without a comment, update a ticket with a public comment, and update a ticket with an internal note.

#### Scenario: Configure different public and internal policies
- **WHEN** a user sets public ticket comments to `ask` and internal ticket notes to `allow`
- **THEN** the system stores and applies those policies independently to the corresponding Zendesk actions

#### Scenario: Configure every ticket-access action
- **WHEN** a user selects a policy for a Zendesk read, create, or update action
- **THEN** the selected action accepts `deny`, `ask`, and `allow` with the same meaning used by connector tool permissions

### Requirement: Atomic Zendesk write actions
The system SHALL expose visibility-specific Zendesk MCP write actions named `create_ticket_public`, `create_ticket_internal`, `update_ticket_fields`, `update_ticket_with_public_comment`, and `update_ticket_with_internal_note`. A visibility-specific update SHALL require a comment and MAY include ticket-field changes in the same Zendesk request, while `update_ticket_fields` SHALL NOT accept a comment.

#### Scenario: Create a public ticket
- **WHEN** an agent needs to create a ticket whose initial comment is public
- **THEN** it invokes `create_ticket_public`, and the resulting Zendesk request marks the initial comment as public

#### Scenario: Create a ticket with an internal note
- **WHEN** an agent needs to create a ticket whose initial comment is private to Zendesk agents
- **THEN** it invokes `create_ticket_internal`, and the resulting Zendesk request marks the initial comment as internal

#### Scenario: Update fields and add a comment atomically
- **WHEN** an agent invokes a visibility-specific update with a comment and ticket-field changes
- **THEN** the system sends the comment and field changes in one Zendesk ticket update request with the visibility declared by the action name

#### Scenario: Update fields without communication
- **WHEN** an agent invokes `update_ticket_fields`
- **THEN** the tool updates only supplied ticket fields and rejects comment input

### Requirement: Denied actions are hard connector boundaries
The system SHALL omit an action with a `deny` policy from the Zendesk MCP tool inventory and SHALL reject a direct invocation of that action before sending any request to Zendesk.

#### Scenario: Denied action is not advertised
- **WHEN** a client lists tools for a Zendesk connector with a denied action
- **THEN** the denied action is absent while non-denied actions remain available

#### Scenario: Denied action is invoked directly
- **WHEN** a client directly invokes a denied Zendesk action despite its absence from the inventory
- **THEN** the connector returns an explicit `operation_not_allowed` error and sends no Zendesk request

### Requirement: Managed workspaces honor ask and allow
For managed workspace execution, the system SHALL translate each non-denied Zendesk action policy into the matching OpenCode permission: `ask` SHALL pause the action for a user response, and `allow` SHALL execute it without a permission prompt.

#### Scenario: Allow action executes directly
- **WHEN** an agent invokes a Zendesk action configured as `allow`
- **THEN** the managed workspace executes the action without creating a permission request

#### Scenario: Ask action waits for approval
- **WHEN** an agent invokes a Zendesk action configured as `ask`
- **THEN** the managed workspace creates a pending approval and sends no Zendesk request until the user approves the action

#### Scenario: User rejects an ask action
- **WHEN** the user rejects a pending Zendesk action
- **THEN** the action does not execute and no Zendesk request is sent

#### Scenario: User allows an action once
- **WHEN** the user selects `Allow once` for a pending Zendesk action
- **THEN** only that invocation is approved by the response

#### Scenario: User allows an action for the session
- **WHEN** the user selects `Allow for this session` for a pending Zendesk action
- **THEN** later invocations of that same atomic action in the current OpenCode session may execute without another prompt while differently named Zendesk actions retain their own policies

### Requirement: Zendesk approval previews
The system SHALL present a pending Zendesk approval with the connector identity, human-readable action, and the proposed operation arguments available for review. The preview SHALL identify public versus internal visibility and SHALL show the subject, ticket identifier, comment body, and changed ticket fields when those values apply to the action.

#### Scenario: Review a pending public comment
- **WHEN** a public-comment action requires approval
- **THEN** the approval identifies the action as public and displays the target ticket and proposed comment before the user responds

#### Scenario: Review a pending ticket creation
- **WHEN** a ticket-creation action requires approval
- **THEN** the approval identifies the initial comment visibility and displays the proposed subject, comment, and optional ticket fields before the user responds

### Requirement: Single Zendesk permission settings surface
The system SHALL provide one domain-oriented Zendesk settings surface for the action policies and SHALL NOT present a second independently editable generic tool-permission policy for the same Zendesk connector.

#### Scenario: Edit Zendesk permissions
- **WHEN** a user opens Zendesk connector settings
- **THEN** every configurable Zendesk action is shown with a `Deny`, `Ask`, and `Allow` selector reflecting the single persisted policy state

#### Scenario: Save Zendesk permissions
- **WHEN** a user saves valid Zendesk action policies
- **THEN** the settings API persists the complete policy state, records the sensitive configuration change in the audit log, and signals that workspace runtime configuration must be refreshed

### Requirement: Legacy Zendesk permissions migrate without becoming less restrictive
The system SHALL normalize legacy Zendesk boolean permissions and legacy `create_ticket` or `update_ticket` tool policies into the new action-policy model. For each new action, the migrated policy SHALL be the most restrictive applicable legacy value using `deny` as more restrictive than `ask`, and `ask` as more restrictive than `allow`.

#### Scenario: Migrate disabled public comments
- **WHEN** a legacy connector allows ticket updates but disables public comments
- **THEN** its public create and public update actions migrate to `deny` regardless of a less restrictive legacy create or update tool policy

#### Scenario: Migrate an ask update policy
- **WHEN** a legacy connector allows ticket updates and internal comments and configures `update_ticket` as `ask`
- **THEN** `update_ticket_fields` and `update_ticket_with_internal_note` migrate to `ask`

#### Scenario: Migrate a denied update policy
- **WHEN** a legacy connector allows ticket updates but configures `update_ticket` as `deny`
- **THEN** every new update action migrates to `deny`

#### Scenario: Load a connector without explicit legacy permissions
- **WHEN** an existing or newly created Zendesk connector has no explicit permission configuration
- **THEN** all Zendesk actions default to `allow` to preserve the existing full-access default

#### Scenario: Use migrated settings before an explicit save
- **WHEN** a legacy Zendesk connector is loaded for tool inventory or managed workspace configuration before the user opens or saves its settings
- **THEN** the system applies the normalized action policies in memory so legacy restrictions remain effective

### Requirement: Composite Zendesk write tools are retired
The system SHALL stop advertising the legacy `create_ticket` and `update_ticket` MCP tools after action-policy migration and SHALL migrate their stored policy intent to the replacement actions.

#### Scenario: List tools after migration
- **WHEN** a migrated Zendesk connector lists its MCP tools
- **THEN** `create_ticket` and `update_ticket` are absent and their applicable atomic replacement actions are present according to policy

#### Scenario: Regenerate managed workspace configuration
- **WHEN** runtime configuration is regenerated for a workspace using a migrated Zendesk connector
- **THEN** permission entries target the replacement action names and no generated permission entry targets the retired composite names
