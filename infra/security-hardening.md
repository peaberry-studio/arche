# Security hardening and rollout

This branch addresses the verified security findings against the OpenCode v2 runtime migration. The initial hardening was merged in PR #511 (`fbacc98a`); the architectural follow-up was merged in PR #515 (`1601048a`). Production has not been changed and credentials have not been rotated.

## Implemented protections

- The container socket proxy is pinned by digest and isolated on `arche-control`. Workspaces remain on `arche-internal`; existing blue-green web containers join the control network before the proxy is replaced. The one-click installer generates the same isolation and updates proxy and Traefik alongside the backend.
- Workspace KB mounts are read-only. The BFF receives Git objects in quarantine and permits only `refs/heads/proposals/<authenticated-slug>/pending`. Publication to shared `main` requires explicit administrator approval of the exact proposal commit and current main commit, enforced with a Git ref transaction. Workspace and broker Git commands disable hooks.
- Workspaces run as UID/GID 1000 with no capabilities, `no-new-privileges`, a read-only root filesystem and bounded private tmpfs mounts. Persistent volumes are migrated before startup by a temporary root helper with no network, credentials or KB mount. Migration refuses volumes mounted by running containers, preserves file contents, avoids following symlinks and removes special permission bits. A failed migration prevents startup. The legacy archive helper remains root with only `DAC_OVERRIDE`, read-only source mounts and bounded disposable storage.
- User-configurable remote connector requests require public HTTPS destinations, reject redirects and validate DNS answers at socket connection time. This includes Umami login/API requests and remote tool discovery. Linear and Notion MCP URLs come from their canonical server configuration. Outbound MCP and provider headers exclude browser credentials. The loopback OAuth fixture is available only with explicit E2E hooks outside production.
- Connector gateway credentials expire after five minutes and are scoped to the connector, workspace and current instance credentials. A workspace-agent proxy obtains a fresh credential before each request in both web and Desktop; generated config contains only a connector-specific local capability. Stop, restart, disable and deletion are checked before new upstream requests. Existing streams may continue until their five-minute deadline. Legacy permanent tokens are rejected.
- Shared flows require an administrator to approve the exact definition before another user can run them. Definition changes invalidate approval; the runner checks permission again before starting a workspace or accessing its credentials. Approval uses conditional database updates to reject concurrent edits and records an audit event. Owners retain access to their own flows.
- OAuth state is bound to the initiating session and consumed atomically before exchange. Administrators cannot complete another user's authorization. Manual connector secrets are redacted from responses and preserved when omitted from edits.
- GitHub KB installation tokens stay in the BFF and its Git child process, scoped to the configured repository and contents write permission. They are revoked after each operation; failures to revoke are audited. Workspace sync receives only a boolean indicating an incoming local Git ref, and legacy credential-bearing agent requests are rejected.
- `/build` checks repository permissions and rejects forks, then dispatches an immutable commit through the GitHub API. The workspace image workflow independently validates the source; the separate web image receiver still needs equivalent validation. Repository dispatch is already authenticated by GitHub and requires [contents write permission](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event); it must not treat the Actions bot as a human collaborator. Changed privileged workflows use pinned action commits.
- SSH host verification is enabled. Ansible dependencies are pinned with Python package hashes; Galaxy collections have exact versions. Both the shell deployer and the one-click installer parse `.env` assignments as data. Binary installers require checksums.
- Next.js, image and SVG handling, editor dependencies and vulnerable transitive dependencies are upgraded. CI audits production dependencies. The editor retains blank paragraphs, display math and Vega blocks after the Tiptap upgrade.

## Deployment prerequisites

1. Configure the GitHub Actions secret `VPS_KNOWN_HOSTS` with independently verified host keys. Local operators must provision their own `known_hosts`. The deploy workflow deliberately fails if the secret is absent.
2. Stop old workspace containers before rollout and recreate them with the new image and container settings, preserving their data volumes. A process restart does not change existing mounts, networks or capabilities. Inspect the shared bare KB configuration and hooks before enabling the broker if previously untrusted workspaces had write access.
3. Apply the additive PostgreSQL migration `20261023080235_flow_sharing_approval`; Desktop upgrades SQLite to schema 15. Existing shared flows start unapproved. Deploy the web and workspace images together, and restart Desktop with its new bundled workspace-agent. Complete replacement of all BFF replicas before recreating workspaces: older BFF code does not enforce the new token lifetime. Legacy permanent connector tokens are deliberately rejected, so old workspaces must be recreated. The new workspace uses `ARCHE_KB_PUSH_URL` supplied by the spawner; the new web provides that endpoint. Verify a KB fetch and publish after recreation. Broker pushes are limited to 64 MiB and 60 seconds.
4. Verify the socket proxy has only the control network, and no workspace is connected to that network. `node scripts/check-workspace-isolation.mjs` exercises the isolation topology locally with a mock control service.
5. The shell installer now requires release checksum sidecars. Publish a release through the updated release workflow before using the updated installer against it. Historical releases lacking checksums fail closed.
6. If prior tenants were untrusted, investigate exposure and rotate credentials through an explicit operational migration. Encryption-key rotation requires re-encrypting stored credentials; changing the environment value alone would lose access to them.

