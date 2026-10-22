## Purpose

Defines the behavioral contract for teams and isolated knowledge spaces in multi-user Arche deployments:
- admin-managed teams and membership
- knowledge spaces as separate repositories granted to teams as viewer or editor
- physical isolation of space content in workspace containers
- multi-repository review and publish
- agent restriction by team
- propagation of access changes and their audit

## ADDED Requirements

### Requirement: Admins manage teams and membership
The system SHALL let ADMIN users create, rename, and archive teams and add or remove team members. A user SHALL be able to belong to any number of teams. Non-admin users SHALL receive 403 on every team mutation. Every team mutation SHALL record an audit event that names the actor and the affected team and user.

#### Scenario: Admin creates a team and adds a member
- **WHEN** an ADMIN creates team "Legal" and adds user "ana"
- **THEN** "ana" is a member of "Legal", and audit events `team.created` and `team.member_added` are recorded

#### Scenario: Non-admin attempts a team mutation
- **WHEN** a USER calls any team create, update, archive, or membership endpoint
- **THEN** the request fails with 403 and no team data changes

#### Scenario: Duplicate membership
- **WHEN** an ADMIN adds a user who is already a member of the team
- **THEN** membership is unchanged and the request reports the user as already a member

### Requirement: Knowledge spaces are isolated repositories granted to teams
The system SHALL let ADMIN users create knowledge spaces. Each space SHALL have an immutable slug, a name, and an optional description, and SHALL be backed by its own git repository separate from the common Knowledge Base. A new space's repository SHALL contain an initial commit. ADMIN users SHALL grant teams access to a space as `VIEWER` or `EDITOR`.

#### Scenario: Admin creates a space
- **WHEN** an ADMIN creates space "legal-contracts" named "Legal contracts"
- **THEN** a separate repository exists for the space with an initial commit, and audit event `knowledge_space.created` is recorded

#### Scenario: Slug cannot change
- **WHEN** an ADMIN updates a space and submits a different slug
- **THEN** the request fails and the slug is unchanged

#### Scenario: Invalid or reserved slug
- **WHEN** an ADMIN creates a space whose slug does not match `^[a-z0-9][a-z0-9-]{1,47}$` or is already taken
- **THEN** the request fails with 400 and no repository is created

### Requirement: Effective access is the strongest team grant, and admins can access every space
A user's access to a non-archived space SHALL be the strongest grant across the non-archived teams they belong to, where `EDITOR` outranks `VIEWER`. A user with no grant SHALL have no access. ADMIN users SHALL have `EDITOR` access to every non-archived space. Archived spaces SHALL grant no access to anyone.

#### Scenario: Two teams with different grants
- **WHEN** a user belongs to team A with `VIEWER` on a space and to team B with `EDITOR` on the same space
- **THEN** the user's access to that space is `EDITOR`

#### Scenario: Archived team
- **WHEN** a user's only grant to a space comes from a team that is archived
- **THEN** the user has no access to that space

### Requirement: A workspace contains only the spaces its owner can access
A user's workspace container SHALL receive the repository of a space only if the user has access to it at container creation. `VIEWER` spaces SHALL be provided read-only. Accessible spaces SHALL appear under `_spaces/<slug>/` in the workspace, and the common Knowledge Base SHALL keep its existing layout. On startup, the workspace SHALL delete any `_spaces/<slug>/` directory whose space is not granted to the user.

#### Scenario: User without access
- **WHEN** a user who has no access to space "hr" starts their workspace
- **THEN** the container has no mount of the "hr" repository and no `_spaces/hr/` directory, so neither the user nor any agent can read its content

#### Scenario: Viewer access
- **WHEN** a user with `VIEWER` access to space "legal" starts their workspace
- **THEN** `_spaces/legal/` contains the space's content, and every attempt to write, delete, rename, patch, discard, or publish under it is rejected with `read_only_space`

#### Scenario: Access removed between starts
- **WHEN** a user's access to space "hr" is removed and their workspace starts again
- **THEN** `_spaces/hr/` no longer exists in the workspace

#### Scenario: Common KB unaffected
- **WHEN** a user with no spaces starts their workspace
- **THEN** the workspace layout, sync, review, and publish behavior are identical to the behavior before this change

### Requirement: Space files use the same review and publish flow as the common KB
Diffs, sync, conflict resolution, discard, review, apply, and publish SHALL work for files under `_spaces/<slug>/`. Each space SHALL be its own repository, independent of the common Knowledge Base. Publishing SHALL push each affected repository to its own origin. Publishing a set of paths that spans several repositories SHALL report the outcome of each repository. Pushes to an external GitHub remote SHALL apply only to the common Knowledge Base.

