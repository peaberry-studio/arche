import fs from "node:fs"
import path from "node:path"

import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import rehypeStringify from "rehype-stringify"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import type { Element, ElementContent, Root, RootContent, Text } from "hast"
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
import { findObsidianLinks } from "@/lib/kb-internal-links"
import {
  getObsidianPdfLinkLabel,
  getPdfDocumentAnchor,
  getPdfDocumentTitle,
  getPdfHeadingAnchor,
  resolvePdfInternalLink,
  type PdfDocumentBundle,
  type PdfSourceDocument,
} from "@/lib/pdf-document-bundle"

const MAX_VEGA_CHARTS = 20
const MAX_DATA_IMAGE_BYTES = 4 * 1024 * 1024
const DATA_IMAGE_REGEX = /^data:(image\/(?:gif|jpeg|png|webp));base64,([a-z\d+/]+={0,2})$/iu

type PdfHeadingEntry = {
  id: string
  label: string
  level: number
}

type PdfFigureEntry = {
  id: string
  label: string
  number: number
}

type PdfRenderState = {
  availablePaths: string[]
  figureCount: number
  figures: PdfFigureEntry[]
  headings: PdfHeadingEntry[]
  includedPaths: Set<string>
  usedIds: Set<string>
  vegaChartCount: number
}

type PdfDocumentRenderContext = {
  document: PdfSourceDocument
  headingOffset: number
  state: PdfRenderState
}

function getAbortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error("pdf_export_aborted")
}

function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(getAbortReason(signal))

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(getAbortReason(signal))
    signal.addEventListener("abort", abort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

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

function getVegaLiteTitle(spec: Record<string, unknown>): string {
  const title = spec.title
  if (typeof title === "string" && title.trim()) return title.trim()
  if (!title || typeof title !== "object" || Array.isArray(title)) return "Untitled figure"

  const text = (title as Record<string, unknown>).text
  if (typeof text === "string" && text.trim()) return text.trim()
  if (Array.isArray(text)) {
    const lines = text.filter((line): line is string => typeof line === "string")
    if (lines.length > 0) return lines.join(" ")
  }

  return "Untitled figure"
}

function normalizeFigureLabel(label: string): string {
  const withoutNumber = label.replace(
    /^figure\s+\d+\s*(?:[.:\-–—]\s*)?/iu,
    "",
  )
  return withoutNumber.trim() || "Untitled figure"
}

function createPdfFigure(content: ElementContent[], label: string): Element {
  return {
    type: "element",
    tagName: "figure",
    properties: {
      className: ["pdf-figure"],
      dataPdfFigureLabel: label,
    },
    children: [
      {
        type: "element",
        tagName: "div",
        properties: { className: ["pdf-figure-content"] },
        children: content,
      },
    ],
  }
}

function isValidDataImageSource(value: unknown): value is string {
  if (typeof value !== "string") return false

  const match = DATA_IMAGE_REGEX.exec(value)
  const base64 = match?.[2]
  if (!base64 || base64.length % 4 !== 0) return false

  const content = Buffer.from(base64, "base64")
  return (
    content.length > 0 &&
    content.length <= MAX_DATA_IMAGE_BYTES &&
    content.toString("base64") === base64
  )
}

function rehypeValidateDataImages() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      const element = node as Element
      if (element.tagName !== "img") return

      const source = element.properties.src
      if (typeof source === "string" && source.startsWith("data:") && !isValidDataImageSource(source)) {
        delete element.properties.src
      }
    })
  }
}

function rehypeVegaLiteToSvg(state: PdfRenderState, signal?: AbortSignal) {
  return async (tree: Root) => {
    const targets: VegaLiteTarget[] = []

    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre" || index == null || !parent) return

      const spec = extractVegaLiteSpec(node)
      if (!spec) return

      targets.push({ parent: parent as Element | Root, index, spec })
    })

    if (targets.length === 0) return

    const capped = targets.slice(
      0,
      Math.max(0, MAX_VEGA_CHARTS - state.vegaChartCount),
    )

    for (const target of capped) {
      state.vegaChartCount += 1
      let svg: string | null = null
      try {
        svg = await withAbort(renderVegaLiteToSvg(target.spec), signal)
      } catch {
        continue
      }

      target.parent.children[target.index] = {
        ...createPdfFigure(
          [
            {
              type: "element",
              tagName: "div",
              properties: { className: ["vega-chart"] },
              children: [{ type: "raw", value: svg } as unknown as ElementContent],
            },
          ],
          getVegaLiteTitle(target.spec),
        ),
      }
    }
  }
}

function getElementText(node: Element): string {
  let value = ""

  visit(node, "text", (child) => {
    value += (child as Text).value
  })

  return value.replace(/\s+/gu, " ").trim()
}

