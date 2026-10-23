# Security hardening and rollout

This branch addresses the verified security findings against the OpenCode v2 runtime migration. The initial hardening was merged in PR #511 (`fbacc98a`); the architectural follow-up is local on `fix/security-architecture`. Production has not been changed and credentials have not been rotated.

## Implemented protections

- The container socket proxy is pinned by digest and isolated on `arche-control`. Workspaces remain on `arche-internal`; existing blue-green web containers join the control network before the proxy is replaced. The one-click installer generates the same isolation and updates proxy and Traefik alongside the backend.
- Workspace KB mounts are read-only. Git pushes use an authenticated, bounded BFF broker with Git hooks disabled, an audit event, and rejection of deletes and non-fast-forward updates. Workspace Git commands also disable hooks.
- Workspaces run as UID/GID 1000 with no capabilities, `no-new-privileges`, a read-only root filesystem and bounded private tmpfs mounts. Persistent volumes are migrated before startup by a temporary root helper with no network, credentials or KB mount. Migration refuses volumes mounted by running containers, preserves file contents, avoids following symlinks and removes special permission bits. A failed migration prevents startup. The legacy archive helper remains root with only `DAC_OVERRIDE`, read-only source mounts and bounded disposable storage.
- User-configurable remote connector requests require public HTTPS destinations, reject redirects and validate DNS answers at socket connection time. This includes Umami login/API requests and remote tool discovery. Linear and Notion MCP URLs come from their canonical server configuration. Outbound MCP and provider headers exclude browser credentials. The loopback OAuth fixture is available only with explicit E2E hooks outside production.
- Connector gateway credentials expire after five minutes and are scoped to the connector, workspace and current instance credentials. A workspace-agent proxy obtains a fresh credential before each request in both web and Desktop; generated config contains only a connector-specific local capability. Stop, restart, disable and deletion are checked before new upstream requests. Existing streams may continue until their five-minute deadline. Legacy permanent tokens are rejected.
- Shared flows require an administrator to approve the exact definition before another user can run them. Definition changes invalidate approval; the runner checks permission again before starting a workspace or accessing its credentials. Approval uses conditional database updates to reject concurrent edits and records an audit event. Owners retain access to their own flows.
- OAuth state is bound to the initiating session and consumed atomically before exchange. Administrators cannot complete another user's authorization. Manual connector secrets are redacted from responses and preserved when omitted from edits.
- GitHub KB installation tokens are restricted to the configured repository and contents write permission. The token is still delivered to the workspace for the existing sync protocol.
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

The external review examined `f1490272`, before architecture commit `f2897319`. PR #511 is merged; the architectural work and the following SSRF correction remain local. Merge status does not establish what is deployed.

| Finding | Merged #511 | Local architecture plus this review correction |
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

Prioritize KB publication authorization and server-side GitHub credentials next. The web image workflow still checks out `client_payload.ref` without independent same-repository/immutable-SHA validation. Repository dispatch requires repository write permission, so this is not the former unauthenticated `/build` injection path. Privileged action tags, especially Apple signing releases, still warrant pinning.

## Remaining architectural work

- Bind KB writes to approved changes and permitted refs/paths; current Git receive-pack accepts fast-forward writes without review authorization. Keep GitHub installation tokens out of workspace processes.
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
| `pnpm test` | 6,288 passed; 32 conditional tests skipped |
| PostgreSQL concurrency and approval suites | 8 passed; upgrade from the previous branch preserved a seeded legacy Slack row and added only the nullable approval column |
| `pnpm test:e2e --retries=0` | 26 passed; fake upstream runtime and OAuth provider |
| `pnpm lint` | No errors; 19 existing warnings |
| `pnpm audit --prod` | No reported vulnerabilities |
| `pnpm coverage:refresh` | Passed; line coverage 92.23% overall, 90.98% unit, 95.17% integration; badges refreshed |
| Workspace agent `go test -race ./...` | Passed with Go 1.27.3, including actual HTTP proxy renewal and credential stripping |
| Desktop unit/build and workspace smoke | 60 unit tests, one startup/authenticated-POST smoke and 3 Electron E2E tests passed without retries |
| Script, workflow and runtime infrastructure tests | 39 passed |
| Pinned Ansible installation and playbook syntax | Passed; syntax validation without a deployment inventory |
| `bash scripts/check-podman-images.sh` | Web, OpenCode v1 and v2 images built; runtime and archive smoke checks passed |
| Production web image startup | Health endpoint returned database healthy; KB broker rejected unauthenticated access |
| Control network isolation | Workspace could not reach the mock control service, including by IP; control client could |

CI now runs Go race tests, PostgreSQL approval tests, and Desktop checks for changes to shared runtime code. Production source types pass in the image build. General test-fixture type debt is described above. No live production deployment, secret rotation, external-provider credential test or unrestricted penetration test was performed.
