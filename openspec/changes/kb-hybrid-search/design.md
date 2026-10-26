## Context

`searchKb()` (`apps/web/src/lib/mcp/kb-content-store.ts`) clones the content bare repo to a temp dir on every call and runs `git grep --fixed-strings`. The KB changes through two independent paths — Knowledge Review approvals (`mutateBareRepo`) and workspace `git push` through `kb-http-backend.ts` — so any derived index must detect change without hooks into either. The web app runs on PostgreSQL (server) and SQLite (desktop), so index storage tied to one database would need two implementations. Target KB size today: ~100 articles, ~320 KB, ~700 sections.

## Goals / Non-Goals

**Goals:**
- Queries find articles by meaning and by terms, not only by exact phrase, across Spanish and English.
- Results are compact and ranked so an agent can pick the article to read without reading candidates.
- No change to how the KB is stored or written; the index is disposable.

**Non-Goals:**
- Persisting the index across process restarts (rebuild cost is acceptable at current size).
- A vector database, pgvector, or sqlite-vec.
- Searching non-Markdown files, skills, or agent definitions.
- Remote embedding providers or API keys.

## Decisions

### D1. Section-level documents
Articles are split at ATX headings `#`–`###` outside fenced code blocks (a fence closes only on the same character, at least as long as its opener). Each section carries its heading trail (`Title › Section`) and 1-based start line. Sections longer than 500 characters split further at line boundaries (a single longer line stays whole), so each piece fits the embedding model's 128-token window; empty sections are dropped. Sections are the unit of ranking because whole articles dilute both BM25 and embeddings, and lines lack context.

### D2. Lexical ranking: BM25 over folded tokens
Tokens are NFKD-normalized, stripped of combining marks, lower-cased and split on non-letter/digit runs; tokens shorter than 2 characters and a short list of Spanish/English function words (`de`, `la`, `the`, `where`…) are dropped: on the real KB, `de` alone made `receta de paella` match every article. The indexed text is article path + heading trail + section text, so path and heading terms always count. BM25 with k1 = 1.2, b = 0.75. No stemming.