function removeAppendixDocumentTitleHeading(
  tree: Root,
  context: PdfDocumentRenderContext,
): void {
  if (context.headingOffset === 0) return

  const documentTitle = getPdfDocumentTitle(context.document)
    .replace(/\s+/gu, " ")
    .trim()
  const initialContentIndex = tree.children.findIndex(
    (child) => child.type !== "text" || child.value.trim(),
  )
  const initialContent = tree.children[initialContentIndex]
  if (
    initialContent?.type === "element" &&
    initialContent.tagName === "h1" &&
    getElementText(initialContent) === documentTitle
  ) {
    tree.children.splice(initialContentIndex, 1)
  }
}

function getIncludedLinkHref(
  rawTarget: string,
  syntax: "markdown" | "obsidian",
  context: PdfDocumentRenderContext,
): string | null {
  const resolved = resolvePdfInternalLink(
    rawTarget,
    context.document.path,
    context.state.availablePaths,
    syntax,
  )
  if (resolved.kind !== "resolved") return null
  if (!context.state.includedPaths.has(resolved.path.toLowerCase())) return null

  return resolved.heading
    ? `#${getPdfHeadingAnchor(resolved.path, resolved.heading)}`
    : `#${getPdfDocumentAnchor(resolved.path)}`
}

function rewriteMarkdownLinks(
  node: Element | Root,
  context: PdfDocumentRenderContext,
): void {
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]
    if (child.type !== "element") continue

    if (child.tagName === "a") {
      const href = child.properties.href
      if (typeof href !== "string") continue

      const resolved = resolvePdfInternalLink(
        href,
        context.document.path,
        context.state.availablePaths,
        "markdown",
      )
      if (resolved.kind === "external") continue

      const internalHref = getIncludedLinkHref(href, "markdown", context)
      if (internalHref) {
        child.properties.href = internalHref
        continue
      }

      node.children.splice(index, 1, ...child.children)
      index += child.children.length - 1
      continue
    }

    rewriteMarkdownLinks(child, context)
  }
}

function rewriteObsidianLinks(
  node: Element | Root,
  context: PdfDocumentRenderContext,
): void {
  if (
    node.type === "element" &&
    (node.tagName === "a" || node.tagName === "code" || node.tagName === "pre")
  ) {
    return
  }

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]
    if (child.type === "element") {
      rewriteObsidianLinks(child, context)
      continue
    }
    if (child.type !== "text") continue

    const links = findObsidianLinks(child.value)
    if (links.length === 0) continue

    const replacements: RootContent[] = []
    let cursor = 0
    for (const link of links) {
      if (link.from > cursor) {
        replacements.push({
          type: "text",
          value: child.value.slice(cursor, link.from),
        })
      }

      const label = getObsidianPdfLinkLabel(link.target)
      const href = getIncludedLinkHref(link.target, "obsidian", context)
      if (href) {
        replacements.push({
          type: "element",
          tagName: "a",
          properties: { href },
          children: [{ type: "text", value: label }],
        })
      } else {
        replacements.push({ type: "text", value: label })
      }
      cursor = link.to
    }

    if (cursor < child.value.length) {
      replacements.push({ type: "text", value: child.value.slice(cursor) })
    }

    node.children.splice(index, 1, ...replacements)
    index += replacements.length - 1
  }
}

function addHeadingAnchors(
  tree: Root,
  context: PdfDocumentRenderContext,
): void {
  visit(tree, "element", (node) => {
    const element = node as Element
    const match = /^h([1-6])$/u.exec(element.tagName)
    if (!match) return

    const sourceLevel = Number(match[1])
    const level = Math.min(6, sourceLevel + context.headingOffset)
    element.tagName = `h${level}`

    const label = getElementText(element)
    if (!label) return

    const id = getUniquePdfId(
      getPdfHeadingAnchor(context.document.path, label),
      context.state,
    )
    element.properties.id = id

    if (level <= 3) {
      context.state.headings.push({ id, label, level })
    }
  })
}

function getUniquePdfId(baseId: string, state: PdfRenderState): string {
  let id = baseId
  let suffix = 2
  while (state.usedIds.has(id)) {
    id = `${baseId}-${suffix}`
    suffix += 1
  }
  state.usedIds.add(id)
  return id
}

