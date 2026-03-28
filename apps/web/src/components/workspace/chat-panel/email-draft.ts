type EmailDraftPayload = {
  subject: string;
  body: string;
  to: string[];
  cc: string[];
  bcc: string[];
};

export type EmailDraftOutput = EmailDraftPayload & {
  copyText: string;
};

const getString = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);

function normalizeEmailRecipientList(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value.map((item) => String(item))
    : typeof value === "string"
      ? value.split(",")
      : [];

  const recipients: string[] = [];
  const seen = new Set<string>();

  for (const entry of source) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    recipients.push(trimmed);
  }

  return recipients;
}

function buildEmailDraftCopyText(draft: EmailDraftPayload): string {
  const lines: string[] = [];

  if (draft.to.length > 0) lines.push(`To: ${draft.to.join(", ")}`);
  if (draft.cc.length > 0) lines.push(`Cc: ${draft.cc.join(", ")}`);
  if (draft.bcc.length > 0) lines.push(`Bcc: ${draft.bcc.join(", ")}`);

  lines.push(`Subject: ${draft.subject}`, "", draft.body);
  return lines.join("\n");
}

export function parseEmailDraftOutput(rawOutput?: string): EmailDraftOutput | null {
  const source = rawOutput?.trim();
  if (!source) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const root = parsed as Record<string, unknown>;
  const payload =
    root.draft && typeof root.draft === "object"
      ? (root.draft as Record<string, unknown>)
      : root;

  const subject = getString(payload.subject);
  const bodySource = getString(payload.body);
  const body = bodySource
    ? bodySource.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
    : undefined;

  if (!subject || !body) return null;

  const to = normalizeEmailRecipientList(payload.to);
  const cc = normalizeEmailRecipientList(payload.cc);
  const bcc = normalizeEmailRecipientList(payload.bcc);

  const copyTextSource = getString(payload.copyText) ?? getString(root.copyText);
  const normalizedDraft = { subject, body, to, cc, bcc };

  return {
    ...normalizedDraft,
    copyText: copyTextSource ?? buildEmailDraftCopyText(normalizedDraft),
  };
}
