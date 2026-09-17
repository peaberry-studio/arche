## Why

Three download/export routes construct `Content-Disposition` three different ways (issue #458). `flows/export` emits only the legacy quoted `filename=` with no RFC 5987 extended form, so non-ASCII flow names download with mangled names. `skills/export` embeds the raw URL path parameter into the quoted filename without sanitization, so a name containing `"` or `;` produces a malformed header. `files/download` is RFC 6266-correct but builds the value inline and re-implements the encoding. The RFC 5987 encoding shared by two of the routes is also wrong: `encodeURIComponent` leaves `'`, `*`, `(`, `)` unescaped although they are reserved in the `ext-value` production (RFC 5987 §3.2.1).

## What Changes

- Add `contentDispositionHeader()` to `apps/web/src/lib/workspace-attachments.ts`: the single helper that emits `attachment; filename="<sanitized ASCII>"; filename*=UTF-8''<encoded>`, where the ASCII fallback reuses `sanitizeAttachmentFilename` and the extended form percent-encodes the RFC 5987 reserved characters `!'()*` on top of `encodeURIComponent`.
- Use the helper in `files/download`, `flows/[id]/export`, and `skills/[name]/export`, replacing all three inline constructions. `flows/export` gains the extended UTF-8 form; `skills/export` stops embedding the unsanitized path parameter in the quoted filename; `files/download` drops its separate pre-sanitization step.
- Cover the helper with unit tests for ASCII, non-ASCII, reserved-character, and empty names.

No behavior change for `Content-Type`, upload naming, or inline (non-attachment) responses.

## Capabilities

### New Capabilities
- `file-downloads`: Behavioral contract for how workspace file download and export responses name attached files — one standardized RFC 6266/5987 `Content-Disposition` format produced by a single shared helper.

### Modified Capabilities
- (none — no existing spec covers download/export response headers.)

## Impact

- `apps/web/src/lib/workspace-attachments.ts` — gains `contentDispositionHeader()` (existing `sanitizeAttachmentFilename` reused for the ASCII fallback).
- `apps/web/src/app/api/w/[slug]/files/download/route.ts` — header via helper; local `safeName` pre-sanitization removed.
- `apps/web/src/app/api/u/[slug]/flows/[id]/export/route.ts` — header via helper (gains `filename*`).
- `apps/web/src/app/api/u/[slug]/skills/[name]/export/route.ts` — header via helper (quoted filename now sanitized).
- Tests: `apps/web/src/lib/__tests__/workspace-attachments.test.ts` gains `contentDispositionHeader` cases.
- No DB, config, or dependency changes.
