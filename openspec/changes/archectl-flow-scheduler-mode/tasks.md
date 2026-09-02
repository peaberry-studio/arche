## 1. Rendered env artifacts

- [x] 1.1 Add `ARCHE_FLOW_SCHEDULER_MODE=daemon` to the generated `.env` template in `renderEnvFile` (`infra/one-click/main.go`), grouped with the session/TTL settings.
- [x] 1.2 Add the same line to the bootstrap `.env` heredoc in `renderBootstrapScript` so fresh deployments write it to `/opt/arche/.env`.

## 2. Flow daemon runner

- [x] 2.1 Add a `flows` service to `renderCompose` mirroring the Ansible remote template: `${ARCHE_WEB_IMAGE}` running `./node_modules/.bin/tsx src/flow-daemon.ts`, `env_file: .env`, `restart: unless-stopped`, both networks, the three host mounts (`/opt/arche/users`, `/opt/arche/kb-content`, `/opt/arche/kb-config`), `depends_on` for healthy postgres and docker-socket-proxy, healthcheck disabled.
- [x] 2.2 Add a `reaper` service to `renderCompose` mirroring the Ansible remote template: `${ARCHE_WEB_IMAGE}` running `./node_modules/.bin/tsx src/reaper-daemon.ts`, `env_file: .env`, `restart: "on-failure:5"`, both networks, no volumes (it only reconciles database state with container lifecycle), `depends_on` for healthy postgres and docker-socket-proxy, healthcheck disabled. Without it, `reapStaleRuns` (message-run lock reaping) has no caller on one-click deployments.

## 3. Update convergence

- [x] 3.1 In `renderUpdateScript`, set `ARCHE_FLOW_SCHEDULER_MODE=daemon` via the existing `set_env` helper so existing deployments gain the variable idempotently.
- [x] 3.2 Recreate `flows` alongside `web` in the update script's compose up call so the runner is created on existing deployments.
- [x] 3.3 Recreate `reaper` alongside `web` and `flows` in the update script's compose up call.

## 4. Tests

- [x] 4.1 Extend `infra/one-click/main_test.go`: `renderEnvFile` output contains `ARCHE_FLOW_SCHEDULER_MODE=daemon`; bootstrap script's env heredoc contains it; update script sets it via `set_env` and brings up `flows` with `web`; rendered compose declares the `flows` service with the daemon command.
- [x] 4.2 Run `go test ./...` from `infra/one-click/` — green.

## 5. Final verification

- [x] 5.1 Run `openspec validate archectl-flow-scheduler-mode --strict` — change validates.
- [ ] 5.2 Confirm `bash scripts/check-podman-images.sh` is unaffected (no app image changes; skip per repo guidance for tooling-only changes if it fails for unrelated local reasons).
