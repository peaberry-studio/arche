/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CuratorDialog } from "@/components/workspace/curator-dialog";

const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("@/components/workspace/publish-kb-button", () => ({
  PublishKbButton: ({ onComplete }: { onComplete?: () => void }) => (
    <button type="button" onClick={onComplete}>
      Publish changes
    </button>
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

describe("CuratorDialog", () => {
  beforeEach(() => {
    routerPushMock.mockClear();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/learning")) {
        return jsonResponse({ runs: [], proposals: [proposalFixture] });
      }
      return jsonResponse({ ok: true });
    }));
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

  it("previews a proposal diff and opens it in Explore", async () => {
    renderDialog();

    fireEvent.click(await screen.findByText("Remember preference"));

    expect(await screen.findByRole("button", { name: "Open in Explore" })).toBeTruthy();
    expect(screen.getAllByText("Reason").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Durable user preference.").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Open in Explore" }));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/w/alice/explore?path=Preferences%2FAnswers.md");
    });
  });

  it("shows the publish action only when there are changes to publish", async () => {
    const { unmount } = renderDialog();

    expect(screen.queryByRole("button", { name: "Publish changes" })).toBeNull();
    unmount();

    renderDialog({
      diffs: [
        {
          path: "docs/a.md",
          status: "modified",
          additions: 1,
          deletions: 1,
          diff: "@@ -1 +1 @@\n-old\n+new\n",
          conflicted: false,
        },
      ],
      onPublish: vi.fn(),
    });

    expect(await screen.findByRole("button", { name: "Publish changes" })).toBeTruthy();
  });

  it("hides the publish action when the workspace agent is disabled", async () => {
    renderDialog({
      workspaceAgentEnabled: false,
      diffs: [
        {
          path: "docs/a.md",
          status: "modified",
          additions: 1,
          deletions: 0,
          diff: "@@\n",
          conflicted: false,
        },
      ],
      onPublish: vi.fn(),
    });

    await screen.findByText("Curator");

    expect(screen.queryByRole("button", { name: "Publish changes" })).toBeNull();
  });

  it("closes through the header close button", async () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    fireEvent.click(await screen.findByRole("button", { name: "Close curator" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("lists pending workspace changes in the changes tab", async () => {
    renderDialog({
      diffs: [
        {
          path: "docs/a.md",
          status: "modified",
          additions: 1,
          deletions: 0,
          diff: "@@\n",
          conflicted: false,
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Pending publish" }));

    expect(await screen.findByText("docs/a.md")).toBeTruthy();
  });
});
