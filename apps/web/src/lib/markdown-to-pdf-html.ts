import fs from "node:fs"
import path from "node:path"

import rehypeKatex from "rehype-katex"
import rehypeStringify from "rehype-stringify"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import type { Root, Element, ElementContent } from "hast"
import { visit } from "unist-util-visit"

import { parseChartSpec } from "@/components/workspace/chat-panel/chart-output"
import {
  FALLBACK as FALLBACK_THEME,
  buildVegaConfig,
} from "@/components/workspace/chat-panel/visualization-theme"
import { parseMarkdownFrontmatter } from "@/components/workspace/markdown-frontmatter"
import remarkBracketMath from "@/components/workspace/remark-bracket-math"

async function renderVegaLiteToSvg(spec: Record<string, unknown>): Promise<string> {
  const vega = await import("vega")
  const vegaLite = await import("vega-lite")

  const config = buildVegaConfig(FALLBACK_THEME)
  const specWithConfig = { ...spec, config }
  const compiled = vegaLite.compile(specWithConfig as Parameters<typeof vegaLite.compile>[0])
  const runtime = vega.parse(compiled.spec)
  const view = new vega.View(runtime, { renderer: "none" })
  const svg = await view.toSVG()
  view.finalize()
  return svg
}

type VegaLiteReplacement = {
  codeNode: Element
  spec: Record<string, unknown>
}

function rehypeVegaLiteToSvg() {
  return async (tree: Root) => {
    const targets: VegaLiteReplacement[] = []

    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "code") return
      const classes = node.properties?.className
      if (!Array.isArray(classes) || !classes.includes("language-vega-lite")) return

      const textChild = node.children.find(
        (c: ElementContent): c is { type: "text"; value: string } => c.type === "text",
      )
      if (!textChild) return

      let parsed: unknown
      try {
        parsed = JSON.parse(textChild.value.trim())
      } catch {
        return
      }

      const spec = parseChartSpec(parsed)
      if (!spec) return

      targets.push({ codeNode: node, spec })
    })

    if (targets.length === 0) return

    const svgs = await Promise.all(
      targets.map(async ({ spec }) => {
        try {
          return await renderVegaLiteToSvg(spec)
        } catch {
          return null
        }
      }),
    )

    for (let i = 0; i < targets.length; i++) {
      const svg = svgs[i]
      if (!svg) continue

      const { codeNode } = targets[i]
      const replacement: Element = {
        type: "element",
        tagName: "div",
        properties: { className: ["vega-chart"] },
        children: [{ type: "raw", value: svg } as unknown as ElementContent],
      }

      replaceInTree(tree, codeNode, replacement)
    }
  }
}

function replaceInTree(tree: Root, target: Element, replacement: Element): void {
  visit(tree, "element", (node: Element) => {
    if (!Array.isArray(node.children)) return

    const index = node.children.indexOf(target as ElementContent)
    if (index === -1) return

    // If the code node is inside a <pre>, replace the <pre> in its parent
    if (node.tagName === "pre") {
      replaceInTree(tree, node, replacement)
    } else {
      node.children[index] = replacement
    }
  })

  const rootIndex = tree.children.indexOf(target as ElementContent)
  if (rootIndex !== -1) {
    tree.children[rootIndex] = replacement
  }
}

function loadKatexCss(): string {
  try {
    const katexCssPath = path.resolve(
      process.cwd(),
      "node_modules/katex/dist/katex.min.css",
    )
    return fs.readFileSync(katexCssPath, "utf-8")
  } catch {
    return ""
  }
}

const MARKDOWN_STYLES = `
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #1a1a1a;
    max-width: 100%;
    padding: 0;
    margin: 0;
  }

  h1 { font-size: 1.6em; font-weight: 600; margin: 1.5em 0 0.75em; }
  h2 { font-size: 1.35em; font-weight: 600; margin: 1.25em 0 0.5em; }
  h3 { font-size: 1.15em; font-weight: 600; margin: 1em 0 0.5em; }
  h4, h5, h6 { font-size: 1em; font-weight: 600; margin: 0.75em 0 0.25em; }

  p { margin: 0.5em 0; }

  ul { margin: 0.5em 0; padding-left: 1.5em; list-style-type: disc; }
  ol { margin: 0.5em 0; padding-left: 1.5em; list-style-type: decimal; }
  li { margin: 0.25em 0; }

  pre {
    margin: 0.75em 0;
    padding: 0.75em;
    background: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.9em;
    break-inside: avoid;
  }

  code {
    background: #f5f5f5;
    padding: 0.15em 0.4em;
    border-radius: 3px;
    font-size: 0.9em;
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
  }

  pre code {
    background: transparent;
    padding: 0;
  }

  table {
    margin: 0.75em 0;
    width: 100%;
    border-collapse: collapse;
    break-inside: avoid;
    font-size: 0.95em;
  }

  th, td {
    border: 1px solid #d0d0d0;
    padding: 0.5em 0.75em;
    text-align: left;
  }

  th {
    background: #f5f5f5;
    font-weight: 500;
  }

  blockquote {
    margin: 0.75em 0;
    padding-left: 1em;
    border-left: 3px solid #d0d0d0;
    color: #555;
    font-style: italic;
  }

  hr {
    margin: 1em 0;
    border: none;
    border-top: 1px solid #d0d0d0;
  }

  a {
    color: #1a73e8;
    text-decoration: none;
  }

  img {
    max-width: 100%;
    margin: 0.75em 0;
  }

  .katex-display {
    overflow-x: auto;
    break-inside: avoid;
  }

  .vega-chart {
    margin: 0.75em 0;
    break-inside: avoid;
    text-align: center;
  }

  .vega-chart svg {
    max-width: 100%;
  }

  .contains-task-list {
    list-style: none;
    padding-left: 0;
  }

  .task-list-item {
    list-style: none;
    display: flex;
    align-items: flex-start;
    gap: 0.4em;
  }

  .task-list-item input[type="checkbox"] {
    margin-top: 0.3em;
  }

  @page {
    margin: 1cm 1.5cm;
    size: A4;
  }

  @media print {
    h1, h2, h3, h4, h5, h6 {
      break-after: avoid;
    }
    pre, table, .vega-chart, .katex-display {
      break-inside: avoid;
    }
  }
`

export async function markdownToPdfHtml(markdown: string): Promise<string> {
  const frontmatter = parseMarkdownFrontmatter(markdown)
  const katexCss = loadKatexCss()

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkBracketMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex)
    .use(rehypeVegaLiteToSvg)
    .use(rehypeStringify, { allowDangerousHtml: true })

  const result = await processor.process(frontmatter.body)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>${katexCss}</style>
  <style>${MARKDOWN_STYLES}</style>
</head>
<body>
  <div class="markdown-content">
    ${String(result)}
  </div>
</body>
</html>`
}
