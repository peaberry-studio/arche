## Purpose

Defines the behavioral contract for how workspace file download and export responses name attached files: a single standardized RFC 6266 `Content-Disposition` format, produced by one shared helper, that carries both a sanitized legacy `filename=` and the RFC 5987 extended `filename*=UTF-8''` form.

## ADDED Requirements

### Requirement: File download responses use one standardized Content-Disposition format
Every workspace route that responds with an attached file — workspace file download, flow template export, and skill archive export — SHALL emit exactly one `Content-Disposition` header of the form `attachment; filename="<sanitized ASCII name>"; filename*=UTF-8''<RFC 5987 percent-encoded name>`. The ASCII fallback SHALL be produced by sanitizing the attachment filename, and the extended value SHALL be percent-encoded UTF-8 that also encodes the characters RFC 5987 reserves in `ext-value`. No route SHALL emit a header that omits the extended form or embeds an unsanitized path-derived name in the quoted filename.

#### Scenario: ASCII-only attachment name
- **WHEN** a download or export route responds for a file named `report.csv`
- **THEN** the `Content-Disposition` header carries `filename="report.csv"` and `filename*=UTF-8''report.csv`

#### Scenario: Non-ASCII attachment name
- **WHEN** a download or export route responds for a file named `résumé.pdf`
- **THEN** the quoted fallback contains the sanitized ASCII form of the name
- **AND** the extended form contains the percent-encoded UTF-8 representation `r%C3%A9sum%C3%A9.pdf`

#### Scenario: Attachment name containing RFC 5987 reserved characters
- **WHEN** a download or export route responds for a file whose name contains `'`, `!`, `*`, `(`, or `)`
- **THEN** those characters are percent-encoded in the extended form and cannot terminate or corrupt the `ext-value` quoting

#### Scenario: Empty attachment name
- **WHEN** a download route cannot derive a filename from the requested path
- **THEN** the header remains syntactically valid with the sanitized fallback ASCII name

### Requirement: Content-Disposition construction is centralized
Download and export routes SHALL obtain their `Content-Disposition` value from the shared workspace attachment helper rather than constructing header strings inline, so that the attachment naming format has a single implementation and routes cannot diverge.

#### Scenario: A new export route needs an attachment header
- **WHEN** an API route responds with an attached file
- **THEN** it passes its derived filename to the shared helper and does not assemble `Content-Disposition` parts itself
