## Why

`search_kb` is the only discovery path MCP clients have into the Knowledge Base, and today it is a literal substring scan: `git grep -n -i --fixed-strings -- "<query>"` over a fresh clone. Consequences observed against a real 95-article KB (mixed Spanish/English):

- Multi-word queries only match when the exact phrase appears on one line: `hosting` returns 5 lines, `dónde se aloja la web` returns **0**, although the KB documents the hosting of every project.
- Results are unranked raw lines (up to 50 by default), so agents spend tokens on noise and then read whole articles to find out which one is relevant.
- Vocabulary drift between how a question is asked and how an article is written (synonyms, other language, paraphrase) makes knowledge effectively invisible, so agents lose information that exists.

## What Changes

- Replace the substring scan with a **hybrid ranked search** over heading-level sections of every Markdown article:
  - **Lexical**: BM25 over accent- and case-folded tokens of the article path, heading trail and section text, so multi-word queries match by terms instead of exact phrase.
  - **Semantic**: cosine similarity between a local multilingual embedding model (`Xenova/multilingual-e5-small`, quantized, run in-process via `@huggingface/transformers`) of the query and of each section.
  - **Fusion**: reciprocal rank fusion of both rankings, aggregated to one result per article (its best section).
- **BREAKING** (MCP tool contract): `search_kb` returns at most one match per article, ordered by relevance, each with `path`, `heading`, `line`, a bounded `text` snippet and a `score`. Default `limit` drops from 50 lines to 10 articles (max 50).
- The search index is derived, in-memory state keyed by the content repo `HEAD` commit. It is built lazily on the first search and refreshed on the next search after any commit; embeddings are reused for unchanged sections. Markdown files in the bare repo remain the only source of truth; no write path changes.

## Capabilities

### New Capabilities
- `kb-search`: Behavioral contract for Knowledge Base search exposed to MCP clients — ranked hybrid (lexical + semantic) retrieval, one result per article with a bounded snippet, path scoping, and index freshness against the content repository.

### Modified Capabilities
- (none)

## Impact

- `apps/web/src/lib/mcp/kb-content-store.ts` — `searchKb()` delegates to the search index; `KbSearchMatch` gains `heading` and `score`.
- New `apps/web/src/lib/mcp/kb-search-sections.ts` (Markdown → sections, tokenizer), `kb-search-ranking.ts` (BM25, fusion, per-article aggregation), `kb-search-embeddings.ts` (local model wrapper), `kb-search-index.ts` (HEAD-keyed index lifecycle).
- `apps/web/src/lib/mcp/server.ts` — `search_kb` description reflects ranked results.
- `apps/web/package.json` — new dependency `@huggingface/transformers` (pulls `onnxruntime-node`); `next.config.ts` lists it in `serverExternalPackages`.
- Runtime: the model (~120 MB) downloads from the Hugging Face Hub on the first search into the library's default cache under `node_modules`; the web process needs outbound HTTPS once per fresh `node_modules`. Index memory is roughly 1.5 KB per section (384-dim vectors).
- No DB migration, no Prisma schema change, no compose/Ansible change, no change to KB writes, Knowledge Review or workspace git pushes.
