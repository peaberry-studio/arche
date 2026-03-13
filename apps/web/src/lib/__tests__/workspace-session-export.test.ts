import { describe, expect, it } from "vitest"

import {
  buildWorkspaceSessionMarkdown,
  getWorkspaceSessionExportFilename,
} from "@/lib/workspace-session-export"
import type { ChatMessage } from "@/types/workspace"

describe("workspace session export", () => {
  it("exports only user and assistant visible text to markdown", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        sessionId: "s1",
        role: "system",
        content: "hidden",
        timestamp: "now",
      },
      {
        id: "m2",
        sessionId: "s1",
        role: "user",
        content: "Plan the launch",
        timestamp: "now",
      },
      {
        id: "m3",
        sessionId: "s1",
        role: "assistant",
        content: "",
        timestamp: "now",
        parts: [
          { type: "reasoning", text: "internal chain" },
          { type: "tool", id: "tool-1", name: "grep", state: { status: "completed", input: {}, output: "", title: "done" } },
          { type: "agent", id: "agent-1", name: "Planner" },
          { type: "text", text: "Here is the launch plan." },
          { type: "text", text: "We should ship on Monday." },
        ],
      },
      {
        id: "m4",
        sessionId: "s1",
        role: "assistant",
        content: "",
        timestamp: "now",
        parts: [
          { type: "tool", id: "tool-2", name: "bash", state: { status: "completed", input: {}, output: "", title: "done" } },
        ],
      },
    ]

    expect(buildWorkspaceSessionMarkdown("Launch Plan", messages)).toBe(
      "# Launch Plan\n\n## User\n\nPlan the launch\n\n## Assistant\n\nHere is the launch plan.\n\nWe should ship on Monday.\n"
    )
  })

  it("builds a safe markdown filename from the title", () => {
    expect(getWorkspaceSessionExportFilename("  Roadmap / Q4  ")).toBe("roadmap-q4.md")
  })
})
