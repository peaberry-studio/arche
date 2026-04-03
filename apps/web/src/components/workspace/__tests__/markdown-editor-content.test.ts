import { describe, expect, it } from "vitest"

import {
  isEquivalentMarkdown,
  normalizeMarkdownForKb,
} from "@/components/workspace/markdown-editor-content"

describe("markdown-editor-content", () => {
  it("normalizes non-breaking spaces before saving", () => {
    expect(normalizeMarkdownForKb("Hello\u00A0&nbsp;world")).toBe("Hello  world")
  })

  it("treats trailing blank lines as equivalent", () => {
    expect(isEquivalentMarkdown("Line 1\n\n\n", "Line 1")).toBe(true)
    expect(isEquivalentMarkdown("Line 1\r\n\r\n", "Line 1\n")).toBe(true)
  })

  it("keeps meaningful internal blank lines distinct", () => {
    expect(isEquivalentMarkdown("Line 1\n\nLine 2", "Line 1\nLine 2")).toBe(false)
  })
})
