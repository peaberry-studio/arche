## Purpose

Defines the behavioral contract for delivering the Knowledge Base write policy to workspace agents at runtime: every agent's system prompt carries the mandatory policy regardless of stored prompt content, the system-owned knowledge-curator agent always executes the canonical persona, and prompt materialization is runtime-only so stored user configuration is never rewritten.

## ADDED Requirements

### Requirement: Every agent prompt carries the Knowledge Base write policy at runtime
The generated runtime configuration SHALL append a Knowledge Base write-policy block to the system prompt of every agent, regardless of whether the stored configuration defines a prompt. The block SHALL identify proposal submission as the only sanctioned way to persist Knowledge Base knowledge, SHALL prohibit changing vault files directly (including file tools, shell redirection, and git write commands), and SHALL state that it overrides earlier instructions in the prompt.

#### Scenario: Agent with a user-customized prompt
- **WHEN** a workspace stores an agent whose prompt contains instructions that conflict with the Knowledge Base write policy
- **THEN** the generated runtime prompt contains the user prompt followed by the policy block, with the policy block stating it overrides earlier instructions

#### Scenario: Agent without a stored prompt
- **WHEN** a workspace stores an agent with no prompt defined
- **THEN** the generated runtime prompt for that agent consists of the policy block

#### Scenario: Policy injection is idempotent across regenerations
- **WHEN** the runtime configuration is generated repeatedly from the same stored configuration
- **THEN** each generated agent prompt contains exactly one policy block, as the final text of the prompt

### Requirement: The knowledge-curator agent always executes the canonical persona
The generated runtime configuration SHALL set the system prompt of the reserved knowledge-curator agent to the canonical curator instructions, regardless of any prompt stored for that agent id. Other properties of a stored knowledge-curator entry that do not conflict with system requirements (such as model) SHALL be preserved.

#### Scenario: Workspace stores a stale curator prompt
- **WHEN** a workspace stores a knowledge-curator agent whose prompt predates current policy (for example, instructing direct file editing)
- **THEN** the generated runtime configuration carries the canonical curator prompt for that agent

#### Scenario: Workspace has no curator entry
- **WHEN** a workspace's stored configuration has no knowledge-curator agent
- **THEN** the generated runtime configuration includes the knowledge-curator agent with the canonical prompt and its system-defined tool and permission settings

#### Scenario: Curator prompt updates ship with the runtime
- **WHEN** the canonical curator instructions change in a deployed version of the runtime
- **THEN** workspaces regenerate with the updated canonical prompt on their next runtime configuration generation, without per-workspace migration

### Requirement: Prompt materialization never rewrites stored configuration
Policy injection and curator prompt canonicalization SHALL be runtime-only transforms: the stored workspace configuration SHALL remain byte-identical after runtime configuration generation.

#### Scenario: Generation leaves stored config untouched
- **WHEN** runtime configuration is generated for a workspace
- **THEN** the stored configuration in the config repository is unchanged, and a subsequent generation from the same stored state produces the same result
