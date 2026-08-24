/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CuratorDialog } from "@/components/workspace/curator-dialog";

vi.mock("@/components/workspace/publish-kb-button", () => ({
  PublishKbButton: ({ paths }: { paths?: string[] }) => (
    <button type="button">{paths ? "Publish" : "Publish all"}</button>
  ),
}));

vi.mock("@/components/workspace/markdown-editor", () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea
      aria-label="Edit proposal content"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

const proposalFixture = {
  id: "review-1",
  sourceProposalId: null,
  runId: null,
  author: "knowledge-curator",
  agent: "knowledge-curator",
  origin: "learning",
  title: "Remember preference",
  reason: "Durable user preference.",
  evidence: { quote: "Use concise answers" },
  confidence: 0.8,
  kbPath: "Preferences/Answers.md",
  operation: "update",
  baseContent: "# Preference\n",
  baseHash: "sha256:old",
  proposedContent: "# Preference\n\nUse concise answers.\n",
  status: "open",
  actualContent: null,
  actualHash: null,
  appliedHash: null,
  publishCommitSha: null,
  auditTrail: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeDiff(path: string) {
  return {
    path,
    status: "modified",
    additions: 1,
    deletions: 0,
    diff: "@@\n",
    conflicted: false,
  } as const;
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

describe("CuratorDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/learning")) {
        return jsonResponse({ runs: [], proposals: [proposalFixture] });
      }
      return jsonResponse({ ok: true });
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderDialog(overrides: Partial<Parameters<typeof CuratorDialog>[0]> = {}) {
    return render(
      <CuratorDialog
        open
        onOpenChange={vi.fn()}
        slug="alice"
        diffs={[]}
        onOpenFile={vi.fn()}
        {...overrides}
      />
    );
  }

  it("shows the review queue with proposals", async () => {
    renderDialog();

    expect(screen.getByText("Curator")).toBeTruthy();
    expect(await screen.findByText("Remember preference")).toBeTruthy();
    expect(screen.getByText("Preferences/Answers.md")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
  });

  it("opens a proposal in the viewer with preview, edit, and diff tabs", async () => {
    renderDialog();

    fireEvent.click(await screen.findByText("Remember preference"));

    expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Diff" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open in Knowledge Base" })).toBeNull();
    expect(screen.getAllByText("Durable user preference.").length).toBeGreaterThan(0);
  });

  it("shows the proposed content in the preview tab with the reason above it", async () => {
    renderDialog();

    fireEvent.click(await screen.findByText("Remember preference"));

    expect(await screen.findByRole("heading", { name: "Preference" })).toBeTruthy();
    expect(screen.getByText("Reason")).toBeTruthy();
    expect(screen.getAllByText("Durable user preference.").length).toBeGreaterThan(1);
  });

  it("shows the tab selector in the dialog header", async () => {
    renderDialog();

    await screen.findByText("Remember preference");

    const header = screen.getByTestId("curator-dialog-header");
    expect(header).toBeTruthy();
    expect(screen.getByRole("button", { name: /Proposals/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Manual edits/ })).toBeTruthy();
  });

  it("clears the viewer when switching to the manual edits tab", async () => {
    renderDialog();

    fireEvent.click(await screen.findByText("Remember preference"));
    expect(await screen.findByRole("heading", { name: "Preference" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Manual edits/ }));

    expect(await screen.findByText("No manual edits to publish")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Preference" })).toBeNull();
    expect(screen.queryByText("Reason")).toBeNull();
  });

  it("shows a unified diff in the diff tab", async () => {
    renderDialog();

    fireEvent.click(await screen.findByText("Remember preference"));
    fireEvent.click(screen.getByRole("button", { name: "Diff" }));

    expect(await screen.findByText("+Use concise answers.")).toBeTruthy();
    expect(screen.getAllByText("Preferences/Answers.md").length).toBeGreaterThan(0);
  });

  it("edits a proposal from the viewer and persists the draft", async () => {
    renderDialog();

    fireEvent.click(await screen.findByText("Remember preference"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Edit proposal content" });
    expect((editor as HTMLTextAreaElement).value).toContain("Use concise answers");

    fireEvent.change(editor, { target: { value: "# Edited content" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/u/alice/learning/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_draft", proposalId: "review-1", content: "# Edited content" }),
      });
    }, { timeout: 2000 });
  });

  it("shows the Publish all action only in manual edits mode with changes to publish", async () => {
    renderDialog();
    await screen.findByText("Remember preference");
    expect(screen.queryByRole("button", { name: "Publish all" })).toBeNull();

    renderDialog({
      diffs: [makeDiff("docs/a.md")],
      onPublish: vi.fn(),
    });
    await screen.findByText("Remember preference");

    expect(screen.queryByRole("button", { name: "Publish all" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Manual edits/ }));
    expect(await screen.findByRole("button", { name: "Publish all" })).toBeTruthy();
  });

  it("hides the Publish all action when the workspace agent is disabled", async () => {
    renderDialog({
      workspaceAgentEnabled: false,
      diffs: [makeDiff("docs/a.md")],
      onPublish: vi.fn(),
    });

    await screen.findByText("Remember preference");
    fireEvent.click(screen.getByRole("button", { name: /Manual edits/ }));
    await screen.findByText("docs/a.md");

    expect(screen.queryByRole("button", { name: "Publish all" })).toBeNull();
  });

  it("closes through the header close button", async () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    fireEvent.click(await screen.findByRole("button", { name: "Close curator" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("lists workspace diffs in the manual edits tab", async () => {
    renderDialog({
      diffs: [makeDiff("docs/a.md")],
    });

    fireEvent.click(screen.getByRole("button", { name: /Manual edits/ }));

    expect(await screen.findByText("docs/a.md")).toBeTruthy();
  });

  it("renders per-file publish buttons in manual edits mode", async () => {
    renderDialog({
      diffs: [makeDiff("docs/a.md"), makeDiff("docs/b.md")],
      onPublish: vi.fn(),
    });

    fireEvent.click(await screen.findByRole("button", { name: /Proposals/ }));
    fireEvent.click(screen.getByRole("button", { name: /Manual edits/ }));

    const publishButtons = await screen.findAllByRole("button", { name: "Publish" });
    expect(publishButtons.length).toBe(2);
  });

  it("hides the per-file publish button for conflicted diffs", async () => {
    renderDialog({
      diffs: [{ ...makeDiff("docs/a.md"), conflicted: true }],
    });

    fireEvent.click(await screen.findByRole("button", { name: /Manual edits/ }));
    await screen.findByText("docs/a.md", undefined, { timeout: 2000 });

    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("badges each tab with its pending item count", async () => {
    renderDialog({
      diffs: [makeDiff("docs/a.md"), makeDiff("docs/b.md")],
    });

    await screen.findByText("Remember preference");

    const proposalsTab = screen.getByRole("button", { name: /Proposals/ });
    await waitFor(() => expect(proposalsTab.textContent).toContain("1"));
    const editsTab = screen.getByRole("button", { name: /Manual edits/ });
    expect(editsTab.textContent).toContain("2");
  });

  it("keeps the manual edits badge hidden with nothing to publish", async () => {
    renderDialog();

    await screen.findByText("Remember preference");

    const editsTab = screen.getByRole("button", { name: /Manual edits/ });
    expect(editsTab.textContent).not.toContain("1");
  });
});
