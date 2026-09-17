## Purpose

Defines the behavioral contract for pull-request pipeline governance: how check execution is selected from a PR's diff, which automated governance checks every PR must pass, how work-in-progress state is labeled, and which comment commands reviewers can use on a PR.

## ADDED Requirements

### Requirement: PR checks follow the diff, not trigger path filters
The PR check workflow SHALL run on every pull request targeting `main` and SHALL select its check jobs from the set of files changed relative to the merge base with `main`: web checks run when the diff touches `apps/web/` or `scripts/`, desktop checks run when it touches `apps/desktop/`. A pull request whose diff touches no checked area SHALL produce a completed run with no check jobs, rather than no check run at all.

#### Scenario: Workflow-file-only pull request
- **WHEN** a pull request changes only GitHub workflow files
- **THEN** the check workflow starts and completes with jobs selected according to the diff

#### Scenario: Mixed-area pull request
- **WHEN** a pull request changes files under both `apps/web/` and `apps/desktop/`
- **THEN** both the web and desktop check jobs execute

#### Scenario: Unrelated-area pull request
- **WHEN** a pull request changes only files outside the web, scripts, and desktop areas
- **THEN** no web or desktop check job executes and the run still completes

### Requirement: Dependency versions are pinned
Every repository `package.json` SHALL declare exact version pins for its `dependencies` and `devDependencies`. A version range, dist-tag, or other non-exact reference SHALL fail the governance check, except for `workspace:`, `link:`, `https://`, `http://`, and `file:` protocol references, which are permitted. A manifest with no dependencies, or one that cannot be parsed, SHALL not fail the check.

#### Scenario: Caret range rejected
- **WHEN** a pull request adds `"lodash": "^4.17.21"` to a `package.json`
- **THEN** the pinned-versions check fails naming the package and file

#### Scenario: Workspace reference accepted
- **WHEN** a `package.json` depends on a workspace package via `"arche-web": "workspace:*"`
- **THEN** the pinned-versions check passes for that entry

#### Scenario: Local link reference accepted
- **WHEN** a `package.json` depends on a local package directory via `"@arche/desktop-runtime": "link:../desktop-runtime"`
- **THEN** the pinned-versions check passes for that entry

#### Scenario: Generated manifest tolerated
- **WHEN** a `package.json` under build output cannot be parsed
- **THEN** the check warns and does not fail

### Requirement: Pull requests are screened for sensitive files and secrets
The governance workflow SHALL fail a pull request when a changed file's name matches sensitive-file patterns (environment files, private keys, certificate/keystore stores, credential or auth config files), and when added diff lines match known hardcoded-secret patterns (cloud and CI provider tokens, private key blocks, assignment of quoted password/secret/api-key/access-token values). Binary files SHALL be excluded from the content scan.

#### Scenario: Environment file added
- **WHEN** a pull request adds a file named `.env.production`
- **THEN** the security scan fails identifying the file

#### Scenario: Hardcoded token in added lines
- **WHEN** a pull request adds a line assigning a quoted value matching a provider token pattern
- **THEN** the security scan fails showing the matched line

#### Scenario: Binary file changed
- **WHEN** a pull request changes only binary assets (images, archives, lockfiles)
- **THEN** the content scan skips them

### Requirement: Work-in-progress titles are labeled
When a pull request title contains the whole word `wip` (case-insensitive), the system SHALL add the `wip` and `not-ready-to-merge` labels; when the title no longer matches, it SHALL remove them. Label state SHALL always mirror the current title.

#### Scenario: Title gains WIP
- **WHEN** a pull request is opened or retitled with `WIP` in the title
- **THEN** both labels are present

#### Scenario: Title drops WIP
- **WHEN** a labeled pull request is retitled without `wip`
- **THEN** both labels are removed

### Requirement: Comment commands are exact-match and permission-gated
The PR comment commands `/build`, `/lgtm`, `/rerun`, and `/help` SHALL act only when the comment body, trimmed, exactly equals the command and the comment is on a pull request. `/lgtm` and `/rerun` SHALL require the commenter to hold `write` or `admin` collaborator permission; `/lgtm` SHALL refuse to approve a pull request authored by the commenter.

#### Scenario: Partial command text ignored
- **WHEN** a comment reads `/lgtm but also check X`
- **THEN** no approval is created

#### Scenario: Non-write commenter
- **WHEN** a commenter without write access issues `/lgtm` or `/rerun`
- **THEN** the command fails with a permission error and takes no action

#### Scenario: Self-approval refused
- **WHEN** the pull request author comments `/lgtm`
- **THEN** no approving review is created

#### Scenario: Successful rerun
- **WHEN** a user with write access comments `/rerun` on a PR with failed GitHub Actions checks
- **THEN** the failed jobs of those runs are re-run and the command is acknowledged with a reaction
