import { describe, expect, it } from "vitest"

import {
  findDirectDocxDocumentPaths,
  resolveDocxInternalLink,
} from "../docx-document-bundle"

const AVAILABLE_PATHS = [
  "Research/Report.md",
  "Research/Report/Latency.md",
  "Research/Report/Throughput.md",
  "Research/Other.md",
]

describe("DOCX document bundles", () => {
  it("collects only direct Markdown and Obsidian links in source order", () => {
    const markdown = [
      "[Latency](Report/Latency.md)",
      "[[Research/Report/Throughput|Throughput plots]]",
      "[Duplicate](Report/Latency.md)",
      "[External](https://example.com)",
    ].join("\n\n")

    expect(
      findDirectDocxDocumentPaths(markdown, "Research/Report.md", AVAILABLE_PATHS),
    ).toEqual([
      "Research/Report/Latency.md",
      "Research/Report/Throughput.md",
    ])
  })

  it("resolves heading links within included Markdown documents", () => {
    expect(
      resolveDocxInternalLink(
        "Report/Latency.md#P95 latency",
        "Research/Report.md",
        AVAILABLE_PATHS,
        "markdown",
      ),
    ).toEqual({
      heading: "P95 latency",
      kind: "resolved",
      path: "Research/Report/Latency.md",
    })
  })
})
