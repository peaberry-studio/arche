## 1. Provider catalog

- [x] 1.1 Add `'zai'` to `PROVIDERS` in `apps/web/src/lib/providers/types.ts`, after `'openrouter'`; confirm `ProviderId` derives correctly.
- [x] 1.2 Add the `zai` entry to `PROVIDER_METADATA` in `apps/web/src/lib/providers/catalog.ts`: label `Z.ai`, `requiresCredential: true`, `runtimeId: 'zai'`, `gatewayPath: 'zai'`; no alias entry.
- [x] 1.3 Add `zai: 'https://api.z.ai/api/paas/v4'` to `PROVIDER_BASE_URL` and a bearer adapter (Hugging Face template: `staticBaseUrl('zai')`, `extractBearerToken`) to `PROVIDER_ADAPTERS` in `apps/web/src/lib/providers/gateway-adapters.ts`.
- [x] 1.4 Typecheck to confirm every `Record<ProviderId, …>` map is complete (no other map requires a new key).

## 2. Test coverage

- [x] 2.1 `src/lib/providers/__tests__/catalog.test.ts`: label, runtime id mapping, credential requirement, and gateway config baseURL for `zai`.
- [x] 2.2 `src/lib/providers/__tests__/gateway-adapters.test.ts`: `zai` adapter base URL, bearer gateway-token extraction, and upstream auth header injection.
- [x] 2.3 `src/lib/opencode/__tests__/providers.test.ts`: auth sync covers `/auth/zai` (bump the disabled-provider DELETE count and URL list).
- [x] 2.4 `src/actions/__tests__/opencode-models.test.ts`: GLM models listed when a `zai` credential is enabled and hidden when not.
- [x] 2.5 `src/app/api/u/[slug]/organization-providers/__tests__/route.test.ts`: provider list includes `zai` (bump length assertions).
- [x] 2.6 `src/app/api/internal/providers/[provider]/[...path]/__tests__/route.test.ts`: add `zai` to the canonical-id mocks and assert `/api/internal/providers/zai/*` proxies to the z.ai upstream with the real key.
- [x] 2.7 `src/lib/spawner/__tests__/docker.test.ts` and `runtime-artifacts.test.ts`: runtime config writes `provider.zai.options.baseURL` pointing at the gateway.
- [x] 2.8 `tests/opencode-providers.test.ts`, `tests/providers-gateway.test.ts`, `tests/providers-routes.test.ts`: include `zai` in provider lists and add an end-to-end gateway case.

## 3. Final verification

- [x] 3.1 Run `pnpm test` and `pnpm lint` from `apps/web/` — both green.
- [ ] 3.2 Run `bash scripts/check-podman-images.sh` from the repo root — images build.
- [x] 3.3 Run `openspec validate add-zai-provider --strict` — change validates.
