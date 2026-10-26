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

## 4. Review follow-up fixes

- [x] 4.1 Import `@huggingface/transformers` lazily in `kb-search-embeddings.ts`: the library loads `onnxruntime-node`'s native binding on import and the package ships no `darwin/x64` binary, so a static import broke every `/api/mcp` tool on Intel macOS desktop builds. Verify with a test where the library import fails: importing the module succeeds and the embedding call rejects (design D6).
- [x] 4.2 Pin the model `revision` so a fresh download keeps the weights the 0.4 threshold was calibrated on (design D3).
- [x] 4.3 Only publish a finished build as the current index while it is still the latest pending build, so an older HEAD finishing last cannot replace a newer index (design D5); log article-loading failures with their error.
- [x] 4.4 Close fenced code blocks only on the same character with at least the opening length, and keep a trailing `#` that is part of the heading text (design D1). Add a sibling-folder path scoping test.
- [x] 4.5 Reject queries longer than 1,000 characters as `invalid_query` (security audit: unbounded input is tokenized and embedded on the request thread) (design D7).
- [x] 4.6 Follow CommonMark fences (no info string on a closing fence, no backticks in a backtick opener's info string, at most 3 spaces of indentation) and truncate snippets by code point so an emoji is never split (code review on PR #521).

## 5. Resource optimization

- [x] 5.1 Profile the model on the home deployment: RSS, CPU and image size per phase; graph optimization level, memory arena, batch size and pipeline disposal (design D3).
- [x] 5.2 Run the model in a child process (`src/kb-search-embedder.ts`) forked through `tsx`, stopped after 10 idle minutes; reject pending requests when it exits or fails to start (design D3, D6). Verify with `src/kb-search-embedder.test.ts` and `__tests__/kb-search-embeddings.test.ts`.
- [x] 5.3 Persist section vectors keyed by passage hash and model revision; read them on a process's first build and rewrite them after embedding (design D5). Verify with `__tests__/kb-search-vector-cache.test.ts` and `__tests__/kb-search-index.test.ts`.
- [x] 5.4 Fetch the four pinned model files verified by SHA-256 and load them with remote access disabled; bake them into the web image, drop other platforms' `onnxruntime-node` binaries and `onnxruntime-web`, and mount the vector cache directory in the Ansible deploy.
- [x] 5.5 Trim the model vocabulary to Spanish and English with `scripts/trim-kb-search-model.py`, publish it at a pinned Hugging Face revision and switch the pinned files to it; check memory, embedding drift and the evaluation queries against the original model (design D3).
