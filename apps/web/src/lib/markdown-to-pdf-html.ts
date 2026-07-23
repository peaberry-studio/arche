import fs from "node:fs"
import path from "node:path"

import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
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

const MAX_VEGA_CHARTS = 20

async function renderVegaLiteToSvg(spec: Record<string, unknown>): Promise<string> {
  const vega = await import("vega")
  const vegaLite = await import("vega-lite")

  const config = buildVegaConfig(FALLBACK_THEME)
  const specWithConfig = { ...spec, config }
  const compiled = vegaLite.compile(specWithConfig as Parameters<typeof vegaLite.compile>[0])
  const runtime = vega.parse(compiled.spec)
  const view = new vega.View(runtime, { renderer: "none" })
  try {
    return await view.toSVG()
  } finally {
    view.finalize()
  }
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

    const capped = targets.slice(0, MAX_VEGA_CHARTS)

    for (const target of capped) {
      let svg: string | null = null
      try {
        svg = await renderVegaLiteToSvg(target.spec)
      } catch {
        continue
      }

      target.parent.children[target.index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["vega-chart"] },
        children: [{ type: "raw", value: svg } as unknown as ElementContent],
      }
    }
  }
}

const pdfSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "svg", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "g", "defs", "clipPath", "use", "text", "tspan", "title", "desc",
    "linearGradient", "radialGradient", "stop", "pattern", "mask", "image",
    "marker",
    "span", "div",
  ],
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), "className", "style"],
    span: [...(defaultSchema.attributes?.span ?? []), "className", "style", "aria-hidden"],
    svg: ["xmlns", "viewBox", "width", "height", "class", "style", "role", "aria-*", "fill", "stroke", "overflow", "preserveAspectRatio"],
    path: ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "transform", "class", "style", "clip-path"],
    rect: ["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width", "opacity", "transform", "class", "style", "clip-path"],
    circle: ["cx", "cy", "r", "fill", "stroke", "stroke-width", "opacity", "transform", "class"],
    ellipse: ["cx", "cy", "rx", "ry", "fill", "stroke", "stroke-width", "opacity", "transform", "class"],
    line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width", "opacity", "transform", "class"],
    polyline: ["points", "fill", "stroke", "stroke-width", "opacity", "transform", "class"],
    polygon: ["points", "fill", "stroke", "stroke-width", "opacity", "transform", "class"],
    g: ["transform", "class", "style", "clip-path", "opacity", "fill", "stroke"],
    defs: [],
    clipPath: ["id"],
    use: ["href", "x", "y", "width", "height"],
    text: ["x", "y", "dx", "dy", "text-anchor", "dominant-baseline", "font-size", "font-family", "font-weight", "font-style", "fill", "opacity", "transform", "class", "style"],
    tspan: ["x", "y", "dx", "dy", "text-anchor", "font-size", "font-family", "font-weight", "fill", "class"],
    title: [],
    desc: [],
    linearGradient: ["id", "x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform"],
    radialGradient: ["id", "cx", "cy", "r", "fx", "fy", "gradientUnits"],
    stop: ["offset", "stop-color", "stop-opacity"],
    pattern: ["id", "x", "y", "width", "height", "patternUnits", "patternTransform"],
    mask: ["id", "x", "y", "width", "height", "maskUnits"],
    image: ["x", "y", "width", "height", "href", "preserveAspectRatio"],
    marker: ["id", "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits"],
  },
}

function loadKatexCss(): string {
  try {
    const katexDir = path.resolve(process.cwd(), "node_modules/katex/dist")
    let css = fs.readFileSync(path.join(katexDir, "katex.min.css"), "utf-8")
    css = css.replace(
      /url\(fonts\/([^)]+)\)/g,
      (_match: string, fontFile: string) => {
        const fontPath = path.join(katexDir, "fonts", fontFile)
        try {
          const fontData = fs.readFileSync(fontPath)
          const ext = path.extname(fontFile).slice(1)
          const mime = ext === "woff2" ? "font/woff2" : ext === "woff" ? "font/woff" : `font/${ext}`
          return `url(data:${mime};base64,${fontData.toString("base64")})`
        } catch {
          return `url(fonts/${fontFile})`
        }
      },
    )
    return css
  } catch {
    return ""
  }
}

const MARKDOWN_STYLES = `
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 9.5pt;
    line-height: 1.6;
    color: #1a1a1a;
    max-width: 100%;
    padding: 0;
    margin: 0;
  }

  h1 { font-size: 1.6em; font-weight: 600; margin: 1.5em 0 0.75em; }
  h1:first-child { margin-top: 0; }
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unified's .use() types break across a for-loop reassignment
  let processor: any = unified().use(remarkParse)
  for (const plugin of workspaceRemarkPlugins) processor = processor.use(plugin)
  processor = processor.use(remarkRehype)
  for (const plugin of workspaceRehypePlugins) processor = processor.use(plugin)
  processor = processor
    .use(rehypeSanitize, pdfSanitizeSchema)
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
