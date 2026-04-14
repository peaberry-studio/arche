# AGENTS.md

Mandatory guide for coding agents (Claude Code, Cursor, OpenCode, etc.) working in this repository. Read it before making any change.

## What Arche Is

Arche is a platform of specialized AI agents with isolated per-user workspaces. Each workspace is an OpenCode container with access to a shared Knowledge Base (Obsidian vault) and a catalog of configurable agents.

**Main components:**

- `apps/web/` - Next.js 16 app (React 19, TypeScript). It is the BFF (Backend for Frontend), the UI, and the container spawner.
- `apps/web/kickstart/` - Kickstart catalogs and templates (agents, KB skeletons, generated `AGENTS.md`).
- `infra/` - Infrastructure: Podman Compose, Ansible deployer, workspace image.
- `scripts/` - Deployment scripts for KB and config bare repositories.

## Technical Stack

- **Framework:** Next.js 16 + React 19 + TypeScript 5 (strict mode)
- **Styling:** Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **DB:** PostgreSQL 16 + Prisma 7
- **Auth:** HTTP-only sessions with Argon2 + TOTP 2FA
- **Encryption:** AES-256-GCM for connectors and instance passwords
- **Containers:** Podman + Traefik + docker-socket-proxy
- **Package manager:** pnpm (no npm, no yarn)
- **Tests:** Vitest 3
- **Lint:** ESLint 9

---

## General Rules

### 1. Do not invent, ask

- If you cannot find the information you need in the code or docs, ask the user.
- Do not invent function names, endpoints, environment variables, or paths you did not verify.
- Do not assume a pattern exists: read the code before reproducing it.

### 2. Read before writing

- Always read the file you are going to modify before editing it.
- Understand surrounding context: what the module does, who imports it, what pattern it follows.
- Review nearby files to keep consistency.

### 3. Minimum necessary change

- Do only what was requested. Do not refactor or "improve" adjacent code, and do not add docstrings/comments unless requested.
- Do not add error handling, validation, or fallbacks for scenarios that cannot happen.
- Do not create premature abstractions or helpers for one-off operations.
- If you remove something unused, remove it completely (no `// removed`, no `_unused` vars, no compatibility re-exports).

### 4. Do not break working code

- Run tests before and after your changes: `pnpm test` from `apps/web/`.
- If tests fail because of your change, fix them before finishing.
- Do not disable tests or git hooks (`--no-verify`) unless the user explicitly asks.

---

## Code Conventions

### Naming

| Element | Convention | Example |
|----------|-----------|---------|
| Files | kebab-case | `agent-card.tsx`, `workspace-shell.tsx` |
| React components | PascalCase | `AgentCard`, `WorkspaceShell` |
| Functions / variables | camelCase | `startInstance`, `isConnected` |
| Types / interfaces | PascalCase | `AgentCardProps`, `SpawnerActionResult` |
| Constants | SCREAMING_SNAKE_CASE | `MIN_LEFT_PX`, `IDLE_TIMEOUT_MS` |
| Hooks | camelCase with `use` prefix | `useWorkspace`, `useWorkspaceTheme` |

### Imports

Required order:

```tsx
// 1. React / Next.js libraries
import { useCallback, useState } from 'react'
import { NextRequest, NextResponse } from 'next/server'

// 2. External dependencies
import { PrismaClient } from '@prisma/client'

// 3. Internal imports using @/
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/hooks/use-workspace'
```

- Always use the `@/` alias for internal imports. Never use relative paths like `../../lib/utils`.
- Sort alphabetically inside each group.

### React Components

```tsx
// Props type above the component
type AgentCardProps = {
  displayName: string
  agentId: string
  description?: string
}

export function AgentCard({ displayName, agentId, description }: AgentCardProps) {
  return (/* JSX */)
}
```

- Use `type` (not `interface`) for props, with `Props` suffix.
- Export named functions (`export function`), not `export default`.
- Mark client components with `'use client'` on the first line of the file.
- Mark server actions with `'use server'` on the first line.

### Styling

- Use Tailwind classes. Do not add custom CSS unless there is a real need.
- Combine classes with `cn()` from `@/lib/utils`:
  ```tsx
  <div className={cn('flex items-center', isActive && 'bg-primary')} />
  ```
- Base UI components (shadcn/ui) live in `src/components/ui/`. Do not modify them unless necessary; create wrappers when needed.

