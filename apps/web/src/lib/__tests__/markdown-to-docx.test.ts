import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"

import { markdownToDocx } from "../markdown-to-docx"

function docxXml(buffer: Buffer): { document: string; relationships: string } {
  const archive = unzipSync(new Uint8Array(buffer))
  return {
    document: strFromU8(archive["word/document.xml"]),
    relationships: strFromU8(archive["word/_rels/document.xml.rels"]),
  }
}

describe("markdownToDocx", () => {
  it("creates an editable Word document with common Markdown structures", async () => {
    const markdown = [
      "---",
      "title: Export test",
      "---",
      "# Report",
      "",
      "A **bold** and *italic* [link](https://example.com) with `code`.",
      "",
      "- First",
      "- [x] Complete",
      "",
      "1. Ordered",
      "2. Second",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| Alpha | 42 |",
      "",
      "> Important note",
      "",
      "```ts",
      "const answer = 42",
      "```",
    ].join("\n")

    const buffer = await markdownToDocx(markdown)
    const xml = docxXml(buffer)

    expect(buffer.subarray(0, 2).toString()).toBe("PK")
    expect(xml.document).toContain("Report")
    expect(xml.document).toContain("w:val=\"Heading1\"")
    expect(xml.document).toContain("w:b")
    expect(xml.document).toContain("w:i")
    expect(xml.document).toContain("☒")
    expect(xml.document).toContain("const answer = 42")
    expect(xml.document).toContain("<w:tbl>")
    expect(xml.document).toContain("Alpha")
    expect(xml.document).not.toContain("title: Export test")
    expect(xml.relationships).toContain("https://example.com")
  })

  it("preserves inline and display math as Word math", async () => {
    const buffer = await markdownToDocx("Inline $E = mc^2$.\n\n$$\\int_0^1 x^2 dx$$")
    const { document } = docxXml(buffer)

    expect(document).toContain("<m:oMath>")
    expect(document).toContain("E = mc^2")
    expect(document).toContain("\\int_0^1 x^2 dx")
  })

  it("handles empty articles", async () => {
    const buffer = await markdownToDocx("---\ntitle: Empty\n---\n")
    expect(buffer.subarray(0, 2).toString()).toBe("PK")
  })
})
