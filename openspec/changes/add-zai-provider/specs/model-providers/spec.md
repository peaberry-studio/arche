## Purpose

Defines the behavioral contract for Arche's model provider catalog: which providers workspaces can use, how bring-your-own API credentials gate model availability, and how workspace model requests reach the upstream provider without exposing real credentials to containers.

## ADDED Requirements

### Requirement: The provider catalog declares every supported provider
The system SHALL maintain a single catalog of supported provider ids — `openai`, `anthropic`, `fireworks`, `huggingface`, `openrouter`, `zai`, `opencode`, `opencode-go`, `ollama` — where each provider declares a display label, whether it requires a stored credential, the runtime provider id used by OpenCode, and its gateway path. Every place a provider id is accepted, validated, or displayed SHALL derive from this catalog.

#### Scenario: Z.AI is a first-class catalog provider
- **WHEN** any API route, credential panel, or model listing validates a provider id of `zai`
- **THEN** `zai` is accepted as a supported provider labeled `Z.ai` that requires a credential

#### Scenario: Unknown provider is rejected
- **WHEN** a request names a provider id that is not in the catalog or its aliases
- **THEN** the request is rejected with an invalid-provider error

### Requirement: Model availability is gated by an enabled credential
A provider that requires a credential SHALL contribute models to the workspace model picker only when an enabled credential exists for the requesting user, either stored by the user or inherited from an enabled organization-wide credential. Providers not requiring a credential SHALL always contribute their models.

#### Scenario: GLM models hidden without a z.ai credential
- **WHEN** a user with no stored and no organization-wide z.ai credential lists available models
- **THEN** no `zai` models are returned

#### Scenario: GLM models appear once the credential is enabled
- **WHEN** a user stores a z.ai API key and enables it, or an admin enables an organization-wide z.ai credential
- **THEN** subsequent model listings include the z.ai models the runtime resolves, labeled `Z.ai`

### Requirement: Provider credentials are stored encrypted and never reach the workspace
Stored provider credentials SHALL be encrypted at rest, resolvable per user with organization-wide credentials acting as a fallback, and SHALL NOT be delivered to workspace containers. Workspaces SHALL authenticate provider requests with short-lived signed gateway tokens that identify the user, workspace, and provider.

#### Scenario: Workspace requests use gateway tokens
- **WHEN** a workspace sends a model request to a provider's gateway path
- **THEN** the request authenticates with a gateway token and the stored provider credential is decrypted only inside the backend-for-frontend

### Requirement: The gateway forwards provider requests with injected upstream credentials
For each catalog provider, the gateway SHALL forward workspace requests to that provider's upstream base URL, replacing the gateway token with the credential in the scheme the provider requires. Z.AI SHALL be forwarded to `https://api.z.ai/api/paas/v4` using bearer authentication with the stored API key.

#### Scenario: Z.AI chat completion is proxied
- **WHEN** a workspace posts a chat completion to the `zai` gateway path
- **THEN** the gateway forwards it to the Z.AI upstream with `Authorization: Bearer <stored z.ai api key>` and returns the upstream response

#### Scenario: Disabled credential stops proxying
- **WHEN** a user's z.ai credential is removed or disabled
- **THEN** provider requests for `zai` no longer resolve a credential and the gateway rejects them
