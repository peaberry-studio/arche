## 1. Lexical ranked search (level 1)

- [x] 1.1 Add `apps/web/src/lib/mcp/kb-search-sections.ts`: `splitArticleIntoSections(path, content)` (design D1) and `tokenize(text)` (design D2). Verify with `__tests__/kb-search-sections.test.ts`: heading trail and start lines, fenced code headings ignored, long sections split at line boundaries, empty sections dropped, accent/case folding.
- [x] 1.2 Add `apps/web/src/lib/mcp/kb-search-ranking.ts`: BM25 ranking over sections and per-article aggregation with 280-char snippets (design D2, D4). Verify with `__tests__/kb-search-ranking.test.ts`: non-contiguous terms match, path/heading terms count, one match per article with best section, ordering by score.
- [x] 1.3 Add `apps/web/src/lib/mcp/kb-search-index.ts`: HEAD-keyed lazy index with coalesced builds (design D5) and `searchKbIndex()`; wire `searchKb()` in `kb-content-store.ts` to it with limit default 10 / max 50 and path scoping (design D7). Replace `__tests__/kb-content-store-search.test.ts` cases: ranked article matches, path scoping, limit clamping, unchanged HEAD reuses the index, new HEAD rebuilds, empty repo returns no matches, build failure returns `search_failed` and retries.
- [x] 1.4 Update the `search_kb` description in `server.ts`.

## 2. Semantic ranking and fusion (level 2)

- [x] 2.1 Add `@huggingface/transformers` to `apps/web/package.json` and `serverExternalPackages` in `next.config.ts`.
- [x] 2.2 Add `apps/web/src/lib/mcp/kb-search-embeddings.ts`: shared lazy `feature-extraction` pipeline for `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (`q8`), batched `embedPassages(texts)` / `embedQuery(text)` with mean pooling and normalization (design D3). Verify with a unit test mocking the pipeline: options, batching, single model load across calls, load failure propagates and is retried.
- [x] 2.3 Extend the index to store section vectors keyed by section text, embedding only new sections on rebuild; extend ranking with cosine ranking and reciprocal rank fusion (design D4, D5). Verify: fused ranking surfaces a semantically similar section with no shared terms, unchanged sections are not re-embedded after a new commit, model failure yields `search_failed`.

## 3. Verification

- [x] 3.1 `pnpm test` and `pnpm lint` from `apps/web/` are green.
- [x] 3.2 Evaluate against a copy of the real KB: a query set covering exact terms, multi-word, paraphrase, cross-language and scoped queries, comparing old and new results.
- [x] 3.3 `bash scripts/check-podman-images.sh` builds the images.
- [x] 3.4 `openspec validate kb-hybrid-search --strict` passes.
