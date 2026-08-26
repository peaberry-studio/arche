## Context

See `proposal.md` — Why for the drift evidence (0/14 agents mention `learning_propose`; stale stored curator prompt instructing direct editing; catalog-vs-stored philosophy divergence).

Pipeline facts that shape this design (verified in code):

- Runtime config generation (`buildBaseWorkspaceConfig()` in `runtime-artifacts.ts`) parses the stored common config **fresh on every generation** and applies a transform chain; the result is serialized to the workspace's `opencode.json`. Nothing is written back to the config repo — so appended prompt blocks cannot accumulate across regenerations. Prompt-affecting transforms already exist as precedent: `injectCustomConnectorHints` and `injectSelfDelegationGuards` both append text to `agent.prompt`.
- `injectSystemKnowledgeCuratorAgent()` injects the canonical agent (prompt from `KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS` in `lib/learning/curator-prompt.ts`) only when the id is absent; the code comment documents this as deliberate tolerance for older workspaces — which is exactly the permanent-drift bug.
- The `knowledge-curator` id is system-owned and already hidden from user surfaces: `getAgentSummaries()` filters it out, so the agents UI and flow agent pickers never show it. A stored entry can only have come from an earlier system injection, not user authorship.
- `withWorkspaceKnowledgePolicy()` in `runtime-config-utils.ts` builds the AGENTS.md block ("This block is mandatory and overrides any earlier instruction") — the natural home for a shared policy-text constant.
- Legacy agents without tool maps are materialized to full boolean maps early in the pipeline, and `materializeAgentToolMaps` leaves prompts untouched — prompt-less agents reach the new transform with `prompt: undefined`.

## Goals / Non-Goals

**Goals:**

- The KB policy reaches every agent's system prompt in every workspace, including pre-refactor stored configs and user-customized prompts, with override authority.
- The knowledge-curator executes the canonical persona everywhere; canonical prompt changes ship with deploys, no per-workspace migration.
- Stored configuration is never rewritten (runtime-only materialization).

**Non-Goals:**

- Sanitizing or rewriting user-authored prompt text (removing contradicting instructions). The override block neutralizes by precedence; user prompts stay intact.
- Reconciling stored prompts with current Kickstart catalog prompts in general (only the policy block and the system-owned curator are in scope; general catalog-versioning of user-visible agents is a separate future concern).
- The runtime enforcement layer — tool denial, bash/git deny rules, publish gates — belongs to `kb-write-enforcement`. This change is the prompt layer only; a prompt is mitigation, not a boundary.
- Migrating stored configs (no data migration; stale stored entries simply stop mattering for the curator, and stay untouched for everything else).

## Decisions

### D1: Append an override block; do not sanitize user prompts

- New transform `injectAgentKnowledgePolicy()` appends a `## Knowledge Base write policy` block to every agent's `prompt`, framed like the AGENTS.md block ("mandatory and overrides any earlier instruction"). The PRD explicitly allows the "add the rule on top" arm of neutralization; stripping user text would be destructive, harder to test, and philosophically wrong (stored prompts are user data).
- Appending last (after user prompt, after other appended blocks) gives the block the final word, which is how instruction precedence works best with LLMs. This matches the PRD incident lesson: policy buried in file context (AGENTS.md) was ignored; policy at the end of the system prompt is the strongest soft channel available.
- Alternative rejected: *only inject when the stored prompt lacks policy markers*. Undetectable in practice (the stale curator prompt arguably "mentions" KB handling), and the idempotency guarantee (exactly one block) makes unconditional append simpler and uniform.

### D2: The knowledge-curator prompt is unconditionally canonical at runtime

