## 1. Shared policy text (design D3)

- [ ] 1.1 In `apps/web/src/lib/spawner/runtime-config-utils.ts`, export an agent-prompt policy block constant (e.g. `AGENT_KB_POLICY_PROMPT_BLOCK`) alongside `withWorkspaceKnowledgePolicy()`: same rule set and "overrides any earlier instruction" framing as the AGENTS.md block, naming `learning_propose` as the only persistence path and prohibiting direct vault changes via file tools, shell redirection, or git write commands. Verify with a `runtime-config-utils.test.ts` case asserting the block's required phrases (learning_propose, override framing, write/edit/shell/git prohibitions).

## 2. Policy injection transform (design D1, D4)

- [ ] 2.1 Add `injectAgentKnowledgePolicy(config)` to `apps/web/src/lib/spawner/agent-config-transforms.ts`: for every agent entry (any shape — with or without stored prompt), append the policy block to `prompt` (block-only when no stored prompt). Wire it into `buildBaseWorkspaceConfig()` in `runtime-artifacts.ts` after `injectSelfDelegationGuards` and before `denyAgentKnowledgeWrites`. Verify with `agent-config-transforms.test.ts` cases: agent with stored prompt → user text + one appended block at the end; prompt-less agent → prompt equals the block; apply-transform-twice → still exactly one block.
- [ ] 2.2 Add a pipeline test in `runtime-artifacts.test.ts`: generated config for a stored config with several agents (primary, subagent, curator, prompt-less) has the policy block as the final prompt section of every agent, and `write`/`edit` remain `false` (order invariant vs `denyAgentKnowledgeWrites`).

## 3. Canonical curator synchronization (design D2)

- [ ] 3.1 Change `injectSystemKnowledgeCuratorAgent()` in `agent-config-transforms.ts` from inject-only-if-absent to always-canonical-prompt: when an entry exists for `knowledge-curator`, replace its `prompt` with `KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS` preserving all other stored fields; when absent, inject the full canonical agent unchanged. Update the function's doc comment (its "older workspaces keep their own entry" rationale is now obsolete). Verify with `agent-config-transforms.test.ts` cases: stored stale prompt → runtime prompt is canonical; stored entry with custom `model` → model preserved, prompt replaced; absent entry → full canonical injection (existing test expectation).

## 4. Runtime-only guarantee (spec R3)

- [ ] 4.1 Add a test (in `runtime-artifacts.test.ts` or the transforms suite) asserting that generating runtime config from a parsed stored config does not mutate the input object, and that regenerating from the same stored content produces identical output (idempotency across regenerations, exactly one policy block per agent). Verify both assertions pass.

## 5. Final verification

- [ ] 5.1 Run `pnpm test` and `pnpm lint` from `apps/web/` — both green.
- [ ] 5.2 Run `bash scripts/check-podman-images.sh` from the repo root — images build.
- [ ] 5.3 Run `openspec validate kb-policy-prompt-sync --strict` — change validates.
