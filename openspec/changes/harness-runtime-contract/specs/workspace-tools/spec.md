## Purpose

Defines how Arche's built-in agent tools (charts, diagrams, documents, email drafts, flows, learning, presentations, session history, spreadsheets) reach agents: a harness-agnostic MCP server inside the workspace, so every harness that speaks MCP gets the same tools with the same behavior.

## ADDED Requirements

### Requirement: Built-in tools are served by an in-workspace MCP server
Every workspace SHALL run an `arche-tools` MCP server over stdio, registered in the harness runtime config, that exposes the built-in tool inventory: chart, diagram, document inspection, email draft, flow, learning, presentation inspection, session history, and spreadsheet tools. Built-in tools SHALL NOT depend on a harness plugin API.

#### Scenario: Agent lists tools on a fresh workspace
- **WHEN** an agent with built-in tools enabled starts in a new workspace
- **THEN** its tool list includes the `arche-tools` tools

#### Scenario: Harness without plugin support
- **WHEN** a harness that supports MCP but not Arche plugins runs the workspace
- **THEN** the built-in tools are still available to agents

### Requirement: Tool behavior is preserved across the move
Each built-in tool SHALL keep its input validation, limits, safety filtering, and output format. Tools that read workspace files SHALL resolve paths inside the workspace only, and tools that call Arche's internal API SHALL keep authenticating with the workspace's internal credentials.

#### Scenario: Chart input exceeds limits
- **WHEN** an agent calls the chart tool with more rows than allowed
- **THEN** the tool returns the same validation error it returned as an OpenCode plugin tool

#### Scenario: Path escapes the workspace
- **WHEN** a tool receives a file path that resolves outside the workspace
- **THEN** the tool refuses the call without reading the file

### Requirement: Tools that need caller identity receive it explicitly
Tools whose behavior depends on the calling agent or session (learning, session history) SHALL receive the agent id and session id from the harness through the tool call context or MCP request metadata. When the harness cannot provide them, the tool SHALL fail with an explicit error instead of guessing.

#### Scenario: Learning tool called by a known agent
- **WHEN** an agent calls the learning tool and the harness supplies the caller's agent id
- **THEN** the proposal is attributed to that agent

#### Scenario: Caller identity unavailable
- **WHEN** the learning tool is called without a resolvable caller agent
- **THEN** it returns the error `caller_identity_unavailable` and creates no proposal

### Requirement: Agent tool permissions follow the new tool ids
The spawner SHALL remap each agent's built-in tool enablement and permissions from the former plugin tool ids to the `arche-tools` MCP tool ids when generating runtime config, so agents keep exactly the built-in tools they had.

#### Scenario: Agent had only the spreadsheet tools
- **WHEN** an agent's configuration enables only the spreadsheet tools
- **THEN** the generated runtime config allows only the `arche-tools` spreadsheet tools for that agent and denies the other built-in tools

#### Scenario: Agent saved before built-in tools were configurable
- **WHEN** an agent's stored tool map has no entry for chart, diagram, email draft, flow proposal, learning proposal, or session history (tools every agent had before they could be toggled)
- **THEN** the generated runtime config keeps those tools enabled for that agent, and only an explicit `false` disables one

#### Scenario: Knowledge curator
- **WHEN** the runtime config includes the system knowledge curator
- **THEN** it can use the learning proposal and session history tools regardless of its stored tool map
