## Context

See `proposal.md` — Why for the startup crash and the daemon/runner pairing.

Current mechanics that shape this design (verified in code):

- `getFlowSchedulerMode()` accepts `daemon` | `inline` | `off` and **throws in production** when the variable is missing or invalid; `registerNodeInstrumentation()` starts the inline scheduler only when the mode is `inline`.
- `startFlowDaemon()` (`apps/web/src/flow-daemon.ts`) exits unless the mode is `daemon`; the one-click Ansible-free path therefore needs both the variable and a runner.
- The Ansible remote template is the reference topology: `.env.j2` writes `daemon` for `deploy_mode == 'remote'`, and `compose.yml.j2` runs dedicated `reaper` and `flows` services using the web image (`./node_modules/.bin/tsx src/<daemon>.ts`), with the same env file, networks, host mounts, `depends_on` on healthy postgres + docker-socket-proxy, and healthchecks disabled.
- archectl always deploys the remote-equivalent topology: web in the compose stack on a fresh VM, sibling workspace containers via docker-socket-proxy, host paths `/opt/arche/{users,kb-content,kb-config}`.
- The production web image (`apps/web/Containerfile`) ships `src/`, `node_modules/`, and `tsconfig.json`, so the `tsx` daemon entrypoint runs in the same image archectl already uses.
- archectl's update path rewrites compose from the rendered template and amends the env file with the idempotent `set_env` helper (delete matching key, append), then recreates only the listed services.

## Goals / Non-Goals

**Goals:**

- Fresh archectl deployments boot with a valid production flow-scheduler configuration and a running flow dispatcher.
- Existing archectl deployments converge to the same state on their next update, without manual env editing.
- The one-click artifacts stay a single source of truth: one rendered compose, one rendered env, validated by `validateTemplates`.

**Non-Goals:**

- Changing the web app's scheduler modes or `getFlowSchedulerMode()` behavior (the throw-on-missing production guard is correct and is what surfaced this bug).
- Adding a `reaper` service to archectl's compose. archectl currently runs no reaper at all (the Ansible remote path does); that is a real but separate parity gap — fixing it here would grow this change into a topology redesign. Tracked as a follow-up.
- Introducing a `deploy_mode` concept or an inline/daemon toggle to archectl; one-click deployments are remote-equivalent, so the value is a constant.
- Making `inline` the archectl value. It would boot, but it runs flow dispatch on the web server process — the exact load the dedicated-runner topology exists to move off the request-serving path.

## Decisions

### D1: Constant `ARCHE_FLOW_SCHEDULER_MODE=daemon` in all three rendered artifacts

- Matches the Ansible remote value for the same topology. `renderEnvFile` is the validated template, the bootstrap heredoc is what actually lands on the VM, and `set_env` in the update script converges existing deployments; all three must agree or a path drifts.
- `set_env` is idempotent (deletes any existing line first), so repeated updates never duplicate the key.

### D2: A `flows` service in the generated compose, mirroring the Ansible remote service

- Same image (`${ARCHE_WEB_IMAGE}`), command `./node_modules/.bin/tsx src/flow-daemon.ts`, `env_file: .env`, both networks, the three host mounts (users, kb-content, kb-config), `depends_on` postgres + docker-socket-proxy healthy, and healthcheck disabled — byte-for-byte the same posture as the Ansible `flows` service so the two deploy paths stay symmetric.
- The daemon needs the host mounts because flow execution reads KB config/content and writes user workspace data, same as web.
- Alternative considered: `inline` with no new service — rejected in Non-Goals; it changes the runtime topology rather than repairing it.

### D3: The update script starts `flows` alongside `web`

- Existing deployments recreate services by name (`docker compose up -d web`), so a service that is never named is never created. The update path names both: `docker compose up -d web flows`.
- Order is safe: compose creates `flows` only after its `depends_on` services are healthy, and the daemon waits for KB config/user paths before ticking.

### D4: No `validateTemplates` extension

- The new service references only `${ARCHE_WEB_IMAGE}`, which the env template already defines; the existing compose-vs-env placeholder validation therefore covers the new service unchanged. Template validation asserts the scheduler variable is present (test-level), since that is the invariant that bit production.

## Risks / Trade-offs

- [Two dispatchers if a user manually sets `inline` later] → The scheduler is lease-guarded (`claimNextDueFlow` takes a lease), so a stray inline tick cannot double-dispatch a run; worst case is duplicate no-op claim attempts.
- [`flows` container restart loops on broken KB mounts] → Same failure mode as web in that scenario; `restart: unless-stopped` plus the bootstrap's pre-created host paths keep this off the happy path.
- [Existing deployments update while a flow run is mid-flight] → `up -d web flows` recreates only `web` (unchanged config) and creates `flows`; compose does not stop the running `web` process unless its config changed, so in-flight runs managed by web's spawner are not torn down by this change.

## Migration Plan

1. Fresh deployments: bootstrap writes the variable and starts the stack including `flows` (`docker compose up -d` already starts all services).
2. Existing deployments: next `archectl update` rewrites compose (now with `flows`), appends the env variable idempotently, pulls images, and recreates `web` + creates `flows`.
3. Rollback: revert the deploy tooling; previously deployed env files keep the variable (harmless — `daemon` with no runner simply means flows pause), and removing the `flows` service on a subsequent update is automatic since compose is fully rewritten each update.

## Open Questions

- (none — the reaper parity gap is recorded as a follow-up, not an open question for this change.)