### TypeScript

- **Strict mode is enabled.** Do not use `any` or `as` without justification.
- Use explicit types at module boundaries (exports, API routes, server actions).
- Inside implementations, let TypeScript infer where possible.
- Use discriminated unions for error-capable results:
  ```tsx
  type Result =
    | { ok: true; data: Instance }
    | { ok: false; error: string }
  ```

### Error Handling

- Return typed `Result` objects instead of throwing exceptions.
- Validate only at system boundaries (user input, external APIs). Trust internal code.
- Do not swallow errors: if you catch, add context and rethrow/return.

---

## Architecture Patterns

### API Routes (BFF)

```
/api/u/[slug]/...      → User APIs (agents, connectors)
/api/w/[slug]/...      → Workspace APIs (chat streaming via SSE)
/api/instances/[slug]/ → Instance control (start, stop, restart)
```

- Extract session from cookies with `getSession()`.
- Verify authorization after authentication.
- Return JSON responses with explicit HTTP status codes.
- Error payload format: `{ error: string }`.

### Server Actions (`src/actions/`)

- Files are marked with `'use server'`.
- They return typed `Result` objects and never throw.
- Use descriptive camelCase names: `startInstance`, `stopInstance`.

### Spawner (Container Lifecycle)

The spawner in `src/lib/spawner/` manages container creation, health, and cleanup:

- `core.ts` - Main state machine.
- `docker.ts` - Wrapper around Podman/Docker API.
- `crypto.ts` - AES-256-GCM password encryption.
- `reaper.ts` - Idle cleanup daemon.

Do not modify the spawner without understanding the full flow: create container -> health check -> register in DB -> serve.

### Agent Configuration

- Source of truth for generated runtime config: Kickstart artifacts from `apps/web/kickstart/`.
- Types: `src/lib/workspace-config.ts`.
- Store: `src/lib/common-workspace-config-store.ts` (atomic read/write with SHA256 hash conflict detection).
- Runtime config is stored in the bare Git repo mounted at `/kb-config`.

### Chat Streaming

- Endpoint: `POST /api/w/[slug]/chat/stream`
- Protocol: Server-Sent Events (SSE)
- Events: `status`, `message`, `part`, `agent`, `assistant-meta`, `done`, `error`
- Client hook: `useWorkspace` in `src/hooks/use-workspace.ts`

### Database (Prisma)

- Schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/`
- Singleton: `src/lib/prisma.ts`
- For schema changes: create a migration with `pnpm db:migrate`; never edit existing migrations.

### Migration Safety (Zero-Downtime Deploys)

During a deployment, the old and new code versions run simultaneously against the same database. For this reason, **all migrations must be forward-compatible (additive)**.

| Safe (single deploy) | Unsafe (requires two deploys) |
|----------------------|--------------------------------|
| `CREATE TABLE` | `DROP TABLE` |
| `ADD COLUMN` (nullable or with default) | `DROP COLUMN` |
| `CREATE INDEX` | `RENAME COLUMN` |
| `ADD COLUMN NOT NULL DEFAULT x` | `ALTER COLUMN TYPE` |

For destructive changes, use the **expand-contract** pattern:
1. **Deploy 1 (expand):** Add the new column/table. The code writes to both (old and new) and reads from the new one with fallback to the old one.
2. **Deploy 2 (contract):** Remove the old column/table and the fallback code.

**Never** do `DROP COLUMN`, `RENAME COLUMN`, or `ALTER COLUMN TYPE` in a single migration while blue-green deployments are active.

---

## Security

These rules are **mandatory** and must never be ignored:

- **Never commit secrets:** no `.env`, credentials, API keys, or tokens.
- **Encryption:** connectors and instance passwords use AES-256-GCM. Use existing functions in `lib/spawner/crypto.ts` and `lib/connectors/`.
- **Sessions:** tokens are hashed in DB, cookies are HTTP-only. Never expose raw tokens.
- **Sanitization:** never trust user input without boundary validation.
- **Audit:** sensitive actions must create an `AuditEvent`.
- **Containers:** `arche-internal` is an internal network. Do not expose container ports directly on host outside Traefik.
- **OWASP Top 10:** actively verify your code does not introduce XSS, SQL injection, CSRF, etc.

---

## Git and Commits

### Commit format (Conventional Commits)

```
<type>(<scope>): <short description>