The existing production deployment is not hardened until these steps are applied. The local checks do not replace validation on the target host.

## Review reconciliation (23 October 2026)

The external review examined `f1490272`, before architecture commit `f2897319`. PRs #511 and #515 are merged. This table describes their historical scope; the KB follow-up below closes H2 integrity and M2 credential transport. Merge status does not establish what is deployed.

| Finding | Merged #511 | Merged #515 |
| --- | --- | --- |
| C1 dependencies; C4 comment injection; H1 SSH; H4 OAuth; H5 Ansible; M3 browser secrets; M9 outbound cookies; M10 env execution | Corrected | Protections retained |
| C2 control network | Direct access isolated, but BFF SSRF still bypassed that isolation | Network isolation retained; the two reported BFF SSRF paths corrected |
| C3 Umami and tool inventory SSRF | Valid blocker: raw fetch followed redirects after initial URL validation | Both use publicFetch; 302/307 redirects to metadata and socket proxy rejected |
| H2 KB hooks / integrity | Read-only mounts and hook suppression prevent the identified hook execution | Integrity gap remains: authenticated Git pushes are not tied to an approved knowledge review |
| H3 workspace privileges | Root with DAC_OVERRIDE | Normal workspaces use UID 1000, zero capabilities and read-only rootfs; temporary migration/archive helpers and rootful daemon are separate residuals |
| M1 gateway token lifetime | Permanent gateway token | Five-minute gateway tokens with renewal and instance revocation; local proxy capability remains valid for the current instance lifetime |
| M2 GitHub App credentials | Repository-scoped token still sent to workspace | Unchanged; broker must retain GitHub credentials server-side |
| M4 resources | CPU, RAM and PID limits | Limits retained; persistent disk quotas remain absent |
| M5 rate limits | User-Agent fallback removed; no trusted ingress IP boundary | Unchanged; cannot safely fix by trusting arbitrary forwarded headers |
| M7 supply chain | Partial pins/checksums | Remaining action tags, image tags, web image dispatch receiver and signing-job dependencies remain open |
| M8 team flows | No review gate | Administrator approves the exact definition; edits invalidate approval; execution still uses runner credentials |
| M11 runtime dependencies / seed | Development dependencies copied; seed on startup | Unchanged |

The redirect regressions use real Undici redirect processing with MockAgent transport and no external network. An unprotected positive control reaches simulated internal JSON; the protected Umami API/login and custom MCP discovery calls reject both 302 and 307 for both internal destinations. The tests failed before the patch. Existing publicFetch tests separately cover DNS rebinding at connection time. No host compromise was attempted.

ESLint rejects direct fetch in connector/provider modules outside six reviewed transport exceptions: Ahrefs, Meta Ads and Zendesk clients, the fixed model catalog, the provider gateway, and Ollama local discovery. These exceptions reject redirects; remote Ollama uses publicFetch. This lint rule prevents routine regressions, but is not a network sandbox or a proof covering every possible HTTP client.

KB publication authorization and server-side GitHub credentials are implemented in this follow-up. The web image workflow still checks out `client_payload.ref` without independent same-repository/immutable-SHA validation. Repository dispatch requires repository write permission, so this is not the former unauthenticated `/build` injection path. Privileged action tags, especially Apple signing releases, still warrant pinning.

## KB publication and GitHub broker follow-up

P0.1 and P0.2 are implemented together. Submitting changes now creates or advances the workspace owner's proposal; it does not publish to the shared KB. In Curator, **Review publication** shows the BFF-generated diff and full commit ID. Only an administrator can **Approve and publish**. An administrator can review another workspace through its existing workspace access. Each changed file can also be downloaded at the exact reviewed commit, including binary content. Editing the proposal or advancing main invalidates an outstanding approval. Applied review rows are marked published only when their recorded content hash matches the approved Git content.

The broker accepts one ref update per request and no ref deletion, force push, tag, replacement ref, protected ref or other tenant's proposal. Validation checks all commits introduced since main, including intermediate commits: no deleted files, dot paths, protected runtime files, hooks directories, symlinks or submodules. Bounds are 64 MiB request/pack, 8 MiB per changed blob, 32 MiB of distinct changed blob content, 256 changed paths, 128 new commits and 2 MiB review diff. Proposal refs remain readable through the shared read-only KB mount; tenant separation protects writes, not proposal confidentiality. These are structural checks, not a guarantee that prose contains no malicious instructions; the administrator reviews the content.

