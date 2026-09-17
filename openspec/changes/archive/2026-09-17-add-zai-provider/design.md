## Context

See `proposal.md` — Why for the fit assessment.

Current mechanics that shape this design (verified in code):

- Arche never ships provider API keys to workspace containers. The Next.js BFF is a gateway: OpenCode's generated `opencode.json` points every provider's `options.baseURL` at `/api/internal/providers/<gatewayPath>` (`buildProviderGatewayConfig`), and `syncProviderAccessForInstance()` pushes short-lived HMAC gateway tokens to the instance's `/auth/<runtimeId>` endpoint. The gateway route verifies the token, decrypts the user/org `ProviderCredential`, and injects the real key into the upstream request (`applyProviderAuthHeaders`).
- A provider is defined by four TypeScript-enforced maps: `PROVIDERS` (`types.ts`), `PROVIDER_METADATA` and the id alias table (`catalog.ts`), `PROVIDER_BASE_URL` + `PROVIDER_ADAPTERS` (`gateway-adapters.ts`). Omitting a key anywhere is a compile error.
- Model listing is runtime-driven: `listModelsAction()` reads OpenCode's `config.providers()` and drops providers that require a credential without an enabled one; no model metadata is stored in Arche (pricing/context comes from OpenCode's models.dev data).
- Hugging Face is the minimal template for a key-based OpenAI-compatible provider: no `runtimeConfig`, bearer auth, static base URL. Z.AI's API matches that shape (bearer token, OpenAI-compatible `/api/paas/v4`).
- The Z.AI catalog is large and fast-moving (16+ models from `glm-4.5` to `glm-5.3-flash`, with new families landing frequently); models.dev's `zai` entry (id `zai`, env `ZHIPU_API_KEY`) is the registry OpenCode resolves.

## Goals / Non-Goals

**Goals:**

- A user or admin can paste a z.ai API key in the existing credential panels and immediately see GLM models in the workspace model picker.
- Requests to z.ai follow the same security path as every other provider: gateway token in the container, real key injected only inside the BFF.
- Zero new infrastructure: no migration, no env var, no compose change, no bespoke UI.

**Non-Goals:**

- The GLM Coding Plan subscription endpoints (`zai-coding-plan` / `zai subscription via Anthropic protocol at https://api.z.ai/api/anthropic`). This change targets the pay-as-you-go API keyed by a standard z.ai API key; a coding-plan provider can be added later as its own catalog entry.
- A static model list or pricing/context metadata in Arche (model discovery stays registry-driven).
- Payload normalization for GLM quirks (e.g. `reasoning_content` is response-side and passes through untouched; request-side `thinking`/`reasoning_effort` fields are honored upstream). Add an adapter normalization later only if a real incompatibility appears, as Fireworks did for `display_name`.
- Terminal-retry classification for z.ai-specific error reasons (`retry-state.ts` stays as is until a reason string is observed).

## Decisions

### D1: Canonical id `zai`, runtime id `zai`, no alias

- models.dev and OpenCode know the provider as `zai`, so `runtimeId: 'zai'` makes both the runtime `provider` block key and the `/auth/zai` endpoint line up without an alias entry (contrast Fireworks, whose runtime id `fireworks-ai` needs `PROVIDER_ID_ALIASES`).
- Alternative considered: `zai` canonical with `zhipu` runtime id — rejected; the registry id is `zai` and inventing a second name buys nothing.

### D2: Label `Z.ai`

- Matches the vendor's own branding ("Z.AI" / z.ai). Shown in the model picker's provider line and the credential panel; no logo or docs URL exists in the catalog today, so none is added.

### D3: Hugging Face-shaped adapter, base URL `https://api.z.ai/api/paas/v4`

- Bearer auth scheme, `staticBaseUrl('zai')`, `extractBearerToken`, default retry policy (`maxFetchAttempts: () => 1`). Z.AI's OpenAI-compatible endpoint is the documented general-API surface for the key type users store here.
- Alternative considered: the Anthropic-compatible endpoint — rejected in D-non-goals; the OpenAI-compatible path keeps the adapter trivial and the gateway's SSE passthrough semantics identical to the other providers.

### D4: Placement after `openrouter` in `PROVIDERS`

- Keeps the API-key providers grouped before the OpenCode-native entries, mirroring the Hugging Face addition. Ordering is user-visible only in the credential panels' provider list, which iterates `PROVIDERS` in order.

### D5: Not added to `CONFIGURED_ONLY_RUNTIME_PROVIDER_IDS`

- That list (Ollama, OpenCode Go) removes provider entries from the runtime config when no credential exists. Hugging Face deliberately stays always-configured and merely shows no models without a key; z.ai follows Hugging Face. The runtime `provider.zai` entry with a gateway baseURL is inert until `/auth/zai` exists, so there is no behavior to gate away.

## Risks / Trade-offs

- [Registry id drift between OpenCode's models.dev snapshot and this catalog] → Model listing depends on the runtime resolving `zai`; models.dev is fetched live by OpenCode and `zai` exists there today. If a future pin drifts, the fallback is a `runtimeConfig.models` block (the escape hatch the metadata type already supports) — not needed now.
- [GLM models that require always-on reasoning (e.g. `glm-5.3` rejects `thinking.type: "disabled"`) could fail if a client sends it] → OpenCode derives request options from the same registry metadata, so it does not send a disable flag for models registered as always-reasoning. No gateway mitigation; revisit only with a reproduced failure.
- [Free-tier z.ai keys hitting rate limits surface as upstream errors] → Same behavior as other providers; the gateway's generic 100 req/min per user+provider limit applies on top.

## Migration Plan

1. Single deploy; no DB or config change. Existing workspaces pick up the new provider entry on their next runtime-config sync (`buildProviderGatewayConfig` output) and auth sync.
2. Users add a z.ai key in Settings → Providers (or admins org-wide); models appear after the next instance sync/dispose cycle.
3. Rollback: revert the deploy. Stored z.ai credentials remain encrypted rows keyed by the string `zai` and are simply unused until the provider returns; no cleanup required.

## Open Questions

- (none)