[optional body]
```

**Types:**
- `feat` - New functionality
- `fix` - Bug fix
- `chore` - Maintenance/cleanup
- `refactor` - Structural change without behavior change
- `test` - New or modified tests
- `docs` - Documentation

**Common scopes:** `web`, `config`, `infra`, `spawner`, `workspace`, `auth`, `agents`

**Examples:**
```
feat(agents): add temperature slider to agent editor
fix(spawner): handle container timeout on slow networks
chore: remove legacy duplicate files
test(spawner): add health check retry tests
```

### Git Rules

- Do not force-push to `main`.
- Do not use `--no-verify` unless the user explicitly requests it.
- Do not commit files unrelated to your change.
- Create new commits; do not amend existing commits unless requested.
- Use `git add <specific-files>` instead of `git add .` or `git add -A`.
- Before creating a commit or declaring a PR-ready change, run `bash scripts/check-podman-images.sh` from the repo root and treat failures as blocking.

---

## Kickstart Templates

Knowledge Base starter content is defined in Kickstart templates, not in a tracked root `kb/` vault.

- Edit template definitions in `apps/web/kickstart/templates/definitions/`.
- Keep template changes minimal and explicit (paths/content in `kbSkeleton`).
- Preserve placeholder usage (`{{companyName}}`, `{{companyDescription}}`) where applicable.
- Generated runtime KB content is written to the mounted bare repo at `/kb-content`.

---

## Tests

- Framework: Vitest 3 (configured in `vitest.config.ts`)
- Location: next to code in `__tests__/` folders
- Naming: `<module>.test.ts` for unit, `<module>.e2e.test.ts` for integration
- Run: `pnpm test` (all), `pnpm test:watch` (watch mode)

### Test Patterns

```typescript
describe('startInstance', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns already_running if instance is running', async () => {
    mockPrisma.instance.findUnique.mockResolvedValue(/* ... */)
    const result = await startInstance('alice', 'user-1')
    expect(result).toEqual({ ok: false, error: 'already_running' })
  })
})
```

- Use `vi.mock()` for dependencies.
- Tests must be deterministic: no network or time dependencies.
- Prefer table-driven tests for multiple similar cases.

---

## Directory Structure - Where Things Go

| I need... | Put it in... |
|-------------|---------------|
| Reusable UI component (button, dialog, etc.) | `src/components/ui/` |
| Feature component (workspace, agents) | `src/components/<feature>/` |
| Custom hook | `src/hooks/` |
| Business logic / utilities | `src/lib/` |
| Server action | `src/actions/` |
| API route | `src/app/api/...` |
| Page | `src/app/<route>/page.tsx` |
| Shared type | `src/types/` |
| React Context | `src/contexts/` |
| Test | `<module>/__tests__/<name>.test.ts` |
| Kickstart agent catalog | `apps/web/kickstart/agents/` |
| Kickstart KB/config templates | `apps/web/kickstart/templates/definitions/` |
| Infra / compose | `infra/` |

---

## Checklist Before Delivering a Change

- [ ] I read the files I will modify before editing.
- [ ] My change does only what was requested, no extras.
- [ ] Imports follow ordering and use the `@/` alias.
- [ ] Names follow conventions (kebab-case files, PascalCase components, etc.).
- [ ] I did not introduce `any`, `as unknown`, or unnecessary casts.
- [ ] I did not introduce security vulnerabilities (XSS, injection, exposed secrets).
- [ ] Tests pass: `pnpm test`.
- [ ] Linter passes: `pnpm lint`.
- [ ] Podman images build locally: `bash scripts/check-podman-images.sh`.
- [ ] Commit follows Conventional Commits.
- [ ] I did not commit sensitive files (`.env`, credentials, keys).

---

## Quick Commands

```bash
# From apps/web/
pnpm dev                    # Dev server (0.0.0.0:3000)
pnpm build                  # Production build
pnpm test                   # Run tests
pnpm test:watch             # Run tests in watch mode
pnpm lint                   # Lint
pnpm prisma:generate        # Regenerate Prisma client
pnpm db:migrate             # Create migration
pnpm db:seed                # Seed initial data

# Full stack (from repo root)
build images locally       # bash scripts/check-podman-images.sh
podman compose -f infra/compose/compose.yaml up -d --build
podman compose -f infra/compose/compose.yaml down
podman compose -f infra/compose/compose.yaml logs -f web
```
