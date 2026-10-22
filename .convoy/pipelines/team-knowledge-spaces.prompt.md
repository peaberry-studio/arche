# Brief: OpenSpec change `team-knowledge-spaces`

The attached OpenSpec change is the contract: the proposal, the design, the delta spec, and the tasks. `design.md` holds the decisions D1–D12. Follow it. If you deviate, record the deviation and the reason in your report. D2 and D3 are a **cross-lane contract** between the web app and the workspace image, which are built in parallel on two branches. Do not change those shapes. If one of them is impossible, implement the closest compliant behavior and flag it in your report.

## Your scope is decided by your step name

Each implementer step owns specific task groups in `tasks.md`. **Your step name decides your scope, not the checkbox state of earlier groups.**

| Step | Pipeline | Task groups | May touch |
|---|---|---|---|
| `impl-data` | tks-web | 1 | `apps/web/**` |
| `impl-api` | tks-web | 2 | `apps/web/**` |
| `impl-wiring` | tks-web | 3 | `apps/web/**`, `infra/**` except `infra/workspace-image/**`, `scripts/**` |
| `impl-ui` | tks-web | 4, 5 | `apps/web/**` |
| `impl-rt-git` | tks-runtime | 6.1, 6.2 | `infra/workspace-image/**` only |
| `impl-rt-kb` | tks-runtime | 6.3, 6.4, 6.5 | `infra/workspace-image/**` only |
| `impl-integration` | tks-integrate | 7 | anything this change covers |

Other steps (design, tests, audits, fixers, scorers) work on the whole change as it stands on the current branch, within their pipeline's lane scope:
- tks-web: never `infra/workspace-image/**`
- tks-runtime: only `infra/workspace-image/**`
- tks-integrate: everything

## Rules

- **Lane isolation.** The two lanes run at the same time on different branches and get merged afterwards. A web-lane step must not edit `infra/workspace-image/**`, and a runtime-lane step must edit nothing else. This includes `tasks.md`: tick only your own group's boxes, so the merge stays conflict-free.
- **Never stop because an earlier group has unticked tasks.** If you find that an earlier group's machine-verifiable work is broken (a failing test, a lint error, a gap your group needs), fix it minimally at the start of your session, say so in your report, then do your own group.
- Do not start the next group in the same session, even if time remains.
- Tick a task in `tasks.md` (`- [x]`) only when its stated verification passed.
- Follow `AGENTS.md` at the repo root:
  - `@/` imports, `type` props, named exports
  - typed `Result` objects, `{ error }` API payloads
  - an `AuditEvent` for every sensitive action
  - no `any` and no unjustified `as`
  - minimum necessary change
  - tests next to the code in `__tests__/`
- Migrations must be additive only (AGENTS.md "Migration Safety"). Never edit an existing migration.
- End with a report covering:
  - what was done, per task
  - the verification commands you ran and their results
  - deviations from the design
  - open risks
  - what the next group must know (file names, exported function names, API shapes you settled)

## Tasks that stay with a human (implement the code, leave the box unticked, report it, keep going)

- 4.5 manual UI walkthrough.
- Anything that needs a live Postgres you cannot start. The `*.e2e.test.ts` files are skipped without `DATABASE_URL`, which is fine. Write them anyway if the design calls for one.

## Tool limits

- **Convoy blocks dependency installs.** No new packages should be needed. If one is, implement everything else and list the exact `pnpm add …` / `go get …` command under "Needs a human".
- **Do not modify `apps/web/.env.example`.** Convoy's secret guard refuses to commit it, and the step fails. Document new environment variables in `infra/README.md`.
- If `pnpm db:migrate` cannot reach a database, write the migration SQL by hand in a new timestamped folder under `apps/web/prisma/migrations/`, named like the existing ones. Use only `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE … ADD CONSTRAINT` (foreign keys on the new tables). Then run `pnpm prisma:generate:all`.

## Phase notes

- `impl-data`: the desktop schema (`prisma/schema.sqlite.prisma`) mirrors every Postgres model, and `lib/prisma-desktop.ts` holds hard-coded DDL. Mirror the new models in both. Look at how the existing enums and models (for example `Flow` and `FlowVisibility`) are represented there and copy that.
- `impl-api`: there is no `requireAdmin` helper. Routes check `session.user.role !== 'ADMIN'` inline (see `app/api/u/[slug]/team/route.ts`), so follow that. Find the existing spawner stop path for D8 in `lib/spawner/core.ts` and `actions/spawner.ts`. Do not build a second one.
- `impl-wiring`: the spawner bind lives in `lib/spawner/docker.ts` `createContainer` (next to `binds.push(\`${kbContentHostPath}:/kb-content\`)`). The hash lives in `core.ts` `hashWorkspaceRuntimeArtifacts`. Agent transforms live in `lib/spawner/agent-config-transforms.ts`, and the v2 runtime config is built in `lib/harness/adapters/opencode-v2/runtime-config.ts`. Agents are filtered in the runtime artifact build, not in the stored config.
- `impl-ui`: reuse `components/team/*` patterns and the shadcn/ui components in `src/components/ui/`. The file tree is `components/workspace/file-tree*.tsx`, `knowledge-navigation-panel.tsx`, and `review-panel.tsx`.
- `impl-rt-git` / `impl-rt-kb`: the workspace agent is a single Go file, `infra/workspace-image/workspace-agent/main.go`, with tests in `main_test.go`. Its git helpers assume one repo at `/workspace`, so introduce a small repo-resolution layer and keep every common-repo code path behaving exactly as it does today. The existing tests must keep passing unchanged.
- `impl-integration`: by now the runtime branch has been merged into this branch. Read both lanes' reports in the commit history (`git log`) and check the D3 shapes on both sides first.