function registerPdfFigures(
  node: Element | Root,
  state: PdfRenderState,
): void {
  for (let index = 0; index < node.children.length; index += 1) {
    let child = node.children[index]
    if (child.type !== "element") continue

    if (child.tagName === "p") {
      const meaningfulChildren = child.children.filter(
        (paragraphChild) =>
          paragraphChild.type !== "text" || paragraphChild.value.trim().length > 0,
      )
      const onlyChild =
        meaningfulChildren.length === 1 ? meaningfulChildren[0] : null
      const image =
        onlyChild?.type === "element" && onlyChild.tagName === "img"
          ? onlyChild
          : onlyChild?.type === "element" &&
              onlyChild.tagName === "a" &&
              onlyChild.children.length === 1 &&
              onlyChild.children[0].type === "element" &&
              onlyChild.children[0].tagName === "img"
            ? onlyChild.children[0]
            : null

      if (image) {
        const alt = image.properties.alt
        const label =
          typeof alt === "string" && alt.trim()
            ? alt.trim()
            : "Untitled figure"
        child = createPdfFigure(child.children as ElementContent[], label)
        node.children[index] = child
      }
    }

    const classes = child.properties.className
    if (
      child.tagName === "figure" &&
      Array.isArray(classes) &&
      classes.includes("pdf-figure")
    ) {
      const rawLabel = child.properties.dataPdfFigureLabel
      const label =
        typeof rawLabel === "string" ? rawLabel : "Untitled figure"
      state.figureCount += 1
      const id = `figure-${state.figureCount}`
      state.figures.push({
        id,
        label: normalizeFigureLabel(label),
        number: state.figureCount,
      })
      child.properties.id = id
      child.properties.dataFigureId = id
      delete child.properties.dataPdfFigureLabel
      continue
    }

    registerPdfFigures(child, state)
  }
}

