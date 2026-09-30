## 1. Shared header helper

- [x] 1.1 Add `contentDispositionHeader(filename)` to `apps/web/src/lib/workspace-attachments.ts`: sanitize the ASCII fallback with `sanitizeAttachmentFilename`, build the extended form with `encodeURIComponent` plus escaping of the RFC 5987 reserved characters `!'()*`, and emit both forms in one `attachment` header.
- [x] 1.2 Cover the helper in `apps/web/src/lib/__tests__/workspace-attachments.test.ts`: ASCII-only name, non-ASCII name (`résumé.pdf`), reserved-character name (`it's a report.pdf`), and empty name.

## 2. Route adoption

- [x] 2.1 `apps/web/src/app/api/u/[slug]/flows/[id]/export/route.ts`: replace the quoted-only header with `contentDispositionHeader(flowExportFileName(flow.name))`.
- [x] 2.2 `apps/web/src/app/api/u/[slug]/skills/[name]/export/route.ts`: replace the inline concatenation (raw `name` path parameter in the quoted filename) with `contentDispositionHeader(\`${name}.zip\`)`.
- [x] 2.3 `apps/web/src/app/api/w/[slug]/files/download/route.ts`: replace the inline header and drop the separate `safeName` pre-sanitization; pass the raw basename to the helper.

## 3. Final verification

- [x] 3.1 Run `pnpm test` and `pnpm lint` from `apps/web/` — both green.
- [ ] 3.2 Run `bash scripts/check-podman-images.sh` from the repo root — images build.
- [x] 3.3 Run `openspec validate standardize-content-disposition --strict` — change validates.
