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
Articles are split at ATX headings `#`–`###` outside fenced code blocks. Each section carries its heading trail (`Title › Section`) and 1-based start line. Sections longer than 500 characters split further at line boundaries (a single longer line stays whole), so each piece fits the embedding model's 128-token window; empty sections are dropped. Sections are the unit of ranking because whole articles dilute both BM25 and embeddings, and lines lack context.

### D2. Lexical ranking: BM25 over folded tokens
Tokens are NFKD-normalized, stripped of combining marks, lower-cased and split on non-letter/digit runs; tokens shorter than 2 characters are dropped. The indexed text is article path + heading trail + section text, so path and heading terms always count. BM25 with k1 = 1.2, b = 0.75. No stop-word lists or stemming: IDF already discounts common words and the KB is bilingual.

### D3. Semantic ranking: local paraphrase-multilingual-MiniLM-L12-v2
`Xenova/paraphrase-multilingual-MiniLM-L12-v2` (384 dims, quantized `q8`, ~120 MB, 128-token window) through `@huggingface/transformers` `feature-extraction` with mean pooling and L2 normalization, so cosine similarity is a dot product. The pipeline loads once per process and is shared; a failed load is retried on the next call.

Measured on KB-like Spanish/English passages (five passages, four relevant queries and one unrelated query):

| Model | Relevant queries ranked first | Relevant similarity | Unrelated query max |
|---|---|---|---|
| multilingual-e5-small | 3 / 4 | 0.81–0.84 | 0.80 |
| multilingual-e5-base | 2 / 4 | 0.79–0.84 | 0.76 |
| paraphrase-multilingual-MiniLM-L12-v2 | 4 / 4 | 0.41–0.59 | 0.14 |

E5 similarities are compressed into a narrow band where unrelated text scores like relevant text, so no fixed threshold separates them. MiniLM separates them, which allows a minimum similarity (D4). Chosen over a remote API so KB text never leaves the deployment and no credential is required; over larger models (bge-m3, 2.2 GB) because the home deployment has 2 vCPU / 5 GB RAM.

### D4. Fusion and aggregation
Reciprocal rank fusion (`1 / (60 + rank)`) over the BM25 ranking (sections with score > 0) and the semantic ranking (top 50 sections with cosine similarity ≥ 0.3). RRF needs no score calibration between the two scales. Results aggregate to one match per article (its best section); article score = best section score. Snippet = section text with whitespace collapsed, truncated to 280 characters.

The minimum similarity keeps unrelated sections out, so a query with nothing relevant returns few or no matches instead of the nearest neighbours; this saves agent tokens. The threshold is calibrated against the real KB (task 3.2).

### D5. Index lifecycle keyed by HEAD
Module-level state `{ headHash, sections, lexical stats, vectors }`. Each search runs `git rev-parse HEAD` on the bare repo (no clone). Same hash → reuse. Different hash → clone once, read all Markdown files, rebuild sections and BM25 stats, and embed only sections whose text hash is not in the previous vector map. Concurrent searches for the same hash await one shared build promise. An empty repository (no `HEAD`) yields an empty index. This captures both write paths without coupling to either, and costs one cheap git call per search instead of the current clone per search.

### D6. Failure handling
Index build failures (clone, read, model load or inference) return `{ ok: false, error: 'search_failed' }` from `searchKb` and leave the previous index intact for the next attempt. There is no lexical-only fallback: one canonical search behavior, explicit failure.

### D7. Contract shape
`KbSearchMatch = { path, heading, line, text, score }`, ordered by descending score. `limit` default 10, clamped to 1–50. `path` keeps its meaning (restrict to a folder) and is applied before fusion.

## Risks / Trade-offs

- [First search downloads the model and embeds the whole KB] → ~120 MB once per fresh `node_modules`, then the whole KB is embedded once per process; subsequent commits only embed changed sections.
- [128-token window] → sections are capped at 500 characters (D1); text beyond the window of a single long line is only reachable lexically.
- [Platform binaries] → `onnxruntime-node` ships CPU binaries for linux x64/arm64, darwin arm64 and win32; Intel macOS desktop builds are not supported by the package.
- [Process memory] → model ~250 MB resident plus ~1.5 KB per section; acceptable on the 5 GB home VM.
- [Native dependency `onnxruntime-node`] → web image is `bookworm-slim` (glibc), supported; listed in `serverExternalPackages` so Next does not bundle it.
- [BREAKING tool output] → MCP clients that parsed line-level matches get article-level matches; field names `path`, `line`, `text` are kept.