function rehypePdfDocumentSemantics(context: PdfDocumentRenderContext) {
  return (tree: Root) => {
    removeAppendixDocumentTitleHeading(tree, context)
    rewriteMarkdownLinks(tree, context)
    rewriteObsidianLinks(tree, context)
    addHeadingAnchors(tree, context)
    registerPdfFigures(tree, context.state)
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
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data"],
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
    height: auto;
  }

  .katex-display {
    overflow-x: auto;
    break-inside: avoid;
  }

  .vega-chart {
    text-align: center;
  }

  .vega-chart svg {
    height: auto;
    max-width: 100%;
    width: 100%;
  }

  .pdf-running-header {
    position: running(pdf-header);
    text-align: center;
  }

  .pdf-running-header img {
    height: 22px;
    opacity: 0.35;
    width: 22px;
  }

  .pdf-navigation {
    break-after: page;
  }

  .pdf-navigation h1 {
    margin-top: 0;
  }

  .pdf-navigation ul {
    list-style: none;
    padding-left: 0;
  }

  .pdf-navigation li {
    break-inside: avoid;
    margin: 0.35em 0;
  }

  .pdf-navigation li[data-level="2"] {
    padding-left: 1.25em;
  }

  .pdf-navigation li[data-level="3"] {
    padding-left: 2.5em;
  }

  .pdf-navigation a {
    display: flex;
    gap: 0.75em;
    justify-content: space-between;
  }

  .pdf-navigation a::after {
    color: #666;
    content: target-counter(attr(href), page);
    flex: 0 0 auto;
  }

  .pdf-document {
    max-width: 100%;
  }

  .pdf-appendix {
    break-before: page;
  }

  .pdf-figure {
    break-inside: avoid;
    margin: 0.75em 0;
    text-align: center;
    width: 100%;
  }

  .pdf-figure-content {
    margin: 0 auto;
    max-width: 100%;
  }

  .pdf-figure-content img,
  .pdf-figure-content svg {
    max-height: 23cm;
    object-fit: contain;
  }

  .pdf-figure-content > img {
    display: block;
    margin: 0 auto;
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
    margin: 2cm 1.5cm 1cm;

    @top-center {
      content: element(pdf-header);
      vertical-align: middle;
    }

    @bottom-center {
      color: #999;
      content: counter(page) " / " counter(pages);
      font-size: 9px;
      vertical-align: middle;
    }
  }

  @media print {
    h1, h2, h3, h4, h5, h6 {
      break-after: avoid;
    }
    pre, table, .pdf-figure, .katex-display {
      break-inside: avoid;
    }
  }
`

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;")
}

function getAppendixSectionTitle(
  document: PdfSourceDocument,
  primaryTitle: string,
): string {
  const documentTitle = getPdfDocumentTitle(document)
  const primaryTitlePrefix = `${primaryTitle} — `

  return documentTitle.startsWith(primaryTitlePrefix)
    ? documentTitle.slice(primaryTitlePrefix.length).trim()
    : documentTitle
}

async function renderPdfSourceDocument(
  document: PdfSourceDocument,
  headingOffset: number,
  state: PdfRenderState,
  signal?: AbortSignal,
): Promise<string> {
  const frontmatter = parseMarkdownFrontmatter(document.markdown)
  const context: PdfDocumentRenderContext = { document, headingOffset, state }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unified's .use() types break across a for-loop reassignment
  let processor: any = unified().use(remarkParse)
  for (const plugin of workspaceRemarkPlugins) processor = processor.use(plugin)
  processor = processor.use(remarkRehype)
  for (const plugin of workspaceRehypePlugins) processor = processor.use(plugin)
  processor = processor
    .use(rehypeValidateDataImages)
    .use(rehypeSanitize, pdfSanitizeSchema)
    .use(rehypeVegaLiteToSvg, state, signal)
    .use(() => rehypePdfDocumentSemantics(context))
    .use(rehypeStringify, { allowDangerousHtml: true })

  const result = await withAbort(processor.process(frontmatter.body), signal)
  return String(result)
}

function buildTableOfContents(headings: PdfHeadingEntry[]): string {
  if (headings.length === 0) return ""

  const entries = headings
    .map(
      (heading) => `
      <li data-level="${heading.level}">
        <a href="#${escapeHtml(heading.id)}"><span>${escapeHtml(heading.label)}</span></a>
      </li>`,
    )
    .join("")

  return `
  <nav class="pdf-navigation pdf-table-of-contents" aria-label="Table of Contents">
    <h1>Table of Contents</h1>
    <ul>${entries}
    </ul>
  </nav>`
}

function buildTableOfFigures(figures: PdfFigureEntry[]): string {
  if (figures.length === 0) return ""

  const entries = figures
    .map(
      (figure) => `
      <li data-level="1">
        <a href="#${escapeHtml(figure.id)}"><span>Figure ${figure.number}. ${escapeHtml(figure.label)}</span></a>
      </li>`,
    )
    .join("")

  return `
  <nav class="pdf-navigation pdf-table-of-figures" aria-label="Table of Figures">
    <h1>Table of Figures</h1>
    <ul>${entries}
    </ul>
  </nav>`
}

export async function markdownToPdfHtml(
  bundle: PdfDocumentBundle,
  options?: { logoBase64?: string; signal?: AbortSignal },
): Promise<string> {
  const title = getPdfDocumentTitle(bundle.primary)
  const state: PdfRenderState = {
    availablePaths: bundle.availablePaths,
    figureCount: 0,
    figures: [],
    headings: [],
    includedPaths: new Set(
      [bundle.primary, ...bundle.appendices].map((document) =>
        document.path.toLowerCase(),
      ),
    ),
    usedIds: new Set(),
    vegaChartCount: 0,
  }
  const primaryDocumentId = getUniquePdfId(
    getPdfDocumentAnchor(bundle.primary.path),
    state,
  )
  const primaryHtml = await renderPdfSourceDocument(bundle.primary, 0, state, options?.signal)
  const appendixHtml: string[] = []

  for (const appendix of bundle.appendices) {
    const appendixTitle = `Appendix. ${getAppendixSectionTitle(appendix, title)}`
    const appendixDocumentId = getUniquePdfId(
      getPdfDocumentAnchor(appendix.path),
      state,
    )
    const appendixHeadingId = getUniquePdfId(
      `${getPdfDocumentAnchor(appendix.path)}--appendix`,
      state,
    )
    const documentTitleHeadingId = getUniquePdfId(
      getPdfHeadingAnchor(appendix.path, getPdfDocumentTitle(appendix)),
      state,
    )
    state.headings.push({
      id: appendixHeadingId,
      label: appendixTitle,
      level: 1,
    })

    const content = await renderPdfSourceDocument(appendix, 1, state, options?.signal)
    appendixHtml.push(`
    <article
      class="pdf-document pdf-appendix-section"
      data-document-path="${escapeHtml(appendix.path)}"
       id="${escapeHtml(appendixDocumentId)}"
    >
      <span id="${escapeHtml(documentTitleHeadingId)}"></span>
      <h1 id="${escapeHtml(appendixHeadingId)}">${escapeHtml(appendixTitle)}</h1>
      ${content}
    </article>`)
  }

  const katexCss = loadKatexCss()
  const logo = options?.logoBase64
    ? `<div class="pdf-running-header"><img alt="" src="data:image/svg+xml;base64,${escapeHtml(options.logoBase64)}" /></div>`
    : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${katexCss}</style>
  <style>${MARKDOWN_STYLES}</style>
</head>
<body>
  ${logo}
  ${buildTableOfContents(state.headings)}
  ${buildTableOfFigures(state.figures)}
  <main class="markdown-content">
    <article
      class="pdf-document pdf-primary-document"
      data-document-path="${escapeHtml(bundle.primary.path)}"
       id="${escapeHtml(primaryDocumentId)}"
    >
      ${primaryHtml}
    </article>
    ${appendixHtml.length > 0 ? `<section class="pdf-appendix">${appendixHtml.join("")}
    </section>` : ""}
  </main>
</body>
</html>`
}
