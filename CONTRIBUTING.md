# Contributing to Arche

Thanks for your interest in contributing to Arche.

This project is moving to open source, and we welcome bug fixes, docs updates, tests, and new features that align with the product direction.

## Ways to Contribute

- Report bugs and usability issues
- Propose improvements or new features
- Improve docs and onboarding
- Submit code changes with tests

## Before You Start

1. Read `README.md` for architecture and local setup.
2. Read `AGENTS.md` for project conventions and safety rules.
3. Search existing issues/PRs to avoid duplicate work.

## Local Development

From `infra/deploy/`:

```bash
./deploy.sh --local-dev
```

App URL: `http://arche.lvh.me:8080`

## Coding Standards

- Use TypeScript strict mode patterns (avoid `any` and unsafe casts)
- Keep changes minimal and scoped to the request
- Use `@/` imports for internal modules in `apps/web`
- Prefer deterministic tests

## Required Checks

Run these from `apps/web/` before opening a PR:

```bash
pnpm test
pnpm lint
```

If your change affects build behavior, also run:

```bash
pnpm build
```

## Commits

Use Conventional Commits:

```text
<type>(<scope>): <short description>
```

Examples:

- `feat(web): add workspace sync status pill`
- `fix(spawner): handle missing container on status refresh`
- `docs: clarify local deployment steps`

## Pull Requests

Please include:

- What changed and why
- Screenshots for UI changes (if applicable)
- Risk notes and rollback plan (for infra/runtime changes)
- Validation evidence (tests/lint/build output)

PRs should be focused and avoid unrelated refactors.

## Security

- Do not commit secrets (`.env`, API keys, tokens, credentials)
- If you find a security issue, do not open a public issue with exploit details. Contact maintainers privately.

## Questions

If anything is unclear, open a discussion or issue and we will help you get started.
