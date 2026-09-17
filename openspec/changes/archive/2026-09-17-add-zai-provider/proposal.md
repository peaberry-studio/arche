## Why

Users want to run Arche workspaces on Z.AI's GLM models (`glm-5.3`, `glm-5.2`, `glm-4.7`, …) with their own z.ai API key. Arche's provider catalog currently stops at OpenAI, Anthropic, Fireworks, Hugging Face, OpenRouter, OpenCode Zen, and Ollama, so z.ai credentials have nowhere to live and GLM models never appear in the workspace model picker. Z.AI's primary API is OpenAI-compatible bearer auth at `https://api.z.ai/api/paas/v4` — exactly the shape the existing provider gateway already proxies for Hugging Face and OpenRouter — and OpenCode's model registry (models.dev) already ships a `zai` provider entry, so model discovery needs no new plumbing. This is a catalog addition, not new infrastructure.

## What Changes

- Add `zai` to the `PROVIDERS` catalog in `apps/web/src/lib/providers/types.ts` (placed after `openrouter`, keeping the key-based providers grouped).
- Declare its metadata in `PROVIDER_METADATA` (`apps/web/src/lib/providers/catalog.ts`): label `Z.ai`, `requiresCredential: true`, runtime id and gateway path `zai` (identical to the models.dev registry id, so no alias entry is needed).
- Add its upstream to the gateway: `PROVIDER_BASE_URL.zai = https://api.z.ai/api/paas/v4` and a plain bearer adapter (Hugging Face template) in `PROVIDER_ADAPTERS` (`apps/web/src/lib/providers/gateway-adapters.ts`).
- Users (and admins, org-wide) can then store an encrypted z.ai API key in the existing provider credential panels; once enabled, GLM models flow into `listModelsAction` and the workspace model picker like every other key-based provider.
- Extend the provider test suite (catalog, gateway adapters, runtime auth sync, model listing, API routes, spawner runtime config, end-to-end gateway proxy) to cover the new id.

Nothing else changes: credential storage, gateway tokens, rate limiting, the OpenCode runtime config, and the UI panels are provider-generic.

## Capabilities

### New Capabilities
- `model-providers`: Behavioral contract for Arche's model provider catalog — which providers are supported, how bring-your-own API credentials gate model availability, and how workspace model requests are proxied through the provider gateway with injected upstream credentials.

### Modified Capabilities
- (none — provider behavior was previously unspecified.)

## Impact

- `apps/web/src/lib/providers/types.ts` — `PROVIDERS` gains `'zai'`.
- `apps/web/src/lib/providers/catalog.ts` — `PROVIDER_METADATA.zai`.
- `apps/web/src/lib/providers/gateway-adapters.ts` — `PROVIDER_BASE_URL.zai` + `PROVIDER_ADAPTERS.zai`.
- Tests: `src/lib/providers/__tests__/catalog.test.ts`, `src/lib/providers/__tests__/gateway-adapters.test.ts`, `src/lib/opencode/__tests__/providers.test.ts`, `src/actions/__tests__/opencode-models.test.ts`, `src/app/api/u/[slug]/organization-providers/__tests__/route.test.ts`, `src/app/api/internal/providers/[provider]/[...path]/__tests__/route.test.ts`, `src/lib/spawner/__tests__/docker.test.ts`, `src/lib/spawner/__tests__/runtime-artifacts.test.ts`, `tests/opencode-providers.test.ts`, `tests/providers-gateway.test.ts`, `tests/providers-routes.test.ts`.
- No DB migration (`ProviderCredential.providerId` is a free string), no new env vars, no infra/compose changes, no UI changes (credential panels and model picker are generic).
