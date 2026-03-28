import { describe, expect, it } from "vitest";

import { parseEmailDraftOutput } from "@/components/workspace/chat-panel/email-draft";

describe("parseEmailDraftOutput", () => {
  it("normalizes recipients and builds copy text when copyText is missing", () => {
    const result = parseEmailDraftOutput(
      JSON.stringify({
        subject: "Q2 follow-up",
        body: "Hi team,\r\n\r\nThanks for the meeting.\r\n",
        to: ["ana@example.com", " ANA@example.com ", ""],
        cc: "ops@example.com, ops@example.com, legal@example.com",
        bcc: ["finance@example.com"],
      })
    );

    expect(result).toEqual({
      subject: "Q2 follow-up",
      body: "Hi team,\n\nThanks for the meeting.",
      to: ["ana@example.com"],
      cc: ["ops@example.com", "legal@example.com"],
      bcc: ["finance@example.com"],
      copyText: [
        "To: ana@example.com",
        "Cc: ops@example.com, legal@example.com",
        "Bcc: finance@example.com",
        "Subject: Q2 follow-up",
        "",
        "Hi team,",
        "",
        "Thanks for the meeting.",
      ].join("\n"),
    });
  });

  it("supports nested draft payload and keeps explicit copyText", () => {
    const result = parseEmailDraftOutput(
      JSON.stringify({
        draft: {
          subject: "Partnership intro",
          body: "Hello!",
          to: ["ceo@example.com"],
        },
        copyText: "custom copy",
      })
    );

    expect(result).toEqual({
      subject: "Partnership intro",
      body: "Hello!",
      to: ["ceo@example.com"],
      cc: [],
      bcc: [],
      copyText: "custom copy",
    });
  });

  it("returns null when json is invalid", () => {
    expect(parseEmailDraftOutput("not-json")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseEmailDraftOutput(JSON.stringify({ subject: "Missing body" }))).toBeNull();
    expect(parseEmailDraftOutput(JSON.stringify({ body: "Missing subject" }))).toBeNull();
  });
});
