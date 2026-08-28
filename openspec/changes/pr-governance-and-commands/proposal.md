## Why

PR quality gates were manual and incomplete. Path-filtered `pr-checks.yml` triggers silently skip checks when a PR mixes areas (a workflow-file-only change runs nothing), nothing keeps dependency versions pinned across the growing number of `package.json` files, and nothing screens PRs for sensitive files or hardcoded secrets before merge. Reviewer mechanics were also manual: no way to label work-in-progress PRs, approve from a comment, re-run failed checks, or discover the commands that do exist — only `/build` was wired up.

## What Changes

- Add `pr-governance.yml` with three jobs, running on PR open/edit/synchronize/reopen:
  - `wip-labeler` — adds `wip` + `not-ready-to-merge` labels when the PR title matches `\bwip\b` (case-insensitive) and removes both when it no longer does.
  - `pinned-versions` — fails the check when any repository `package.json` (excluding `node_modules`, build output) declares a dependency outside `dependencies`/`devDependencies` whose version is not an exact `x.y.z`-style pin; `workspace:`, `http(s)://`, and `file:` references are allowed; malformed `package.json` files are skipped with a warning.
  - `security-scan` — fails the check when added/changed files match sensitive filename patterns (`.env*`, key/certificate stores, credential files, `.npmrc`, …) or when added diff lines match hardcoded-secret patterns (AWS/GitHub/GitLab/Slack tokens, private key blocks, password/secret/api-key assignments); binary extensions are skipped; the `edited` action is skipped to avoid re-scanning description edits.
- Expand `pr-commands.yml` beyond `/build` with three write-gated comment commands, each requiring exact command match (`body.trim()`) and collaborator `write`/`admin` permission:
  - `/lgtm` — approves the PR; refuses self-approval.
  - `/rerun` — re-runs failed/cancelled GitHub Actions checks on the PR head (paginated); reacts to acknowledge.
  - `/help` — posts the command table.
- Rework `pr-checks.yml` triggering: drop `pull_request.paths` filters in favor of a `detect-changes` job that computes changed paths via `git diff origin/main...HEAD` and gates the web/desktop jobs with `needs`/`if`, so workflow-file changes no longer skip check runs and job selection follows the actual diff.

## Capabilities

### New Capabilities
- `pr-governance`: Behavioral contract for pull-request pipeline governance — WIP labeling, dependency version pinning, sensitive-file/secret screening, path-aware check selection, and comment-driven PR commands.

### Modified Capabilities
- (none — no existing spec covers CI behavior.)

## Impact

- `.github/workflows/pr-governance.yml` — new workflow (3 jobs).
- `.github/workflows/pr-commands.yml` — keeps `/build` unchanged; adds `/lgtm`, `/rerun`, `/help` jobs.
- `.github/workflows/pr-checks.yml` — `paths` filters replaced by `detect-changes` job; web/desktop jobs gain `needs`/`if` gates.
- No application code, DB, or dependency changes; `GITHUB_TOKEN` permissions are scoped per job (`pull-requests: write`, `contents: read`, `actions: write` where needed).
- Verification is workflow-level: `actionlint` clean, YAML valid, behaviors exercised on live PRs (WIP title changes, unpinned dependency, `/lgtm` self-approval refusal, `/rerun`, `/help`).
