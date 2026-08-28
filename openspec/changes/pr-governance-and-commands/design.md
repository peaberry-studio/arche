## Context

See `proposal.md` — Why for the gate and ergonomics gaps.

Current mechanics that shape this design (verified in code):

- `pr-checks.yml` on main triggers on `pull_request` with a `paths` filter listing web/desktop/scripts and its own file. GitHub's `paths` filters evaluate against the PR's files, so a PR touching only other workflow files (or a workflow that no longer matches the list) starts no check runs — which blocks branch protection that requires those checks, or worse, merges unverified.
- The repo now has multiple `package.json` files (root, `apps/web`, `apps/desktop`, generated dirs); pnpm workspaces use `workspace:` protocol internally.
- `/build` in `pr-commands.yml` works by `repository dispatch` (`build-pr-image`) consumed by the build workflow, acknowledged with a 👍 reaction.
- Branch protection on `main` already requires PR checks; the repo has an `auto-merge.yml` workflow, so labeling (`not-ready-to-merge`) is a real merge blocker only if honored by reviewers/auto-merge rules — the label is the contract, enforcement lives elsewhere.

## Goals / Non-Goals

**Goals:**

- Every PR gets exactly the checks its diff implies, and workflow-file changes always get a run.
- Dependency pinning, sensitive files, and obvious secrets are screened automatically on every PR update.
- WIP state is visible on the PR itself, not in reviewers' heads.
- Comment commands are safe by construction: exact-match, permission-gated, self-approval-proof.

**Non-Goals:**

- Replacing the secret scanner with a managed third-party app (e.g. secret scanning push protection) — repository-level GitHub settings, not workflow code.
- Enforcing labels in branch protection rules (`not-ready-to-merge` as a required context) — separate infra decision.
- Lockfile auditing (`pnpm audit`), license checks, or SBOM — different changes.
- Handling `/commands` in issue comments (non-PR) — all commands no-op unless the comment is on a PR.
- New check runs for docs-only PRs beyond what `detect-changes` already skips.

## Decisions

### D1: `detect-changes` job with explicit diff instead of `paths` filters

- One job checks out with `fetch-depth: 0`, runs `git diff --name-only origin/main...HEAD`, and emits `web`/`desktop` booleans consumed via `needs`/`if` by every check job. Regex: web = `^(apps/web/|scripts/)`, desktop = `^apps/desktop/`.
- Dropping the `pull_request.paths` trigger filter means the workflow always runs on PRs; the gates keep job selection equivalent while fixing the "no check runs at all" hole for workflow-file edits (the previous `paths` list included only `pr-checks.yml` itself, not other workflows).
- Alternative considered: `dorny/paths-filter` action — rejected; adds a third-party dependency for logic that is ten lines of shell, and the repo standard keeps workflows dependency-light.

### D2: Pinning policy is exact versions, with a deliberate allowlist

- Any semver-looking range (`^`, `~`, `>=`, `*`, dist-tags) fails. `workspace:`, `https?://`, and `file:` protocols pass: workspace links are the pnpm mechanism, and URL/file deps are version-addressed by their target.
- Malformed `package.json` files warn and are skipped rather than failing the check — generated/vendor manifests must not wedge CI; package files with zero deps are skipped outright.
- Scans only `dependencies` and `devDependencies`; `peerDependencies`/`optionalDependencies` are out of scope for now.

### D3: Secret scanning is advisory-pattern based over added lines only

- Fixed pattern list (AWS/GitHub/GitLab/Slack tokens, `github_pat_`, private key PEM headers, `password|secret|api_key|access_token` assignments with quoted 8+-char values) applied to `git diff` added lines, excluding binary extensions. Failures print `::error` annotations.
- Trade-off accepted: pattern scanning has false positives (test fixtures, docs examples). The alternative (allowlist files) is deferred until a real false positive demands it.
- Sensitive-filename screening is a separate, broader net: any added/changed path matching env/key/credential patterns fails regardless of content.

### D4: `/lgtm` and `/rerun` are exact-match and write-gated

- Commands compare `body.trim()` to the exact string, so "＼lgtm but also check X" never triggers; `startsWith` in the job `if` is only a cheap pre-gate, the script re-validates.
- Both require collaborator permission `admin`/`write` via `getCollaboratorPermissionLevel`. `/lgtm` additionally refuses when the commenter is the PR author (no self-approval). `/rerun` paginates `checks.listForRef` (filter `latest`), re-runs only failed/cancelled runs belonging to `github-actions`, and reacts 👍/😕 to report outcome.
- `/help` posts the table and is likewise write-gated — consistent with the others, avoids noise from drive-by commenters.

### D5: WIP labeling is idempotent and self-reversing

- Title regex `\bwip\b` (case-insensitive) drives add and remove of both `wip` and `not-ready-to-merge`. Removing labels is tolerant of already-removed labels (409/404 swallowed). Runs on every PR synchronize/edit, so the label state always mirrors the current title.

## Risks / Trade-offs

- [Pattern-based secret scan false positives block PRs] → Mitigation later by allowlisting specific paths if it bites; scanner output shows the matched lines so authors can reword quickly.
- [`detect-changes` diff against `origin/main` on merge-queue/fast-forward churn] → The three-dot diff uses the merge base, so unrelated main activity doesn't widen the gate.
- [`/rerun` re-runs only `github-actions` check runs] → Third-party check apps are out of scope; the confused reaction signals nothing was re-runnable.
- [Pinning check friction for quick experiments] → Intentional: exact pins are the repo standard; `workspace:`/URL deps remain available for local packages.

## Migration Plan

1. Single merge of the workflow files; no application changes. Governance jobs start running on the next PR update; existing PRs get labeled/scanned on their next synchronize event.
2. Rollback: disable the workflows in the Actions UI or revert the merge; no data or state to unwind (labels are removed automatically when titles no longer match).

## Open Questions

- Whether `not-ready-to-merge` should become a branch-protection required context (needs a repo-settings decision outside this change).
