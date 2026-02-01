# AGENTS.md

This repository is currently an Obsidian vault (notes), not a software project.
There are no detected build/lint/test toolchains (no `package.json`,
`pyproject.toml`, `go.mod`, `Cargo.toml`, etc.).

If you are an agent operating here, optimize for safe, minimal edits to Markdown
notes and predictable file naming.

## Repo Map

- `README.md`: vault landing page with setup instructions and placeholder list.
- `Outputs/Meetings/`: meeting notes (pattern: `YYYY-MM-DD - <Title>.md`).
- `opencode.json`: OpenCode project configuration (agents, tools, MCP servers, etc.).
- `System Prompts/`: system prompts referenced by `opencode.json` (one file per agent).
- `.obsidian/`: Obsidian app configuration (JSON). Avoid editing unless explicitly requested.
- `Company/Product/docs/`: product documentation/help center (primary source for support).
- `Outputs/Comunicaciones/`: outputs ready to publish (blog/newsletter/Discord/social).

## Agent Workflow (Vault)

- Default to editing existing notes, not reorganizing the vault.
- Prefer adding content over deleting; never bulk-rewrite tone/structure unless asked.
- Keep diffs small and readable (no rewrapping entire paragraphs).
- When creating new notes, link to existing ones with `[[wikilinks]]` where helpful.
- Avoid introducing automation files (`package.json`, config files) unless the user
  explicitly wants to formalize tooling.
- Treat note content as potentially sensitive (meetings, strategy); do not add
  secrets/keys, and redact any accidental credentials.

## Build / Lint / Test Commands

No build/test runner is configured.

If you need lightweight Markdown linting/format checking without adding project
files, you can run ephemeral tooling via `npx` (does not require a committed
`package.json`):

- Lint all Markdown (optional):
  - `npx --yes markdownlint-cli2 "**/*.md"`
- Lint a single file (optional; closest equivalent to "single test"):
  - `npx --yes markdownlint-cli2 "path/to/file.md"`
- Format check all Markdown with Prettier (optional):
  - `npx --yes prettier --check "**/*.md"`
- Format a single file (optional):
  - `npx --yes prettier --write "README.md"`

Notes:

- These commands may download packages at runtime; do not run them in CI unless
  you later formalize tooling (add `package.json`, lockfile, etc.).
- There are no unit/integration tests to run in this vault today.

## Cursor / Copilot Rules

- No Cursor rules found (`.cursor/rules/` and `.cursorrules` are absent).
- No Copilot instructions found (`.github/copilot-instructions.md` is absent).

## Markdown Style Guide (Primary)

### General Principles

- Prefer small, targeted edits; avoid rewrites unless asked.
- Preserve the author voice/language (Spanish content exists); do not translate
  headings or rewrite tone unless requested.
- En contenido en prosa, usar ortografía normal en español (tildes, ñ, etc.). No
  corregir identificadores, comandos, rutas, ni contenido dentro de `backticks` o
  bloques de código.
- Preserve existing structure (headings, ordering, ToC links, and list
  indentation). If you change a heading, update the table of contents.

### Headings, ToC, and Links

- Use ATX headings (`#`, `##`, `###`) with a single space after the hashes.
- Keep a blank line after headings.
- Table of contents links should match the heading text exactly.
- Internal links:
  - Prefer Obsidian wikilinks (`[[Note Name]]`) when linking to another note.
  - Use normal Markdown links for external URLs (`[label](https://...)`).

### Lists

- Use `- ` for unordered lists (match existing meeting notes).
- Indent wrapped list content by two spaces.
- Keep list items concise; use sub-bullets only when they add clarity.

### Code and Version Strings

- Use backticks for:
  - versions (e.g. `26.1.2`)
  - commands (e.g. `npx --yes prettier --check "**/*.md"`)
  - product names or features that read like identifiers.
- Prefer fenced code blocks (```lang) for multi-line snippets.

### Filenames and Note Organization

- Do not rename existing files or folders unless requested.
- For meeting notes, keep the established pattern:
  - `Outputs/Meetings/YYYY-MM-DD - <Title>.md`
- For communications outputs, keep the pattern:
  - `Outputs/Comunicaciones/YYYY-MM-DD - <Canal> - <Nombre semantico>.md`
- Avoid introducing new top-level folders without a clear need.

### Obsidian-Specific Notes

- Avoid editing `.obsidian/` files unless explicitly asked.
- Do not add plugins or settings by default.
- If you add properties/frontmatter, use it consistently and only if the vault
  already uses it (currently it does not).

## If/When Application Code Is Added (Secondary)

If this vault later grows into an actual codebase, follow these defaults until
project-specific conventions exist.

### Formatting

- Keep files auto-formatted via a single tool (prefer Prettier for JS/TS, Black
  for Python, gofmt for Go, rustfmt for Rust).
- Avoid manual alignment/column formatting.

### Imports

- Group imports in this order:
  - standard library
  - third-party
  - internal modules
- Sort alphabetically within each group.
- Avoid deep relative imports when a module alias exists.

### Types

- Prefer explicit types at module boundaries (API inputs/outputs, public
  functions) and inferred types inside implementations.
- Avoid `any`/unsafe casts; narrow types with guards.

### Naming

- Functions/variables: `camelCase`.
- Types/classes: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE` only when truly constant.
- Filenames: prefer `kebab-case` or match existing project conventions.

### Error Handling and Logging

- Fail fast on programmer errors; validate external inputs.
- Return actionable error messages (what failed + where + next step).
- Don't swallow errors; wrap with context and rethrow/return.
- Log at boundaries (CLI entrypoints, request handlers), not deep inside pure
  functions.

### Testing

- Tests should be deterministic, hermetic, and avoid network/time dependence.
- Prefer table-driven tests for multiple similar cases.
- Provide a way to run a single test (framework-specific), and document it here
  once tooling exists.
