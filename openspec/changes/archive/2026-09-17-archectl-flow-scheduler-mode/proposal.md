## Why

archectl (one-click) deployments crash at web startup: `getFlowSchedulerMode()` (`apps/web/src/lib/flows/scheduler.ts`) requires `ARCHE_FLOW_SCHEDULER_MODE` in production and throws when it is missing, but archectl never writes that variable — not in the env template (`renderEnvFile`), not in the bootstrap `.env` heredoc (`renderBootstrapScript`), and not in the update script (`renderUpdateScript`). The Ansible deploy path sets it correctly (`infra/deploy/ansible/roles/app/templates/.env.j2:74`: `daemon` for remote deployments), so only the archectl path is broken.

Setting the variable alone is not enough: `daemon` means the web process does **not** tick flows and a dedicated flow-daemon runner is expected (`startFlowDaemon()` exits unless the mode is `daemon`). The Ansible remote topology pairs the variable with a separate `flows` compose service running `tsx src/flow-daemon.ts` on the same web image; archectl's generated compose has no such service, so writing `daemon` without one would leave flows never dispatching.

## What Changes

- `renderEnvFile` (`infra/one-click/main.go`): the generated `.env` template gains `ARCHE_FLOW_SCHEDULER_MODE=daemon`.
- `renderBootstrapScript`: the bootstrap `.env` heredoc written to `/opt/arche/.env` gains the same line, so fresh one-click deployments boot with a valid production configuration.
- `renderUpdateScript`: the update script sets `ARCHE_FLOW_SCHEDULER_MODE=daemon` via the existing idempotent `set_env` helper, so existing deployments converge on their next update.
- `renderCompose`: the generated compose stack gains a `flows` service mirroring the Ansible remote template — same `${ARCHE_WEB_IMAGE}` running `./node_modules/.bin/tsx src/flow-daemon.ts`, same `.env`, networks, host mounts, and health/depends-on posture — so the configured `daemon` mode actually has a runner.
- `renderUpdateScript` also brings `flows` up alongside `web` on updates, so existing deployments get the runner when they converge.
- Go tests cover the variable in all three rendered artifacts and the new compose service.

## Capabilities

### New Capabilities
- `archectl-deployment`: Behavioral contract for the deployment artifacts archectl generates — the generated env file must satisfy every production-required web setting, the compose stack must run a scheduler runner consistent with the configured scheduler mode, and updates must converge existing deployments to the current artifact set.

### Modified Capabilities
- (none — archectl-generated deployment artifacts were previously unspecified.)

## Impact

- `infra/one-click/main.go` — `renderEnvFile`, `renderBootstrapScript`, `renderUpdateScript`, `renderCompose`.
- `infra/one-click/main_test.go` — coverage for the scheduler mode in rendered env/bootstrap/update artifacts and the compose `flows` service.
- No application code changes (the web app already implements the three modes); no DB, env-var-infra, or Ansible changes; `validateTemplates` needs no new vars (the compose service references only existing variables).
- Existing archectl deployments are healed on their next `archectl update` (env var added idempotently, flows service created and started).
