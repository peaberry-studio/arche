import { strFromU8, unzipSync } from "fflate"
import sharp from "sharp"
import { describe, expect, it } from "vitest"

import { markdownToDocx } from "../markdown-to-docx"

function docxXml(buffer: Buffer): { document: string; relationships: string } {
  const archive = unzipSync(new Uint8Array(buffer))
  return {
    document: strFromU8(archive["word/document.xml"]),
    relationships: strFromU8(archive["word/_rels/document.xml.rels"]),
  }
}

function docxArchive(buffer: Buffer): ReturnType<typeof unzipSync> {
  return unzipSync(new Uint8Array(buffer))
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

  it("renders Vega-Lite fences as embedded PNG charts", async () => {
    const spec = JSON.stringify({
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      background: "white",
      data: { values: [{ category: "A", value: 2 }, { category: "B", value: 4 }] },
      encoding: {
        x: { field: "category", type: "nominal" },
        y: { field: "value", type: "quantitative" },
      },
      mark: "bar",
      title: "Figure 1 — Example chart",
    })
    const buffer = await markdownToDocx(`Before\n\n\`\`\`vega-lite\n${spec}\n\`\`\``)
    const archive = docxArchive(buffer)
    const media = Object.entries(archive).find(
      ([name]) => name.startsWith("word/media/") && !name.endsWith("/"),
    )

    expect(media).toBeDefined()
    expect(Buffer.from(media?.[1] ?? []).subarray(1, 4).toString()).toBe("PNG")
    expect(strFromU8(archive["word/document.xml"])).not.toContain("category")
    expect(strFromU8(archive["word/document.xml"])).not.toContain("vega-lite")
  })

  it("exports tightly cropped high-resolution charts with complete legends", async () => {
    const chart = (series: string) => JSON.stringify({
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      data: { values: [{ series, value: 2 }] },
      encoding: {
        color: { field: "series", type: "nominal" },
        x: { field: "value", type: "quantitative" },
        y: { field: "series", type: "nominal" },
      },
      height: 80,
      mark: "point",
      width: 200,
    })
    const shortBuffer = await markdownToDocx(`\`\`\`vega-lite\n${chart("Short")}\n\`\`\``)
    const longBuffer = await markdownToDocx(
      `\`\`\`vega-lite\n${chart("A complete legend label that must never be truncated in a static export")}\n\`\`\``,
    )
    const shortArchive = docxArchive(shortBuffer)
    const longArchive = docxArchive(longBuffer)
    const shortImage = Object.entries(shortArchive).find(
      ([name]) => name.startsWith("word/media/") && !name.endsWith("/"),
    )?.[1]
    const longImage = Object.entries(longArchive).find(
      ([name]) => name.startsWith("word/media/") && !name.endsWith("/"),
    )?.[1]

    expect(shortImage).toBeDefined()
    expect(longImage).toBeDefined()
    const shortMetadata = await sharp(Buffer.from(shortImage ?? [])).metadata()
    const longMetadata = await sharp(Buffer.from(longImage ?? [])).metadata()
    const document = strFromU8(longArchive["word/document.xml"])
    const extent = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/u.exec(document)
    const displayedWidth = Number(extent?.[1] ?? 0) / 9525
    const tightlyCropped = await sharp(Buffer.from(longImage ?? []))
      .trim({ background: "#ffffff", threshold: 10 })
      .toBuffer({ resolveWithObject: true })

    expect(longMetadata.width ?? 0).toBeGreaterThan((shortMetadata.width ?? 0) * 1.2)
    expect(longMetadata.width ?? 0).toBeGreaterThan(displayedWidth * 2.5)
    expect((longMetadata.width ?? 0) - tightlyCropped.info.width).toBeLessThanOrEqual(50)
    expect((longMetadata.height ?? 0) - tightlyCropped.info.height).toBeLessThanOrEqual(50)
  })

  it("renders charts beyond the former twenty-chart bundle limit", async () => {
    const spec = JSON.stringify({
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      data: { values: [{ value: 1 }] },
      encoding: { x: { field: "value", type: "quantitative" } },
      height: 20,
      mark: "point",
      width: 20,
    })
    const markdown = Array.from(
      { length: 21 },
      () => `\`\`\`vega-lite\n${spec}\n\`\`\``,
    ).join("\n\n")
    const archive = docxArchive(await markdownToDocx(markdown))
    const document = strFromU8(archive["word/document.xml"])

    expect(document.match(/<w:drawing>/gu) ?? []).toHaveLength(21)
    expect(document).not.toContain("vega-lite")
  })

  it("adds directly linked documents as next-page appendices", async () => {
    const buffer = await markdownToDocx({
      appendices: [
        {
          markdown: "---\ntitle: Main report — Latency plots\n---\n# Main report — Latency plots\n\n## Detail\n\nAppendix body.",
          path: "Research/Main report/Latency plots.md",
        },
      ],
      availablePaths: [
        "Research/Main report.md",
        "Research/Main report/Latency plots.md",
      ],
      primary: {
        markdown: "---\ntitle: Main report\n---\n# Main report\n\nSee [[Research/Main report/Latency plots|latency plots]].",
        path: "Research/Main report.md",
      },
    })
    const { document } = docxXml(buffer)

    expect(document).toContain("Appendix. Latency plots")
    expect(document).toContain("Appendix body.")
    expect(document.match(/Main report — Latency plots/gu) ?? []).toHaveLength(0)
    expect(document).toContain("w:type w:val=\"nextPage\"")
    expect(document).toMatch(/w:hyperlink[^>]+w:anchor="document_/u)
  })
})
