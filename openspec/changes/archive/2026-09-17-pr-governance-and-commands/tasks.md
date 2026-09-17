## 1. PR governance workflow

- [x] 1.1 Add `.github/workflows/pr-governance.yml` triggering on `pull_request` (opened, edited, synchronize, reopened) plus `workflow_dispatch`, with a `wip-labeler` job that mirrors the `wip`/`not-ready-to-merge` labels from a `\bwip\b` title match (guarded to PR events, tolerant of already-removed labels).
- [x] 1.2 Add the `pinned-versions` job: scan every tracked `package.json` (excluding `node_modules`, `.next`, `generated`, `.pnpm`) and fail when any `dependencies`/`devDependencies` entry is not an exact version pin; allow `workspace:`, `https?://`, `file:` refs; skip zero-dep and malformed manifests (malformed emits a warning).
- [x] 1.3 Add the `security-scan` job: fail on added/changed files matching sensitive filename patterns (env files, keys/certstores, credential files, rc/auth files) and on added diff lines matching hardcoded-secret patterns; skip binary extensions; skip `edited` events.
- [x] 1.4 Scope job permissions minimally (`pull-requests: write` for the labeler, `contents: read` for scanners).

## 2. PR comment commands

- [x] 2.1 Extend `.github/workflows/pr-commands.yml` with `/lgtm`: exact-match command, collaborator `admin`/`write` gate, self-approval refusal, approving review + 👍 reaction on success.
- [x] 2.2 Add `/rerun`: exact-match command, write gate, paginate latest check runs on the PR head, re-run failed/cancelled `github-actions` runs, 👍/😕 reaction by outcome.
- [x] 2.3 Add `/help`: exact-match command, posts the command table, 👍 reaction. Keep `/build` unchanged.
- [x] 2.4 All new commands no-op unless the comment is on a pull request.

## 3. PR checks triggering

- [x] 3.1 Rework `.github/workflows/pr-checks.yml`: remove `pull_request.paths` filters, add a `detect-changes` job (full checkout, `git diff --name-only origin/main...HEAD`) emitting `web`/`desktop` outputs, and gate web/desktop jobs with `needs`/`if`.
- [x] 3.2 Preserve main's current check steps unchanged (including the Postgres concurrency integration test step) — triggering-only change.

## 4. Final verification

- [x] 4.1 Validate all three workflow files parse as YAML and pass `actionlint` (no errors).
- [ ] 4.2 Behaviors verified on live PRs per the PR test plan (WIP labeling, unpinned dependency rejection, sensitive-file rejection, `/lgtm` self-approval refusal, `/rerun`, `/help`).
- [x] 4.3 Run `openspec validate pr-governance-and-commands --strict` — change validates.