### D3. Semantic ranking: local paraphrase-multilingual-MiniLM-L12-v2
`Xenova/paraphrase-multilingual-MiniLM-L12-v2` (384 dims, quantized `q8`, ~120 MB, 128-token window) through `@huggingface/transformers` `feature-extraction` with mean pooling and L2 normalization, so cosine similarity is a dot product. The model revision is pinned: the four files the q8 pipeline reads are fetched from that revision into `node_modules/.cache/arche-kb-search-model`, verified against pinned SHA-256 digests (the large files match Hugging Face's `x-linked-etag`), and loaded with remote access and the library cache disabled. Version 4.3.1's tokenizer loader otherwise probes `tokenizer_config.json` on the unpinned `main` branch on every load, so a cached model still needed the network.

The model runs in a child process of the web server (`src/kb-search-embedder.ts`, forked through `tsx` like the flow and reaper daemons, structured-clone IPC), started on the first embedding request and stopped after 10 minutes without requests. Measured on the home deployment (Linux x64, 2 vCPU), loading the model adds ~500 MB of resident memory (~160 MB tokenizer heap for the 250k-token vocabulary, ~300 MB ONNX Runtime) that a process does not return to the OS: disposing the pipeline left RSS unchanged, and graph optimization level, memory arena and batch size each changed it by under 10%. A child that exits is the only way to give it back, so an idle web process stays at its baseline. The web server never imports the library, so a platform without an `onnxruntime-node` binding fails only the search (D6). The child loads the pipeline once, retries a failed load on the next request, and serves requests one at a time because inference already uses every core.

Measured on KB-like Spanish/English passages (five passages, four relevant queries and one unrelated query):

| Model | Relevant queries ranked first | Relevant similarity | Unrelated query max |
|---|---|---|---|
| multilingual-e5-small | 3 / 4 | 0.81–0.84 | 0.80 |
| multilingual-e5-base | 2 / 4 | 0.79–0.84 | 0.76 |
| paraphrase-multilingual-MiniLM-L12-v2 | 4 / 4 | 0.41–0.59 | 0.14 |

E5 similarities are compressed into a narrow band where unrelated text scores like relevant text, so no fixed threshold separates them. MiniLM separates them, which allows a minimum similarity (D4). Chosen over a remote API so KB text never leaves the deployment and no credential is required; over larger models (bge-m3, 2.2 GB) because the home deployment has 2 vCPU / 5 GB RAM.

### D4. Fusion and aggregation
Reciprocal rank fusion (`1 / (60 + rank)`) over the BM25 ranking (sections with score > 0) and the semantic ranking (top 50 sections with cosine similarity ≥ 0.4). RRF needs no score calibration between the two scales. Results aggregate to one match per article (its best section); article score = best section score. Snippet = section text with whitespace collapsed, truncated to 280 characters.

The minimum similarity keeps unrelated sections out, so a query with nothing relevant returns few or no matches instead of the nearest neighbours; this saves agent tokens. Calibrated on the real KB (95 articles, 892 sections): unrelated queries (`receta de paella`, `precio del bitcoin`, `horario del gimnasio`, `mejores películas de 2024`) peak at 0.36, while the best section for relevant queries scores 0.40–0.73.

### D5. Index lifecycle keyed by HEAD
Module-level state `{ headHash, sections, lexical stats, vectors }`. Each search runs `git rev-parse HEAD` on the bare repo (no clone). Same hash → reuse. Different hash → clone once, read all Markdown files, rebuild sections and BM25 stats, and embed only sections whose passage hash (SHA-256) is not in the previous vector map. The first build of a process takes that map from a vector cache file (`$ARCHE_KB_SEARCH_CACHE_DIR/vectors.json`, default under the OS temp dir; the Ansible deploy mounts `/opt/arche/data/kb-search`), and every build that embedded something rewrites it atomically with the current sections' vectors (~1.9 MB for 892 sections). The file records the model and revision; a file for another model, unreadable JSON or a vector of the wrong size is a cache miss. A restart therefore costs one model load (~3 s) instead of re-embedding the whole KB (~70 s of both vCPUs). Concurrent searches for the same hash await one shared build promise. An empty repository (no `HEAD`) yields an empty index. This captures both write paths without coupling to either, and costs one cheap git call per search instead of the current clone per search.

### D6. Failure handling
Index build failures (clone, read, model load or inference) return `{ ok: false, error: 'search_failed' }` from `searchKb` and leave the previous index intact for the next attempt. There is no lexical-only fallback: one canonical search behavior, explicit failure.

### D7. Contract shape
`KbSearchMatch = { path, heading, line, text, score }`, ordered by descending score. `limit` default 10, clamped to 1–50. Queries are trimmed and rejected as `invalid_query` when empty or longer than 1,000 characters, because tokenizing and embedding run on the request thread. `path` keeps its meaning (restrict to a folder) and is applied before fusion.

## Risks / Trade-offs

- [First search embeds the whole KB] → only once per cache directory (D5); afterwards each process start loads the model and later commits embed only changed sections.
- [Model download] → the web image build prefetches and verifies the pinned model files into the image and drops the `onnxruntime-node` binaries for other platforms and `onnxruntime-web` (unused by the Node build), so image builds need Hugging Face Hub access and runtime needs none.
- [Idle stop] → the first search after 10 idle minutes reloads the model (~3 s on the home deployment).
- [128-token window] → sections are capped at 500 characters (D1); text beyond the window of a single long line is only reachable lexically.
- [Platform binaries] → `onnxruntime-node` ships CPU binaries for linux x64/arm64, darwin arm64 and win32; Intel macOS desktop builds are not supported by the package.
- [Process memory] → ~500 MB for the embedder child while it runs, none when idle; the web process keeps ~1.5 KB per section.
- [Native dependency `onnxruntime-node`] → web image is `bookworm-slim` (glibc), supported; only the embedder child loads it, outside the Next bundle.
- [Desktop] → the packaged desktop app ships no `src/` or `tsx`, so search returns `search_failed` there; the desktop app is unused.
- [BREAKING tool output] → MCP clients that parsed line-level matches get article-level matches; field names `path`, `line`, `text` are kept.
