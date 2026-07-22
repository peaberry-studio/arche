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

  it("leaves invalid vega-lite specs as code blocks", async () => {
    const md = '```vega-lite\n{"invalid": true}\n```'
    const html = await markdownToPdfHtml(md)
    expect(html).not.toContain('class="vega-chart"')
    expect(html).toContain("<code")
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
