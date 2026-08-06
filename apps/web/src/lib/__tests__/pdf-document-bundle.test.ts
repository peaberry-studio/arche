import { describe, expect, it } from "vitest"

import {
  findDirectPdfDocumentPaths,
  getPdfDocumentAnchor,
  getPdfDocumentTitle,
  getPdfHeadingAnchor,
  resolvePdfInternalLink,
  slugifyPdfHeading,
} from "@/lib/pdf-document-bundle"

const AVAILABLE_PATHS = [
  "docs/main.md",
  "docs/alpha.md",
  "docs/nested/beta.md",
  "research/gamma.md",
]

describe("pdf-document-bundle", () => {
  it("resolves relative Markdown and vault-style Obsidian links", () => {
    expect(
      resolvePdfInternalLink(
        "nested/beta.md#Results",
        "docs/main.md",
        AVAILABLE_PATHS,
        "markdown",
      ),
    ).toEqual({
      kind: "resolved",
      heading: "Results",
      path: "docs/nested/beta.md",
    })

    expect(
      resolvePdfInternalLink(
        "gamma|Gamma report",
        "docs/main.md",
        AVAILABLE_PATHS,
        "obsidian",
      ),
    ).toEqual({
      kind: "resolved",
      heading: null,
      path: "research/gamma.md",
    })
  })

  it("distinguishes external and unresolved internal Markdown targets", () => {
    expect(
      resolvePdfInternalLink(
        "https://example.com/report",
        "docs/main.md",
        AVAILABLE_PATHS,
        "markdown",
      ),
    ).toEqual({ kind: "external" })
    expect(
      resolvePdfInternalLink(
        "missing.md",
        "docs/main.md",
        AVAILABLE_PATHS,
        "markdown",
      ),
    ).toEqual({ kind: "unresolved" })
    expect(
      resolvePdfInternalLink(
        "chart.png",
        "docs/main.md",
        AVAILABLE_PATHS,
        "markdown",
      ),
    ).toEqual({ kind: "external" })
  })

  it("collects direct documents in first-reference order and ignores code", () => {
    const markdown = [
      "First [[docs/alpha.md]], then [Beta](nested/beta.md).",
      "",
      "Again [[alpha]], then [[research/gamma.md]].",
      "",
      "`[[docs/ignored.md]]`",
      "",
      "```md",
      "[ignored](ignored.md)",
      "```",
    ].join("\n")

    expect(
      findDirectPdfDocumentPaths(markdown, "docs/main.md", [
        ...AVAILABLE_PATHS,
        "docs/ignored.md",
      ]),
    ).toEqual([
      "docs/alpha.md",
      "docs/nested/beta.md",
      "research/gamma.md",
    ])
  })

  it("does not collect self-links or recurse into appendix content", () => {
    expect(
      findDirectPdfDocumentPaths(
        "See [this section](#Intro) and [[docs/main.md]].",
        "docs/main.md",
        AVAILABLE_PATHS,
      ),
    ).toEqual([])
  })

  it("creates stable document and heading anchors", () => {
    expect(getPdfDocumentAnchor("docs/main.md")).toBe(
      getPdfDocumentAnchor("docs/main.md"),
    )
    expect(getPdfDocumentAnchor("docs/main.md")).not.toBe(
      getPdfDocumentAnchor("docs/alpha.md"),
    )
    expect(slugifyPdfHeading("Résumé: GPU / CPU")).toBe("resume-gpu-cpu")
    expect(getPdfHeadingAnchor("docs/main.md", "Main Results")).toMatch(
      /^document-[a-f0-9]{12}--main-results$/u,
    )
  })

  it("uses frontmatter, the first H1, and then the basename for titles", () => {
    expect(
      getPdfDocumentTitle({
        markdown: "---\ntitle: Frontmatter title\n---\n# Heading",
        path: "docs/report.md",
      }),
    ).toBe("Frontmatter title")
    expect(
      getPdfDocumentTitle({
        markdown: "# Heading title",
        path: "docs/report.md",
      }),
    ).toBe("Heading title")
    expect(
      getPdfDocumentTitle({
        markdown: "Body only",
        path: "docs/report.md",
      }),
    ).toBe("report")
  })

  it("extracts the first rendered H1 rather than Markdown syntax or fenced content", () => {
    expect(
      getPdfDocumentTitle({
        markdown: "```md\n# Ignored heading\n```\n\n# **Visible** title",
        path: "docs/report.md",
      }),
    ).toBe("Visible title")
  })
})
