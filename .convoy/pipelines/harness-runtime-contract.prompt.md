# Brief: OpenSpec change `harness-runtime-contract`

The attached OpenSpec change (proposal, design, delta specs, tasks) is the contract. `design.md` holds the
decisions (D1–D8) and the phase plan; follow it, and record any deviation in your report with the reason.

## Implementer steps (impl-seam, impl-tools, impl-v2, impl-archive, impl-desktop)

The change is split across five implementer sessions, one per migration phase. Each session:

1. Reads `openspec/changes/harness-runtime-contract/tasks.md` and `git log --oneline main..HEAD`.
2. Implements **only the first phase whose tasks are not all ticked**, using this mapping:

   | Phase | Task groups |
   |---|---|
   | 1 — seam (pure refactor) | 1, 2, 3 |
   | 2 — arche-tools MCP | 4 |
   | 3 — runtime kind + OpenCode v2 adapter | 5 |
   | 4 — legacy archive + switch | 6 |
   | 5 — desktop + contract prep | 7, 8.2, 8.3 |

3. Ticks each task in `tasks.md` (`- [x]`) only when its stated verification passed. Leaves a task unticked
   when it needs something a session cannot do, and lists it under "Needs a human" in the report.
4. Ends with a report: what was done per task, verification commands and results, deviations from design,
   open risks, and anything the next phase must know.

Do not start the next phase in the same session, even if time remains.

### Tasks that stay with a human (implement the code, leave the box unticked, report it)

- 3.6 manual UI walkthrough; 5.7 manual end-to-end run (the admin action and its test DO get implemented);
  6.7 staging deploy and rollback check (the config flip stays at `opencode-v1` in committed config; document
  the flip and the rollback in `infra/README.md`); 7.2 manual desktop vault upgrade.
- **8.1 is out of scope for this branch.** Removing the v1 adapter in the same deploy would remove the rollback
  path design D3/D7 depend on. Do not delete `adapters/opencode-v1/`, `@opencode-ai/sdk`, or the legacy image/binary.

### Phase-specific notes

- **1.1 spike**: no live OpenCode 2 container is required. Install `@opencode/client` (2.x) in a scratch dir
  outside the repo and read its types and generated API; use the OpenCode 2 docs (`https://opencode.ai/v2/docs/`).
  If podman is available, you may also run the 2.x image locally to confirm serve/auth/health/events. Mark
  anything not confirmed as `UNVERIFIED` in `NOTES.md`; phase 3 must re-check each `UNVERIFIED` item before
  relying on it and update `NOTES.md`.
- **Phase 1** must not change behavior. The golden tests in 2.4 are the proof.
- **Phase 3**: `@opencode/client` is added to `apps/web` here, not before. Default runtime kind stays `opencode-v1`.
- **Migrations**: additive only (`ADD COLUMN` nullable, `CREATE TABLE`, `CREATE INDEX`), in both
  `prisma/schema.prisma` and `prisma/schema.sqlite.prisma`. Never edit existing migrations.

## Every step

- Follow `AGENTS.md`: `@/` imports in the required order, named exports, `type` (not `interface`) for props,
  no `any` or unjustified `as`, typed `Result` objects, tests in `__tests__/` next to the code, no unrequested
  refactors, `AuditEvent` for sensitive actions, pnpm only.
- Before finishing a writing step, run from `apps/web/`: `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`.
  Implementer steps that touch `infra/` also run `bash scripts/check-podman-images.sh` from the repo root.
  Report any command that could not run and why. Never use `--no-verify`, never disable tests.
- Never commit secrets or `.env` files.

## Done means

- Task groups 1–7 implemented, plus 8.2 and 8.3, with every machine-verifiable box ticked.
- `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build` pass in `apps/web/`;
  `bash scripts/check-podman-images.sh` passes; `openspec validate harness-runtime-contract --strict` passes.
- `src/lib/opencode/` no longer exists and the D8 lint rule is active.
- Default runtime kind is still `opencode-v1` in committed config; switching to v2 is a config flip.
