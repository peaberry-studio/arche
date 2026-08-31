## 1. Rendered env artifacts

- [ ] 1.1 Add `ARCHE_FLOW_SCHEDULER_MODE=daemon` to the generated `.env` template in `renderEnvFile` (`infra/one-click/main.go`), grouped with the session/TTL settings.
- [ ] 1.2 Add the same line to the bootstrap `.env` heredoc in `renderBootstrapScript` so fresh deployments write it to `/opt/arche/.env`.

## 2. Flow daemon runner

- [ ] 2.1 Add a `flows` service to `renderCompose` mirroring the Ansible remote template: `${ARCHE_WEB_IMAGE}` running `./node_modules/.bin/tsx src/flow-daemon.ts`, `env_file: .env`, `restart: unless-stopped`, both networks, the three host mounts (`/opt/arche/users`, `/opt/arche/kb-content`, `/opt/arche/kb-config`), `depends_on` for healthy postgres and docker-socket-proxy, healthcheck disabled.

## 3. Update convergence

- [ ] 3.1 In `renderUpdateScript`, set `ARCHE_FLOW_SCHEDULER_MODE=daemon` via the existing `set_env` helper so existing deployments gain the variable idempotently.
- [ ] 3.2 Recreate `flows` alongside `web` in the update script's compose up call so the runner is created on existing deployments.

## 4. Tests

- [ ] 4.1 Extend `infra/one-click/main_test.go`: `renderEnvFile` output contains `ARCHE_FLOW_SCHEDULER_MODE=daemon`; bootstrap script's env heredoc contains it; update script sets it via `set_env` and brings up `flows` with `web`; rendered compose declares the `flows` service with the daemon command.
- [ ] 4.2 Run `go test ./...` from `infra/one-click/` — green.

## 5. Final verification

- [ ] 5.1 Run `openspec validate archectl-flow-scheduler-mode --strict` — change validates.
- [ ] 5.2 Confirm `bash scripts/check-podman-images.sh` is unaffected (no app image changes; skip per repo guidance for tooling-only changes if it fails for unrelated local reasons).
