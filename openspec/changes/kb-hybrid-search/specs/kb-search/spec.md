## Purpose

Defines how MCP clients search the Knowledge Base: ranked hybrid retrieval that matches by terms and by meaning, returns one compact match per article, honours path scoping, and stays consistent with the content repository without changing how the Knowledge Base is stored or written.

## ADDED Requirements

### Requirement: Search ranks articles by terms and meaning
`search_kb` SHALL rank Knowledge Base Markdown articles by combining a lexical ranking over query terms with a semantic ranking over query meaning. Matching SHALL be case- and accent-insensitive and SHALL NOT require the query to appear as a contiguous phrase.

#### Scenario: Multi-word query whose words are not contiguous
- **WHEN** a client searches `hosting vercel` and an article contains both words in different lines
- **THEN** that article is returned

#### Scenario: Paraphrased query with no shared words
- **WHEN** a client searches `dónde se aloja la web` and an article describes the site hosting using the word `hosting`
- **THEN** that article is returned among the results

#### Scenario: Runtime without the embedding model
- **WHEN** a client searches on the desktop runtime, which ships no embedding model
- **THEN** articles are ranked by query terms only, with the same result shape
- **AND** the embedding model is never loaded

#### Scenario: Accent and case folding
- **WHEN** a client searches `indice de proyectos`
- **THEN** an article titled `Índice de proyectos` is returned

### Requirement: Results are one compact match per article
`search_kb` SHALL return at most one match per article, ordered by descending relevance. Each match SHALL contain the article path, the heading trail of its best-matching section, the 1-based start line of that section, a snippet of that section of at most 280 characters, and a numeric score.

#### Scenario: Several sections of one article match
- **WHEN** two sections of the same article match a query
- **THEN** the result contains a single match for that article, describing its best-matching section

#### Scenario: Default and maximum limit
- **WHEN** a client searches without a limit
- **THEN** at most 10 matches are returned
- **AND WHEN** a client requests a limit above 50
- **THEN** at most 50 matches are returned

### Requirement: Path scoping
When `path` is provided, `search_kb` SHALL only return articles located under that folder. Invalid paths SHALL be rejected with `invalid_path`.

#### Scenario: Scoped search
- **WHEN** a client searches with `path: "Proyectos/Arche"`
- **THEN** every returned match has a path starting with `Proyectos/Arche/`

### Requirement: Search reflects the current content repository
Search results SHALL reflect the content repository's current `HEAD` commit at the time of the search, including changes made through Knowledge Review and through workspace git pushes. The search index SHALL be derived state only; Markdown files in the content repository remain the source of truth.

#### Scenario: Article added after a previous search
- **WHEN** an article is committed to the content repository after a previous search
- **THEN** the next search can return that article

#### Scenario: Unchanged repository
- **WHEN** two searches run against the same `HEAD` commit
- **THEN** the second search does not re-read the repository or recompute embeddings

#### Scenario: Empty repository
- **WHEN** the content repository has no commits
- **THEN** search returns an empty result set

### Requirement: Search failures are explicit
If the search index cannot be built on a runtime that ships the embedding model (repository unreadable, embedding model unavailable, or inference error), `search_kb` SHALL return an error result instead of partial or lexical-only results, and the next search SHALL retry the build.

#### Scenario: Embedding model fails to load
- **WHEN** the embedding model cannot be loaded during a search
- **THEN** the search returns `{ ok: false, error: "search_failed" }`
- **AND** a later search attempts the build again
