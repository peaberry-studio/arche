## Context

See `proposal.md` — Why for the three divergent constructions and the malformed-header risk.

Current mechanics that shape this design (verified in code):

- `workspace-attachments.ts` already owns attachment naming concerns for the files API: `sanitizeAttachmentFilename` strips path separators, control characters, and quoting hazards from a filename, and `inferAttachmentMimeType` picks the `Content-Type`. Download naming is therefore already centralized in this module; only the header assembly is ad hoc.
- The three routes each build the header inline: `files/download` sanitizes then concatenates both forms, `skills/export` concatenates the raw `[name]` path parameter, `flows/export` emits only the quoted form via `flowExportFileName`.
- RFC 5987 §3.2.1 defines `ext-value` as `charset "'" percent-encoded-value "'"`, where the value must percent-encode everything outside `attr-char`; `attr-char` excludes `*'()` among others. `encodeURIComponent` encodes none of those four.

## Goals / Non-Goals

**Goals:**

- One code path produces every attachment `Content-Disposition` in the app.
- Non-ASCII names survive the round trip in browsers (extended form present everywhere).
- No route can embed an unsanitized value in the quoted filename again.

**Non-Goals:**

- Changing `Content-Type` inference, upload-side filename handling, or `flowExportFileName` itself (the flow-name-to-filename mapping stays as is; the helper consumes its output).
- Inline dispositions or non-attachment responses (none exist today).
- Encoding normalization beyond RFC 5987 (e.g. IRIs, percent-encoding uppercase/lowercase policy beyond the existing uppercase hex).

## Decisions

### D1: One helper in `workspace-attachments.ts`, both forms always emitted

- `contentDispositionHeader(filename)` returns `attachment; filename="<sanitized>"; filename*=UTF-8''<encoded>` unconditionally. Emitting both forms is the RFC 6266-recommended combination: legacy agents read `filename=`, RFC 5987-aware agents prefer `filename*`.
- The ASCII fallback reuses `sanitizeAttachmentFilename` — no second sanitizer to keep in sync. An empty input falls back to the ASCII name `attachment` with an empty extended value, matching the existing sanitize fallback behavior.

### D2: Fix the RFC 5987 encoding, not just the duplication

- The extended value is `encodeURIComponent(filename).replace(/[!'()*]/g, c => '%' + hex(c))`, the standard ES5-era RFC 3986 strict-encoding idiom. Without it, a name containing an apostrophe terminates or corrupts the `ext-value` quotes.

### D3: Route call sites reduce to one expression

- `files/download` passes the raw basename (the helper sanitizes; the pre-computed `safeName` variable disappears), `flows/export` passes `flowExportFileName(flow.name)`, `skills/export` passes `` `${name}.zip` ``. Each route keeps its own name derivation; none of them touches header assembly.

## Risks / Trade-offs

- [Downloaded name changes for flows with non-ASCII names] → Intended fix: names previously mangled by the ASCII-only fallback now decode correctly in modern browsers. Legacy-agent behavior is unchanged in shape (quoted form still present and sanitized).
- [`filename*` present but empty when the name is empty] → Accepted; the header stays syntactically valid and browsers fall back to the quoted `attachment`.

## Migration Plan

1. Single deploy; no DB, config, or API contract change beyond the header value.
2. Rollback: revert the deploy; routes return to their previous inline headers.

## Open Questions

- (none)