A filesystem lock in the shared bare repository limits publication/transport mutations to one operation across BFF replicas. Busy operations fail for retry instead of queuing unbounded data. Git processing has a 60-second abort deadline. Git ref transactions compare both the proposal and main OIDs. The `kb.workspace_push` audit contains the authenticated slug, ref, full commit and paths, and is emitted only for an accepted update; an audit failure rolls that proposal ref back using compare-and-swap. Approval intent and successful publication are audited separately. No database migration is required.

GitHub fetch writes only the protected `arche-github` incoming branch. Sync merges it in the workspace, where conflicts remain resolvable; importing those changes into shared main still requires a proposal and review. GitHub export pushes only shared main and never runs inside the workspace. An empty GitHub branch is supported. Divergent GitHub history is not force-pushed: sync, resolve and submit a new proposal. **Export approved KB to GitHub** retries an export independently after local publication. Tokens are never placed in workspace requests/configuration or command arguments; the BFF Git child receives a repository-specific authorization header in its own environment. Provider expiry remains the upper bound if immediate revocation fails.

Rollout: back up the bare KB; deploy web and workspace images together and recreate existing workspaces before reopening publication. Old agents attempting main writes are deliberately rejected. Existing approved main content is preserved, and existing worktree edits remain available to submit. Desktop uses the same proposal/review UX and no GitHub token transport; its vault and agent run as the same OS user, so this is not a filesystem isolation boundary against that local user. Existing Desktop GitHub integration capability remains disabled.

Recovery: the lock fails closed after a process/host crash. Stop all BFF replicas and broker operations, confirm no Git operation is running, then remove only the empty `arche-publication.lock` directory from the bare KB before restarting. Never clear an active lock. Reverting web to the old unrestricted broker reopens the vulnerability: disable publication before an operational rollback. GitHub export and audit/bookkeeping failures after main was committed are reported as follow-up failures, not as a rejected publication.

Verification includes actual Git smart-HTTP push/approval, malformed trees/path traversal, cross-tenant refs, tags, deletion, non-fast-forward, symlink history, submodules, size limits, stale approvals, lock contention, session/Origin/admin authorization, token-free workspace calls, token revocation, Go sync/proposal behavior, and browser review of an actual Git proposal. No live GitHub installation credentials or production deployment are used in these checks.

## Remaining architectural work

- The daemon still runs rootful. Non-root workspace processes do not provide user namespaces or host-level rootless isolation. Moving the daemon and applying persistent-volume disk quotas requires a host migration. Volume ownership changes are intentionally persistent; back up volumes before rollout. The ownership helper has a two-minute deadline; larger volumes may require an operator-managed migration.
- Approved shared flows still execute with the runner's credentials. Approval is a review gate, not a restricted execution sandbox. Administrators must inspect prompts, tools and routing; arbitrary runtime inputs remain untrusted.
- Proxy-aware rate limiting still requires a trusted ingress boundary. Globally trusting forwarded headers while workspaces can reach the BFF would allow spoofing; this branch only removes the rotatable User-Agent fallback from MCP rate limiting.
- Remaining base-image and workflow pins, signed images/SBOM, the one-click Docker installer, runtime development dependencies and startup seed behavior need a separate supply-chain/runtime change. This branch does not claim universal pinning.
- Login Origin checks, timing equalization, patch policy enforcement, exec-process cancellation and race-free filesystem access remain open. Symlink component rejection reduces attachment traversal but is not an atomic filesystem sandbox.
- Existing TypeScript errors in test fixtures remain visible with the general `tsconfig.json`. `tsconfig.build.json` checks production sources strictly; Vitest continues to execute the full test suite.

## Local verification

Validation on 23 October 2026 used Node 24.14.0 and the repository pnpm lockfile:

| Check | Result |
| --- | --- |
| Full suite through `pnpm coverage:refresh` | 6,333 passed; 32 conditional tests skipped |
| PostgreSQL concurrency and approval suites | 8 passed |
| `pnpm test:e2e --retries=0` | 27 passed, including actual KB proposal review and approval; fake upstream runtime and OAuth provider |
| `pnpm lint` | No errors; 19 existing warnings |
| `pnpm coverage:refresh` | Passed; line coverage 92.21% overall, 91.04% unit, 95.14% integration; badges refreshed |
| Workspace agent `go test -race ./...` | Passed with Go 1.27.3, including actual HTTP proxy renewal and credential stripping |
| Desktop unit/build and workspace smoke | 60 unit tests, one startup/authenticated-POST smoke and 3 Electron E2E tests passed without retries |
| `bash scripts/check-podman-images.sh` | Web, OpenCode v1 and v2 images built; runtime and archive smoke checks passed |

The prior #515 validation also covered dependency audit, infrastructure scripts, Ansible syntax, production-image startup and control-network isolation; those unchanged checks are not counted as new local runs above.

CI now runs Go race tests, PostgreSQL approval tests, and Desktop checks for changes to shared runtime code. Production source types pass in the image build. General test-fixture type debt is described above. No live production deployment, secret rotation, external-provider credential test or unrestricted penetration test was performed.
