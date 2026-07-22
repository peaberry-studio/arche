import fs from "node:fs"
import path from "node:path"

import rehypeStringify from "rehype-stringify"
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
import {
  workspaceRehypePlugins,
  workspaceRemarkPlugins,
} from "@/components/workspace/markdown-plugins"

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

type VegaLiteTarget = {
  parent: Element | Root
  index: number
  spec: Record<string, unknown>
}

function extractVegaLiteSpec(preNode: Element): Record<string, unknown> | null {
  const codeChild = preNode.children.find(
    (c): c is Element => c.type === "element" && (c as Element).tagName === "code",
  ) as Element | undefined
  if (!codeChild) return null

  const classes = codeChild.properties?.className
  if (!Array.isArray(classes) || !classes.includes("language-vega-lite")) return null

  const textChild = codeChild.children.find(
    (c): c is { type: "text"; value: string } => c.type === "text",
  )
  if (!textChild) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(textChild.value.trim())
  } catch {
    return null
  }

  return parseChartSpec(parsed)
}

function rehypeVegaLiteToSvg() {
  return async (tree: Root) => {
    const targets: VegaLiteTarget[] = []

    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre" || index == null || !parent) return

      const spec = extractVegaLiteSpec(node)
      if (!spec) return

      targets.push({ parent: parent as Element | Root, index, spec })
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

      const { parent, index } = targets[i]
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["vega-chart"] },
        children: [{ type: "raw", value: svg } as unknown as ElementContent],
      }
    }
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

  let processor = unified().use(remarkParse)
  for (const plugin of workspaceRemarkPlugins) processor = processor.use(plugin)
  processor = processor.use(remarkRehype, { allowDangerousHtml: true })
  for (const plugin of workspaceRehypePlugins) processor = processor.use(plugin)
  processor = processor
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
