import { describe, expect, it } from "vitest"

import {
  encodeMarkdownForEditor,
  isEquivalentMarkdown,
  normalizeMarkdownForKb,
} from "@/components/workspace/markdown-editor-content"

describe("markdown-editor-content", () => {
  it("normalizes non-breaking spaces before saving", () => {
    expect(normalizeMarkdownForKb("Hello\u00A0&nbsp;world")).toBe("Hello  world")
  })

  it("encodes repeated blank lines into editor-safe placeholders", () => {
    expect(encodeMarkdownForEditor("Line 1\n\n\n\nLine 2")).toBe(
      "Line 1\n\n&nbsp;\n\n&nbsp;\n\nLine 2"
    )
  })

  it("encodes leading and trailing blank line runs", () => {
    expect(encodeMarkdownForEditor("\n\nLine")).toBe("&nbsp;\n\n&nbsp;\n\nLine")
    expect(encodeMarkdownForEditor("Line\n")).toBe("Line\n")
    expect(encodeMarkdownForEditor("Line\n\n\n")).toBe("Line\n\n&nbsp;\n\n&nbsp;")
  })

  it("restores repeated blank lines from editor placeholders", () => {
    expect(normalizeMarkdownForKb("Line 1\n\n&nbsp;\n\n&nbsp;\n\nLine 2")).toBe(
      "Line 1\n\n\n\nLine 2"
    )
  })

  it("leaves fenced code blocks untouched", () => {
    const source = ["```", "line 1", "", "&nbsp;", "", "line 2", "```", "", "After"].join("\n")

    expect(encodeMarkdownForEditor(source)).toBe(source)
    expect(normalizeMarkdownForKb(source)).toBe(source)
  })

  it("keeps mismatched fence delimiters inside open code blocks", () => {
    const source = ["```", "~~~", "inside", "```"].join("\n")

    expect(encodeMarkdownForEditor(source)).toBe(source)
    expect(normalizeMarkdownForKb(source)).toBe(source)
  })

  it("treats trailing blank lines as equivalent", () => {
    expect(isEquivalentMarkdown("Line 1\n\n\n", "Line 1")).toBe(true)
    expect(isEquivalentMarkdown("Line 1\r\n\r\n", "Line 1\n")).toBe(true)
  })

  it("keeps meaningful internal blank lines distinct", () => {
    expect(isEquivalentMarkdown("Line 1\n\nLine 2", "Line 1\nLine 2")).toBe(false)
  })
})