- Change `injectSystemKnowledgeCuratorAgent()` from inject-only-if-absent to: if an entry exists, overwrite its `prompt` with `KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS` (preserving other fields such as `model`, `temperature`, `display_name`); if absent, inject the full canonical agent as today.
- Justification: the id is system-owned and hidden from every user surface (`getAgentSummaries` filter — verified), so no user-authorable content is lost; the stored stale entries were system-injected by an older runtime. This is the PRD's "always synced with the canonical version" requirement, and it makes prompt versioning = deploying code, permanently killing the drift class for this agent.
- The transform still runs before the policy injection, so the curator also receives the D1 block (uniformity; its canonical prompt already contains equivalent rules, redundancy is harmless and consistent).
- Alternative rejected: *version-gated replacement* (stored prompt carries a version stamp; replace if older). Requires a versioning scheme and stored-config awareness for zero additional benefit while the id stays system-owned.

### D3: One policy text family, two renderings

- The policy wording lives as exported constants in `runtime-config-utils.ts` next to `withWorkspaceKnowledgePolicy()`: the AGENTS.md block (existing) and the agent-prompt block (new) share the same rule list and override framing, differing only in channel-appropriate framing. This keeps one voice across channels and gives the pending `kb-write-enforcement` change (which extends the AGENTS.md copy to name git commands) a single place to align.
- `agent-config-transforms.ts` imports the prompt-block constant from `runtime-config-utils.ts`; no import cycle (runtime-config-utils imports nothing from agent-config-transforms).

### D4: Pipeline placement — last prompt-appending transform

- Order in `buildBaseWorkspaceConfig()`: `... → injectSystemKnowledgeCuratorAgent → applyDefaultAgentModel → applyAgentExecutionGuards → injectSelfDelegationGuards → injectAgentKnowledgePolicy → denyAgentKnowledgeWrites`.
- Rationale: the policy block must be the final text in every prompt (maximal precedence); `denyAgentKnowledgeWrites` stays last overall per its existing contract comment (nothing after it may re-enable write/edit — prompt transforms are orthogonal but keeping the invariant comment truthful matters).
- The block applies to all agents uniformly — primary, subagents, curator, user-created — with no per-agent opt-out: the policy is a platform invariant, not a preference.

### D5: No persistence, no migration, idempotency by construction

- Runtime-only transforms over freshly parsed config (verified: nothing in the pipeline writes back to the config repo). Regeneration determinism gives the spec's "exactly one block" scenario for free; a test pins it anyway.
- Workspaces converge on next start (config regenerates per workspace start/restart); no backfill job needed. Stale stored curator entries stop being load-bearing the moment the workspace restarts.

## Risks / Trade-offs

- [A user deliberately wants an agent that can write the KB directly] → Not a supported posture: the platform invariant is proposal-only, and tools are already denied (`kb-write-enforcement` closes shell). The override block makes the prompt consistent with what the runtime enforces. User complaints would indicate a product-level feature request (sanctioned direct-write agents), not a defect here.
- [Prompt bloat: every agent carries the block] → The block is short (~4 lines); prompt budgets comfortably absorb it. Uniformity beats token thrift here.
- [Conflicting older instruction still wins occasionally (LLM non-determinism)] → Accepted: prompts are mitigation (see Non-Goals); the enforcement boundary is `kb-write-enforcement`'s layer. This change exists to make the *intended* behavior unambiguous, which is what the incident showed was missing.
- [Curator stored fields the system does not own (e.g. a user-set `model`) get preserved while prompt is replaced] → Intended (spec scenario); only the prompt is system-owned.
- [Coordination with `kb-write-enforcement` wording] → Both changes touch policy copy in `runtime-config-utils.ts`; textual merge conflict possible if both are in flight. Either order works; noted in both proposals.

## Migration Plan

1. Single additive deploy (config-generation transforms only). No DB, image, or compose changes.
2. Workspaces pick up canonical curator prompts and policy blocks on their next config regeneration (workspace start). No stored-config migration; stale entries remain but are inert for the curator prompt.
3. Rollback: revert the deploy. Next regeneration returns stored prompts verbatim; no data effects (stored config was never modified).
