import { describe, expect, it } from "vitest"

// Deliberately unmocked. Charts render through a real worker thread running real vega and
// vega-lite: mocking them previously hid a regression where every exported chart came out
// blank because vega.parse was not asked for expression ASTs.
import { markdownToPdfHtml } from "../markdown-to-pdf-html"

describe("markdownToPdfHtml", () => {
  it("renders basic markdown to HTML", async () => {
    const html = await markdownToPdfHtml("# Hello\n\nA paragraph.")
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("<h1>Hello</h1>")
    expect(html).toContain("<p>A paragraph.</p>")
    expect(html).toContain('<div class="markdown-content">')
  })

  it("strips frontmatter and renders only the body", async () => {
    const md = "---\ntitle: Test\n---\n# Body content"
    const html = await markdownToPdfHtml(md)
    expect(html).toContain("<h1>Body content</h1>")
    expect(html).not.toContain("title: Test")
  })

  it("renders GFM tables", async () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |"
    const html = await markdownToPdfHtml(md)
    expect(html).toContain("<table>")
    expect(html).toContain("<th>A</th>")
    expect(html).toContain("<td>1</td>")
  })

  it("renders KaTeX inline math", async () => {
    const md = "The formula $E = mc^2$ is famous."
    const html = await markdownToPdfHtml(md)
    expect(html).toContain("katex")
  })

  it("renders KaTeX display math", async () => {
    const md = "$$\\int_0^1 x^2 dx$$"
    const html = await markdownToPdfHtml(md)
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
    const html = await markdownToPdfHtml(md)
    expect(html).toContain('class="vega-chart"')
    expect(html).toContain("<svg")
  })

  it("renders real chart content, not an empty SVG", async () => {
    const spec = JSON.stringify({
      data: { values: [{ quarter: "Q1", revenue: 10 }, { quarter: "Q2", revenue: 20 }] },
      mark: "bar",
      encoding: {
        x: { field: "quarter", type: "nominal" },
        y: { field: "revenue", type: "quantitative" },
      },
    })
    const html = await markdownToPdfHtml("```vega-lite\n" + spec + "\n```")

    expect(html).toContain('class="vega-chart"')
    // Axis labels only appear when expressions actually evaluated.
    expect(html).toContain("Q1")
    expect(html).toContain("Q2")
    expect(html).toMatch(/<(path|rect)/)
  })

  it("renders charts that depend on Vega expressions", async () => {
    const spec = JSON.stringify({
      data: { values: [{ x: 1 }, { x: 2 }, { x: 3 }] },
      transform: [{ calculate: "datum.x * 10", as: "scaled" }],
      mark: "point",
      encoding: {
        x: { field: "x", type: "quantitative" },
        y: { field: "scaled", type: "quantitative" },
      },
    })
    const html = await markdownToPdfHtml("```vega-lite\n" + spec + "\n```")

    expect(html).toContain('class="vega-chart"')
    expect(html).toMatch(/<(path|circle)/)
  })

  it("resolves workspace-relative data urls through the supplied reader", async () => {
    const spec = JSON.stringify({
      data: { url: "data/revenue.csv", format: { type: "csv" } },
      mark: "bar",
      encoding: {
        x: { field: "quarter", type: "nominal" },
        y: { field: "revenue", type: "quantitative" },
      },
    })
    const reads: string[] = []
    const html = await markdownToPdfHtml("```vega-lite\n" + spec + "\n```", {
      readWorkspaceData: async (dataPath) => {
        reads.push(dataPath)
        return "quarter,revenue\nQ1,10\nQ2,20\n"
      },
    })

    expect(reads).toEqual(["data/revenue.csv"])
    expect(html).toContain('class="vega-chart"')
    expect(html).toContain("Q1")
  })

  it("refuses remote data urls and workspace escapes", async () => {
    for (const url of ["https://evil.example.com/x.csv", "../../etc/passwd"]) {
      const spec = JSON.stringify({
        data: { url, format: { type: "csv" } },
        mark: "bar",
        encoding: { x: { field: "a", type: "nominal" } },
      })
      const html = await markdownToPdfHtml("```vega-lite\n" + spec + "\n```", {
        readWorkspaceData: async () => "a\n1\n",
      })

      expect(html).not.toContain('class="vega-chart"')
      expect(html).toContain("<code")
    }
  })

  it("leaves specs Vega-Lite cannot compile as code blocks", async () => {
    const md = '```vega-lite\n{"invalid": true}\n```'
    const html = await markdownToPdfHtml(md)
    expect(html).not.toContain('class="vega-chart"')
    expect(html).toContain("<code")
  })

  it("leaves non-JSON vega-lite blocks as code blocks", async () => {
    const html = await markdownToPdfHtml("```vega-lite\nnot json\n```")
    expect(html).not.toContain('class="vega-chart"')
    expect(html).toContain("<code")
  })

  it("renders multi-view and geographic specs the old allowlist rejected", async () => {
    const enc = { x: { field: "x", type: "quantitative" }, y: { field: "x", type: "quantitative" } }

    for (const spec of [
      { data: { values: [{ x: 1 }] }, hconcat: [{ mark: "bar", encoding: enc }, { mark: "line", encoding: enc }] },
      { data: { values: [{ x: 1 }] }, mark: "geoshape", projection: { type: "albersUsa" } },
      {
        data: { values: [{ a: 1, b: 2 }] },
        repeat: { column: ["a", "b"] },
        spec: { mark: "point", encoding: { x: { field: { repeat: "column" }, type: "quantitative" } } },
      },
      { data: { values: [{ x: 1 }] }, mark: "boxplot", encoding: { x: { field: "x", type: "quantitative" } } },
    ]) {
      const html = await markdownToPdfHtml("```vega-lite\n" + JSON.stringify(spec) + "\n```")
      expect(html).toContain('class="vega-chart"')
    }
  })

  it("inlines KaTeX CSS in the head", async () => {
    const html = await markdownToPdfHtml("$x$")
    expect(html).toContain("<style>")
  })

  it("includes print styles", async () => {
    const html = await markdownToPdfHtml("# Hello")
    expect(html).toContain("@page")
    expect(html).toContain("break-inside: avoid")
  })

  it("renders GFM task lists", async () => {
    const md = "- [x] Done\n- [ ] Not done"
    const html = await markdownToPdfHtml(md)
    expect(html).toContain('type="checkbox"')
    expect(html).toContain("checked")
  })

  it("handles empty input", async () => {
    const html = await markdownToPdfHtml("")
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain('<div class="markdown-content">')
  })

  it("handles input that is only frontmatter", async () => {
    const md = "---\ntitle: Only Meta\n---\n"
    const html = await markdownToPdfHtml(md)
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).not.toContain("Only Meta")
  })
})