#### Scenario: Editor publishes a space change
- **WHEN** a space `EDITOR` applies and publishes a reviewed change to `_spaces/legal/policies.md`
- **THEN** the change is pushed to the "legal" space repository, and the common Knowledge Base repository is unchanged

#### Scenario: Publish spanning two repositories with one failure
- **WHEN** a publish includes paths in the common KB and in space "legal", and the "legal" push fails
- **THEN** the response reports a failure that names "legal", the common KB result is reported separately, and the unpublished "legal" changes stay available to retry

#### Scenario: Sync with a failing space
- **WHEN** a sync runs and one space repository fails to sync
- **THEN** the common Knowledge Base and the other spaces still sync, and the response names the failing space

### Requirement: Space changes require editor access at every step
Creating, applying, and publishing a knowledge change under `_spaces/<slug>/` SHALL require that the workspace owner has `EDITOR` access to that space at the time of each step. This SHALL hold whether the change comes from an agent proposal, the knowledge curator, or a user edit. External MCP and personal access token Knowledge Base operations SHALL NOT read or write knowledge spaces.

#### Scenario: Viewer agent proposes a space change
- **WHEN** an agent in a workspace whose owner has `VIEWER` access proposes a change to `_spaces/legal/x.md`
- **THEN** the proposal is rejected and no review change is created

#### Scenario: Access revoked after proposal
- **WHEN** a review change for `_spaces/legal/x.md` was created while the owner was an `EDITOR` and the owner's access is then removed
- **THEN** applying or publishing that change fails with an access error

#### Scenario: MCP search excludes spaces
- **WHEN** an external MCP client searches or lists Knowledge Base articles
- **THEN** results come only from the common Knowledge Base

### Requirement: Losing access stops running workspaces immediately
When a team, membership, grant, or space mutation removes a user's access to a space or downgrades it from `EDITOR` to `VIEWER`, the system SHALL stop that user's running workspace and record an audit event `knowledge_space.access_revoked_stop`. A mutation that only grants or upgrades access SHALL NOT stop any workspace, and the user SHALL be prompted to restart through the existing configuration-drift indication.

#### Scenario: Member removed from a team
- **WHEN** an ADMIN removes "ana" from the only team that grants her access to space "hr" while her workspace is running
- **THEN** her workspace is stopped and audit event `knowledge_space.access_revoked_stop` names "ana" and "hr"

#### Scenario: Access granted
- **WHEN** an ADMIN grants a team `VIEWER` access to a space while a member's workspace is running
- **THEN** the workspace keeps running and reports that its configuration is out of date

### Requirement: Agents can be restricted to teams
An admin SHALL be able to restrict an agent to one or more teams. A user who is in none of those teams SHALL NOT receive the agent in their workspace runtime and SHALL NOT see it in the agents list, in agent mentions, or as a delegation target. Agents without a restriction SHALL be available to everyone. ADMIN users SHALL receive every agent. The primary agent and the system knowledge-curator agent SHALL NOT be restrictable. The restriction SHALL be applied at runtime without rewriting the stored configuration.

#### Scenario: Restricted agent hidden from non-members
- **WHEN** agent "contract-reviewer" is restricted to team "Legal" and a user outside "Legal" starts a workspace
- **THEN** the user's runtime configuration does not include "contract-reviewer", and the agents list does not show it

#### Scenario: Restricting the primary agent
- **WHEN** an ADMIN tries to restrict the primary agent or the knowledge-curator agent to a team
- **THEN** the request fails with 400 `agent_not_restrictable`

### Requirement: Agents are told which spaces they can use
The generated workspace agent instructions SHALL list every space the user can access, with its path, name, description, and access level. The instructions SHALL state that viewer spaces are read-only and that the Knowledge Base write policy applies to every space. Any change to the user's set of accessible spaces SHALL change the workspace's applied configuration fingerprint.

#### Scenario: Instructions list spaces
- **WHEN** a user with `EDITOR` on "legal" and `VIEWER` on "finance" starts a workspace
- **THEN** the workspace agent instructions list `_spaces/legal/` as editable and `_spaces/finance/` as read-only

### Requirement: Knowledge spaces are disabled on desktop
In desktop mode, team and knowledge space features SHALL be unavailable. Their endpoints SHALL respond as for a disabled capability. Workspace behavior SHALL be unchanged.

#### Scenario: Desktop request
- **WHEN** the desktop app calls a team or knowledge space endpoint
- **THEN** the endpoint responds as for a disabled capability, and the access resolver returns no spaces
