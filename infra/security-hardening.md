# Security hardening and rollout

This branch addresses the verified security findings against the OpenCode v2 runtime migration. It is a local change set; production has not been changed and credentials have not been rotated.

## Implemented protections

- The container socket proxy is pinned by digest and isolated on `arche-control`. Workspaces remain on `arche-internal`; existing blue-green web containers join the control network before the proxy is replaced. The one-click installer generates the same isolation and updates proxy and Traefik alongside the backend.
- Workspace KB mounts are read-only. Git pushes use an authenticated, bounded BFF broker with Git hooks disabled, an audit event, and rejection of deletes and non-fast-forward updates. Workspace Git commands also disable hooks.
- Workspaces have memory, CPU and process limits, `no-new-privileges`, and all capabilities dropped except `DAC_OVERRIDE`. This exception retains access to existing root-owned volumes and the current image layout. Workspaces still run as root.
- Connector requests require public HTTPS destinations, reject redirects and validate DNS answers at socket connection time. Linear and Notion MCP URLs come from their canonical server configuration. Outbound MCP and provider headers exclude browser credentials. The loopback OAuth fixture is available only with explicit E2E hooks outside production.
- OAuth state is bound to the initiating session and consumed atomically before exchange. Administrators cannot complete another user's authorization. Manual connector secrets are redacted from responses and preserved when omitted from edits.
- GitHub KB installation tokens are restricted to the configured repository and contents write permission. The token is still delivered to the workspace for the existing sync protocol.
- `/build` checks repository permissions and rejects forks, then dispatches an immutable commit through the GitHub API. The image workflow independently validates the source. Repository dispatch is already authenticated by GitHub and requires [contents write permission](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event); it must not treat the Actions bot as a human collaborator. Changed privileged workflows use pinned action commits.
- SSH host verification is enabled. Ansible dependencies are pinned with Python package hashes; Galaxy collections have exact versions. Both the shell deployer and the one-click installer parse `.env` assignments as data. Binary installers require checksums.
- Next.js, image and SVG handling, editor dependencies and vulnerable transitive dependencies are upgraded. CI audits production dependencies. The editor retains blank paragraphs, display math and Vega blocks after the Tiptap upgrade.

## Deployment prerequisites

1. Configure the GitHub Actions secret `VPS_KNOWN_HOSTS` with independently verified host keys. Local operators must provision their own `known_hosts`. The deploy workflow deliberately fails if the secret is absent.
2. Stop old workspace containers before rollout and recreate them with the new image and container settings, preserving their data volumes. A process restart does not change existing mounts, networks or capabilities. Inspect the shared bare KB configuration and hooks before enabling the broker if previously untrusted workspaces had write access.
3. Deploy the web and workspace images together. The new workspace uses `ARCHE_KB_PUSH_URL` supplied by the spawner; the new web provides that endpoint. Verify a KB fetch and publish after recreation. Broker pushes are limited to 64 MiB and 60 seconds.
4. Verify the socket proxy has only the control network, and no workspace is connected to that network. `node scripts/check-workspace-isolation.mjs` exercises the isolation topology locally with a mock control service.
5. The shell installer now requires release checksum sidecars. Publish a release through the updated release workflow before using the updated installer against it. Historical releases lacking checksums fail closed.
6. If prior tenants were untrusted, investigate exposure and rotate credentials through an explicit operational migration. Encryption-key rotation requires re-encrypting stored credentials; changing the environment value alone would lose access to them.

The existing production deployment is not hardened until these steps are applied. The local checks do not replace validation on the target host.

## Remaining architectural work

- Connector gateway tokens remain long-lived. Expiry requires credential refresh for both web workspaces and desktop; adding a deadline alone breaks running sessions. Deleting or disabling a connector revokes gateway access through the existing connector lookup.
- Rootless execution, user namespaces, a read-only root filesystem and disk quotas require a volume ownership and runtime compatibility migration. The retained `DAC_OVERRIDE` capability is narrower than the previous defaults but is not a rootless boundary.
- Team flows still execute with the runner's credentials. Approval or restricted execution requires a product permission model. Treat shared flows as executable instructions.
- Proxy-aware rate limiting still requires a trusted ingress boundary. Globally trusting forwarded headers while workspaces can reach the BFF would allow spoofing; this branch only removes the rotatable User-Agent fallback from MCP rate limiting.
- Remaining base-image and workflow pins, signed images/SBOM, the one-click Docker installer, runtime development dependencies and startup seed behavior need a separate supply-chain/runtime change. This branch does not claim universal pinning.
- Login Origin checks, timing equalization, patch policy enforcement, exec-process cancellation and race-free filesystem access remain open. Symlink component rejection reduces attachment traversal but is not an atomic filesystem sandbox.
- Existing TypeScript errors in test fixtures remain visible with the general `tsconfig.json`. `tsconfig.build.json` checks production sources strictly; Vitest continues to execute the full test suite.

## Local verification

Validation on 23 October 2026 used Node 24.14.0 and the repository pnpm lockfile:

| Check | Result |
| --- | --- |
| `pnpm test` | 6,249 passed; 30 conditional tests skipped |
| PostgreSQL concurrency suites | 6 passed against an isolated temporary database |
| `pnpm test:e2e --retries=0` | 26 passed; fake upstream runtime and OAuth provider |
| `pnpm lint` | No errors; 19 existing warnings |
| `pnpm audit --prod` | No reported vulnerabilities |
| Workspace agent and one-click `go test ./...` | Passed |
| Script, workflow and runtime infrastructure tests | 39 passed |
| Pinned Ansible installation and playbook syntax | Passed; syntax validation without a deployment inventory |
| `bash scripts/check-podman-images.sh` | Web, OpenCode v1 and v2 images built; runtime and archive smoke checks passed |
| Production web image startup | Health endpoint returned database healthy; KB broker rejected unauthenticated access |
| Control network isolation | Workspace could not reach the mock control service, including by IP; control client could |

Production source types pass in the image build. General test-fixture type debt is described above. No live production deployment, secret rotation, external-provider credential test or unrestricted penetration test was performed.
