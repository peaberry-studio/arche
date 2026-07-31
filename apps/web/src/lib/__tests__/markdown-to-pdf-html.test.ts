import { describe, expect, it, vi } from "vitest"

vi.mock("vega", () => ({
  parse: vi.fn(() => ({})),
  View: class MockView {
    toSVG = vi.fn().mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')
    finalize = vi.fn()
  },
}))

vi.mock("vega-lite", () => ({
  compile: vi.fn(() => ({ spec: {} })),
}))

import { markdownToPdfHtml } from "../markdown-to-pdf-html"

function createBundle(
  markdown: string,
  appendices: { markdown: string; path: string }[] = [],
) {
  return {
    appendices,
    availablePaths: ["docs/main.md", ...appendices.map((appendix) => appendix.path)],
    primary: { markdown, path: "docs/main.md" },
  }
}

describe("markdownToPdfHtml", () => {
  it("renders basic markdown to HTML", async () => {
    const html = await markdownToPdfHtml(createBundle("# Hello\n\nA paragraph."))
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toMatch(/<h1 id="[^"]+">Hello<\/h1>/)
    expect(html).toContain("<p>A paragraph.</p>")
    expect(html).toContain('<main class="markdown-content">')
  })

  it("strips frontmatter and renders only the body", async () => {
    const md = "---\ntitle: Test\n---\n# Body content"
    const html = await markdownToPdfHtml(createBundle(md))
    expect(html).toContain(">Body content</h1>")
    expect(html).not.toContain("title: Test")
  })

  it("renders GFM tables", async () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |"
    const html = await markdownToPdfHtml(createBundle(md))
    expect(html).toContain("<table>")
    expect(html).toContain("<th>A</th>")
    expect(html).toContain("<td>1</td>")
  })

  it("renders KaTeX inline math", async () => {
    const md = "The formula $E = mc^2$ is famous."
    const html = await markdownToPdfHtml(createBundle(md))
    expect(html).toContain("katex")
  })

  it("renders KaTeX display math", async () => {
    const md = "$$\\int_0^1 x^2 dx$$"
    const html = await markdownToPdfHtml(createBundle(md))
    expect(html).toContain("katex-display")
  })

  it("renders vega-lite code blocks as SVG charts", async () => {
    const spec = JSON.stringify({
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      mark: "bar",
      data: { values: [{ x: 1, y: 2 }] },
      encoding: { x: { field: "x" }, y: { field: "y" } },
    })
    const md = "```vega-lite\n" + spec + "\n```"
    const html = await markdownToPdfHtml(createBundle(md))
    expect(html).toContain('class="pdf-figure"')
    expect(html).toContain('class="vega-chart"')
    expect(html).toContain("<svg")
    expect(html).toContain("Table of Figures")
  })

  it("leaves invalid vega-lite specs as code blocks", async () => {
    const md = '```vega-lite\n{"invalid": true}\n```'
    const html = await markdownToPdfHtml(createBundle(md))
    expect(html).not.toContain('class="vega-chart"')
    expect(html).toContain("<code")
  })

  it("inlines KaTeX CSS in the head", async () => {
    const html = await markdownToPdfHtml(createBundle("$x$"))
    expect(html).toContain("<style>")
  })

  it("includes print styles", async () => {
    const html = await markdownToPdfHtml(createBundle("# Hello"))
    expect(html).toContain("@page")
    expect(html).toContain("break-inside: avoid")
    expect(html).toContain("target-counter(attr(href), page)")
  })

  it("renders GFM task lists", async () => {
    const md = "- [x] Done\n- [ ] Not done"
    const html = await markdownToPdfHtml(createBundle(md))
    expect(html).toContain('type="checkbox"')
    expect(html).toContain("checked")
  })

  it("handles empty input", async () => {
    const html = await markdownToPdfHtml(createBundle(""))
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain('<main class="markdown-content">')
  })

  it("handles input that is only frontmatter", async () => {
    const md = "---\ntitle: Only Meta\n---\n"
    const html = await markdownToPdfHtml(createBundle(md))
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("<title>Only Meta</title>")
    expect(html).not.toContain("<p>Only Meta</p>")
  })

  it("builds an H1-H3 table of contents and omits H4", async () => {
    const html = await markdownToPdfHtml(
      createBundle("# One\n\n## Two\n\n### Three\n\n#### Four"),
    )

    expect(html).toContain("Table of Contents")
    expect(html).toContain('<li data-level="1">')
    expect(html).toContain('<li data-level="2">')
    expect(html).toContain('<li data-level="3">')
    expect(html).not.toContain('<span>Four</span>')
  })

  it("groups linked documents into one appendix and demotes their source headings", async () => {
    const html = await markdownToPdfHtml(
      createBundle("---\ntitle: Main Study\n---\n# Main", [
        {
          markdown:
            "---\ntitle: Main Study — 01 - Prompt-token sources\n---\n# Results\n\n## Detail",
          path: "docs/study.md",
        },
        {
          markdown: "---\ntitle: Main Study — 02 - Results\n---\nBody",
          path: "docs/results.md",
        },
      ]),
    )

    expect(html).toContain("Appendix. 01 - Prompt-token sources")
    expect(html).toContain("Appendix. 02 - Results")
    expect(html).not.toContain("Appendix A.")
    expect(html).not.toContain("Appendix B.")
    expect(html).not.toContain("Main Study — 01 - Prompt-token sources")
    expect(html).toMatch(/<h2 id="[^"]+">Results<\/h2>/)
    expect(html).toMatch(/<h3 id="[^"]+">Detail<\/h3>/)
    expect(html.match(/class="pdf-appendix"/gu)).toHaveLength(1)
    expect(html.match(/class="pdf-document pdf-appendix-section"/gu)).toHaveLength(
      2,
    )
  })

  it("rewrites included document links and renders unresolved links as text", async () => {
    const html = await markdownToPdfHtml(
      {
        appendices: [{ markdown: "# Target", path: "docs/target.md" }],
        availablePaths: ["docs/main.md", "docs/target.md", "docs/missing.md"],
        primary: {
          markdown:
            "See [target](target.md#Target), [[docs/target.md|Target Alias]], and [missing](missing.md).",
          path: "docs/main.md",
        },
      },
    )

    expect(html).toMatch(/<a href="#document-[^"]+--target">target<\/a>/)
    expect(html).toMatch(/<a href="#document-[^"]+">Target Alias<\/a>/)
    expect(html).toContain("and missing.")
    expect(html).not.toContain('href="missing.md"')
  })

  it("adds standalone Markdown images to the table of figures", async () => {
    const html = await markdownToPdfHtml(
      createBundle("![Latency by workload](data:image/png;base64,AAAA)"),
    )

    expect(html).toContain("Figure 1. Latency by workload")
    expect(html).toContain('data-figure-id="figure-1"')
  })

  it("numbers Markdown images and charts in source order", async () => {
    const spec = JSON.stringify({
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      title: "Chart second",
      mark: "bar",
      data: { values: [{ x: 1, y: 2 }] },
      encoding: { x: { field: "x" }, y: { field: "y" } },
    })
    const html = await markdownToPdfHtml(
      createBundle(
        [
          "![Image first](data:image/png;base64,AAAA)",
          `\`\`\`vega-lite\n${spec}\n\`\`\``,
          "![Image third](data:image/png;base64,BBBB)",
        ].join("\n\n"),
      ),
    )

    const first = html.indexOf("Figure 1. Image first")
    const second = html.indexOf("Figure 2. Chart second")
    const third = html.indexOf("Figure 3. Image third")
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
  })
})
