# Brief: OpenSpec change `harness-runtime-contract`

The attached OpenSpec change (proposal, design, delta specs, tasks) is the contract. `design.md` holds the
decisions (D1–D8); follow it, and record any deviation in your report with the reason.

## Which phase is yours: decided by your step name

Each implementer step owns exactly one phase. **Your step name decides it, not the checkbox state of
earlier phases.**

| Step | Phase | Task groups |
|---|---|---|
| `impl-seam` | 1: seam (pure refactor) | 1, 2, 3 |
| `impl-tools` | 2: arche-tools MCP | 4 |
| `impl-v2` | 3: runtime kind + OpenCode v2 adapter | 5 |
| `impl-archive` | 4: legacy archive + switch | 6 |
| `impl-desktop` | 5: desktop + contract prep | 7, 8.2, 8.3 |

Rules:

- **Phase 1 is done and accepted** (commit `convoy(impl-seam)` on this branch; acceptance decisions are
  recorded in the comment blocks in `tasks.md`). Build on it; do not redo it.
- **Never stop because an earlier phase has unticked tasks.** Unticked tasks that need a human (listed
  below) are expected. If you find an earlier phase's machine-verifiable work actually broken (a failing
  test, a lint error, a contract gap your phase needs), fix it minimally at the start of your session,
  say so in your report, then do your own phase.
- Do not start the next phase in the same session, even if time remains.
- Tick each task in `tasks.md` (`- [x]`) only when its stated verification passed.
- End with a report: what was done per task, verification commands and results, deviations from
  design, open risks, and what the next phase must know.

## Tasks that stay with a human (implement the code, leave the box unticked, report it, keep going)

- 3.6 manual UI walkthrough; 5.7 manual end-to-end run (the admin action and its test DO get implemented);
  6.7 staging deploy and rollback check (committed config stays at `opencode-v1`; document the flip and
  the rollback in `infra/README.md`); 7.2 manual desktop vault upgrade.
- **8.1 is out of scope for this branch.** Removing the v1 adapter in the same deploy would remove the
  rollback path design D3/D7 depend on. Do not delete `adapters/opencode-v1/`, `@opencode-ai/sdk`, or the
  legacy image/binary.

## Branch state and tool limits (read first)

- Phases 1 and 2 are committed. Phase 3 is partly committed (`feat(spawner): record runtime kind…`):
  5.1 and 5.3 are ticked; 5.2, 5.4 (partial) and 5.5, 5.6 (not started) remain. `impl-v2` continues from
  there.
- `@opencode/client@2.0.32` is already in `apps/web/package.json` (it matches the local `opencode`
  2.0.32 binary). `infra/workspace-image/arche-tools/pnpm-lock.yaml` exists, and
  `bash scripts/check-podman-images.sh` passes on this branch.
- **Convoy blocks dependency installs.** If your phase needs a package that is not installed, do not
  work around it: implement everything else, and list the exact `pnpm add …` command under
  "Needs a human".
- **Do not modify `apps/web/.env.example`**: Convoy's secret guard refuses to commit it and the step
  fails. Document new environment variables in `infra/README.md` instead. It already lists
  `ARCHE_DEFAULT_RUNTIME_KIND` and `OPENCODE_V1_IMAGE`, but its `OPENCODE_V1_IMAGE` value (`…:v6.0.0`) is
  wrong; if you settle the correct tag, put the exact replacement line under "Needs a human".
- The legacy v1 image must be a pinned OpenCode **1.18.18** build (today's `versions/opencode.version`),
  not the `v6.0.0` release tag (that ships 1.17.9).

## Phase notes

- **Phase 3**: `@opencode/client` (2.x) is added to `apps/web` here. Re-check every `UNVERIFIED` item in
  `apps/web/src/lib/harness/adapters/opencode-v2/NOTES.md` before relying on it. OpenCode 2 is installed
  on this machine (`opencode --version` → 2.x) and podman is available, so you can confirm behavior against
  a real local `opencode serve` or the 2.x image; update `NOTES.md` with what you confirmed. Anything you
  still cannot confirm stays `UNVERIFIED` and is handled behind a clear typed error, not guessed. The v2
  adapter must also provide the workspace-files bridge the v1 adapter has (see task 3.1).
  Default runtime kind stays `opencode-v1`.
- **Migrations**: additive only (`ADD COLUMN` nullable, `CREATE TABLE`, `CREATE INDEX`), in both
  `prisma/schema.prisma` and `prisma/schema.sqlite.prisma`. Never edit existing migrations.

## Every step

- Follow `AGENTS.md`: `@/` imports in the required order, named exports, `type` (not `interface`) for
  props, no `any` or unjustified `as`, typed `Result` objects, tests in `__tests__/` next to the code, no
  unrequested refactors, `AuditEvent` for sensitive actions, pnpm only.
- Before finishing a writing step, run from `apps/web/`: `pnpm test`, `pnpm lint`, and the typecheck.
  **Typecheck gate**: `pnpm exec tsc --noEmit` has pre-existing test diagnostics on `main` (281). The gate
  is zero diagnostics in production source (non-test files) and no more test diagnostics than the branch
  had when your step started (241 after phase 1). Do not do unrelated cleanup of old test typing.
- Steps that touch `infra/` also run `bash scripts/check-podman-images.sh` from the repo root.
- Report any command that could not run and why. Never use `--no-verify`, never disable tests, never
  commit secrets or `.env` files.

## Done means

- Task groups 1–7 implemented, plus 8.2 and 8.3, with every machine-verifiable box ticked.
- `pnpm test`, `pnpm lint`, `pnpm build` pass in `apps/web/`; the typecheck gate above holds;
  `bash scripts/check-podman-images.sh` passes; `openspec validate harness-runtime-contract --strict` passes.
- Default runtime kind is still `opencode-v1` in committed config; switching to v2 is a config flip.
