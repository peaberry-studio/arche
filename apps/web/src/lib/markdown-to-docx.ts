import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  Math as DocxMath,
  MathRun,
  Packer,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type IParagraphOptions,
  type ISectionOptions,
  type ParagraphChild,
} from "docx"
import remarkParse from "remark-parse"
import sharp from "sharp"
import { unified } from "unified"

import { parseChartSpec } from "@/components/workspace/chat-panel/chart-output"
import {
  FALLBACK as FALLBACK_THEME,
  buildVegaConfig,
} from "@/components/workspace/chat-panel/visualization-theme"
import { parseMarkdownFrontmatter } from "@/components/workspace/markdown-frontmatter"
import { workspaceRemarkPlugins } from "@/components/workspace/markdown-plugins"
import {
  getDocxDocumentAnchor,
  getDocxHeadingAnchor,
} from "@/lib/docx-document-bundle"
import { findObsidianLinks } from "@/lib/kb-internal-links"
import {
  getObsidianPdfLinkLabel as getObsidianLinkLabel,
  getPdfDocumentTitle as getDocumentTitle,
  resolvePdfInternalLink as resolveInternalLink,
  type PdfDocumentBundle as DocumentBundle,
  type PdfSourceDocument as SourceDocument,
} from "@/lib/pdf-document-bundle"

type MarkdownNode = {
  type: string
  value?: string
  url?: string
  alt?: string
  lang?: string
  depth?: number
  ordered?: boolean
  start?: number | null
  checked?: boolean | null
  children?: MarkdownNode[]
  chart?: RenderedChart
}

type InlineStyle = {
  bold?: boolean
  italics?: boolean
  strike?: boolean
}

type RenderedChart = {
  data: Buffer
  height: number
  title: string
  width: number
}

type DocxRenderState = {
  availablePaths: string[]
  chartCount: number
  includedPaths: Set<string>
}

type DocxRenderContext = {
  document: SourceDocument
  headingOffset: number
  state: DocxRenderState
}

const BULLET_NUMBERING = "arche-bullets"
const ORDERED_NUMBERING = "arche-numbering"
const CODE_FONT = "Consolas"
const MAX_VEGA_CHARTS = 100
const MAX_CHART_WIDTH = 640
const MAX_CHART_HEIGHT = 760
const CHART_RASTER_SCALE = 3
const CHART_PADDING = 8
const TABLE_BORDER = { color: "D1D5DB", size: 4, style: BorderStyle.SINGLE }

function getNodeText(node: MarkdownNode): string {
  return `${node.value ?? ""}${node.children?.map(getNodeText).join("") ?? ""}`
}

function isSafeExternalUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:"
  } catch {
    return false
  }
}

function getVegaLiteTitle(spec: Record<string, unknown>): string {
  const title = spec.title
  if (typeof title === "string" && title.trim()) return title.trim()
  if (!title || typeof title !== "object" || Array.isArray(title)) return "Vega-Lite chart"

  const text = (title as Record<string, unknown>).text
  if (typeof text === "string" && text.trim()) return text.trim()
  if (Array.isArray(text)) {
    const lines = text.filter((line): line is string => typeof line === "string")
    if (lines.length > 0) return lines.join(" ")
  }

  return "Vega-Lite chart"
}

async function renderVegaLiteToPng(spec: Record<string, unknown>): Promise<RenderedChart> {
  const vega = await import("vega")
  const vegaLite = await import("vega-lite")
  const themeConfig = buildVegaConfig(FALLBACK_THEME)
  const specWithConfig = {
    ...spec,
    autosize: { contains: "padding", type: "pad" },
    config: {
      ...themeConfig,
      legend: {
        ...themeConfig.legend,
        labelLimit: 0,
        titleLimit: 0,
      },
    },
    padding: CHART_PADDING,
  }
  const compiled = vegaLite.compile(specWithConfig as Parameters<typeof vegaLite.compile>[0])
  const view = new vega.View(vega.parse(compiled.spec), { renderer: "none" })

  try {
    const svg = await view.toSVG()
    const rendered = await sharp(Buffer.from(svg), { density: 96 * CHART_RASTER_SCALE })
      .trim({ background: "#ffffff", threshold: 10 })
      .extend({
        background: "#ffffff",
        bottom: CHART_PADDING * CHART_RASTER_SCALE,
        left: CHART_PADDING * CHART_RASTER_SCALE,
        right: CHART_PADDING * CHART_RASTER_SCALE,
        top: CHART_PADDING * CHART_RASTER_SCALE,
      })
      .resize({
        fit: "inside",
        height: (MAX_CHART_HEIGHT - CHART_PADDING * 2) * CHART_RASTER_SCALE,
        width: (MAX_CHART_WIDTH - CHART_PADDING * 2) * CHART_RASTER_SCALE,
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true })

    return {
      data: rendered.data,
      height: Math.max(1, Math.round(rendered.info.height / CHART_RASTER_SCALE)),
      title: getVegaLiteTitle(spec),
      width: Math.max(1, Math.round(rendered.info.width / CHART_RASTER_SCALE)),
    }
  } finally {
    view.finalize()
  }
}

async function renderVegaLiteCharts(
  nodes: MarkdownNode[],
  state: DocxRenderState,
): Promise<void> {
  for (const node of nodes) {
    if (
      node.type === "code" &&
      node.lang === "vega-lite"
    ) {
      if (state.chartCount >= MAX_VEGA_CHARTS) {
        throw new Error("DOCX chart limit exceeded")
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(node.value?.trim() ?? "")
      } catch {
        parsed = null
      }

      const spec = parseChartSpec(parsed)
      if (spec) {
        try {
          node.chart = await renderVegaLiteToPng(spec)
          state.chartCount += 1
        } catch {
          node.chart = undefined
        }
      }
    }

    if (node.children) await renderVegaLiteCharts(node.children, state)
  }
}

function getIncludedLinkAnchor(
  rawTarget: string,
  syntax: "markdown" | "obsidian",
  context: DocxRenderContext,
): string | null {
  const resolved = resolveInternalLink(
    rawTarget,
    context.document.path,
    context.state.availablePaths,
    syntax,
  )
  if (resolved.kind !== "resolved") return null
  if (!context.state.includedPaths.has(resolved.path.toLowerCase())) return null

  return resolved.heading
    ? getDocxHeadingAnchor(resolved.path, resolved.heading)
    : getDocxDocumentAnchor(resolved.path)
}

function textChildren(
  value: string,
  style: InlineStyle,
  context?: DocxRenderContext,
): ParagraphChild[] {
  if (!context) return [new TextRun({ text: value, ...style })]

  const links = findObsidianLinks(value)
  if (links.length === 0) return [new TextRun({ text: value, ...style })]

  const children: ParagraphChild[] = []
  let cursor = 0
  for (const link of links) {
    if (link.from > cursor) {
      children.push(new TextRun({ text: value.slice(cursor, link.from), ...style }))
    }

    const label = getObsidianLinkLabel(link.target)
    const anchor = getIncludedLinkAnchor(link.target, "obsidian", context)
    children.push(
      anchor
        ? new InternalHyperlink({
            anchor,
            children: [new TextRun({ text: label, ...style, color: "2563EB" })],
          })
        : new TextRun({ text: label, ...style }),
    )
    cursor = link.to
  }

  if (cursor < value.length) {
    children.push(new TextRun({ text: value.slice(cursor), ...style }))
  }
  return children
}

function inlineChildren(
  nodes: MarkdownNode[],
  style: InlineStyle = {},
  context?: DocxRenderContext,
): ParagraphChild[] {
  return nodes.flatMap((node): ParagraphChild[] => {
    switch (node.type) {
      case "text":
        return textChildren(node.value ?? "", style, context)
      case "strong":
        return inlineChildren(node.children ?? [], { ...style, bold: true }, context)
      case "emphasis":
        return inlineChildren(node.children ?? [], { ...style, italics: true }, context)
      case "delete":
        return inlineChildren(node.children ?? [], { ...style, strike: true }, context)
      case "inlineCode":
        return [
          new TextRun({
            text: node.value ?? "",
            ...style,
            font: CODE_FONT,
            shading: { fill: "F3F4F6", type: ShadingType.CLEAR },
          }),
        ]
      case "inlineMath":
        return [new DocxMath({ children: [new MathRun(node.value ?? "")] })]
      case "link": {
        const anchor = context
          ? getIncludedLinkAnchor(node.url ?? "", "markdown", context)
          : null
        if (anchor) {
          return [
            new InternalHyperlink({
              anchor,
              children: inlineChildren(node.children ?? [], style, context),
            }),
          ]
        }
        if (!isSafeExternalUrl(node.url)) {
          return inlineChildren(node.children ?? [], style, context)
        }
        return [
          new ExternalHyperlink({
            link: node.url,
            children: inlineChildren(node.children ?? [], style, context),
          }),
        ]
      }
      case "image": {
        const label = node.alt?.trim() || "Image"
        if (!isSafeExternalUrl(node.url)) {
          return [new TextRun({ text: label, italics: true })]
        }
        return [
          new ExternalHyperlink({
            link: node.url,
            children: [new TextRun({ text: `${label} (${node.url})`, italics: true })],
          }),
        ]
      }
      case "break":
        return [new TextRun({ break: 1 })]
      case "html":
        return [new TextRun({ text: node.value ?? "", ...style })]
      default:
        return inlineChildren(node.children ?? [], style, context)
    }
  })
}

function paragraphFromInline(
  nodes: MarkdownNode[],
  options: IParagraphOptions = {},
  context?: DocxRenderContext,
): Paragraph {
  return new Paragraph({
    spacing: { after: 160, line: 300 },
    ...options,
    children: inlineChildren(nodes, {}, context),
  })
}

function listChildren(
  node: MarkdownNode,
  level: number,
  context?: DocxRenderContext,
): FileChild[] {
  const output: FileChild[] = []
  const reference = node.ordered ? ORDERED_NUMBERING : BULLET_NUMBERING

  for (const item of node.children ?? []) {
    const children = item.children ?? []
    let wroteFirstParagraph = false

    for (const child of children) {
      if (child.type === "list") {
        output.push(...listChildren(child, Math.min(level + 1, 8), context))
        continue
      }

      if (child.type !== "paragraph") {
        output.push(...blockChildren(child, level + 1, context))
        continue
      }

      const prefix = !wroteFirstParagraph && typeof item.checked === "boolean"
        ? [new TextRun({ text: item.checked ? "☒ " : "☐ " })]
        : []
      output.push(
        new Paragraph({
          children: [...prefix, ...inlineChildren(child.children ?? [], {}, context)],
          numbering: { reference, level },
          spacing: { after: 80, line: 280 },
        }),
      )
      wroteFirstParagraph = true
    }
  }

  return output
}

function tableFromNode(node: MarkdownNode, context?: DocxRenderContext): Table {
  const rows = (node.children ?? []).map((row, rowIndex) =>
    new TableRow({
      children: (row.children ?? []).map((cell) =>
        new TableCell({
          borders: {
            bottom: TABLE_BORDER,
            left: TABLE_BORDER,
            right: TABLE_BORDER,
            top: TABLE_BORDER,
          },
          shading: rowIndex === 0 ? { fill: "F3F4F6", type: ShadingType.CLEAR } : undefined,
          children: [
            new Paragraph({
              children: inlineChildren(
                cell.children ?? [],
                rowIndex === 0 ? { bold: true } : {},
                context,
              ),
              spacing: { after: 80, before: 80 },
            }),
          ],
        }),
      ),
    }),
  )

  return new Table({
    rows,
    layout: TableLayoutType.AUTOFIT,
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
}

function blockChildren(
  node: MarkdownNode,
  quoteDepth = 0,
  context?: DocxRenderContext,
): FileChild[] {
  const quoteOptions = quoteDepth > 0
    ? {
        border: { left: { color: "9CA3AF", size: 12, space: 8, style: BorderStyle.SINGLE } },
        indent: { left: quoteDepth * 360 },
      }
    : {}

  switch (node.type) {
    case "heading": {
      const levels = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4,
        HeadingLevel.HEADING_5,
        HeadingLevel.HEADING_6,
      ]
      const sourceDepth = node.depth ?? 1
      const depth = Math.min(6, sourceDepth + (context?.headingOffset ?? 0))
      const headingText = getNodeText(node)
        .replace(/\s+/gu, " ")
        .trim()
      const content = inlineChildren(node.children ?? [], {}, context)
      const headingChildren = context && headingText
        ? [
            new Bookmark({
              id: getDocxHeadingAnchor(context.document.path, headingText),
              children: content,
            }),
          ]
        : content
      return [
        new Paragraph({
          children: headingChildren,
          heading: levels[depth - 1],
          keepNext: true,
          spacing: { after: 160, before: depth === 1 ? 0 : 240 },
        }),
      ]
    }
    case "paragraph":
      return [paragraphFromInline(node.children ?? [], quoteOptions, context)]
    case "blockquote":
      return (node.children ?? []).flatMap((child) =>
        blockChildren(child, quoteDepth + 1, context),
      )
    case "list":
      return listChildren(node, 0, context)
    case "code": {
      if (node.chart) {
        return [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                altText: {
                  description: node.chart.title,
                  name: node.chart.title,
                  title: node.chart.title,
                },
                data: node.chart.data,
                transformation: {
                  height: node.chart.height,
                  width: node.chart.width,
                },
                type: "png",
              }),
            ],
            keepNext: true,
            spacing: { after: 180, before: 120 },
          }),
        ]
      }
      return [
        new Paragraph({
          children: [new TextRun({ text: node.value ?? "", font: CODE_FONT, size: 18 })],
          border: {
            bottom: TABLE_BORDER,
            left: TABLE_BORDER,
            right: TABLE_BORDER,
            top: TABLE_BORDER,
          },
          shading: { fill: "F3F4F6", type: ShadingType.CLEAR },
          spacing: { after: 180, before: 120, line: 260 },
        }),
      ]
    }
    case "math":
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new DocxMath({ children: [new MathRun(node.value ?? "")] })],
          spacing: { after: 180, before: 120 },
        }),
      ]
    case "table":
      return [tableFromNode(node, context), new Paragraph({ spacing: { after: 120 } })]
    case "thematicBreak":
      return [
        new Paragraph({
          border: { bottom: { color: "D1D5DB", size: 6, space: 8, style: BorderStyle.SINGLE } },
          spacing: { after: 160 },
        }),
      ]
    case "html":
      return [new Paragraph({ children: [new TextRun(node.value ?? "")] })]
    default:
      if (node.children) {
        return node.children.flatMap((child) => blockChildren(child, quoteDepth, context))
      }
      if (node.value) return [new Paragraph({ children: [new TextRun(node.value)] })]
      return []
  }
}

function numberingLevels(format: (typeof LevelFormat)[keyof typeof LevelFormat]) {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format,
    text: format === LevelFormat.BULLET ? "•" : `%${level + 1}.`,
    alignment: AlignmentType.START,
    style: {
      paragraph: {
        indent: { hanging: 360, left: 720 + level * 360 },
      },
    },
  }))
}

function documentAnchorParagraph(document: SourceDocument): Paragraph {
  return new Paragraph({
    children: [
      new Bookmark({
        id: getDocxDocumentAnchor(document.path),
        children: [new TextRun("")],
      }),
    ],
    spacing: { after: 0 },
  })
}

function getAppendixTitle(document: SourceDocument, primaryTitle: string): string {
  const documentTitle = getDocumentTitle(document)
  const primaryPrefix = `${primaryTitle} — `
  return documentTitle.startsWith(primaryPrefix)
    ? documentTitle.slice(primaryPrefix.length).trim()
    : documentTitle
}

async function sourceDocumentChildren(
  document: SourceDocument,
  headingOffset: number,
  state: DocxRenderState,
): Promise<FileChild[]> {
  const frontmatter = parseMarkdownFrontmatter(document.markdown)
  let processor = unified().use(remarkParse)
  for (const plugin of workspaceRemarkPlugins) processor = processor.use(plugin)
  const tree = processor.parse(frontmatter.body) as MarkdownNode
  const children = tree.children ?? []
  const documentTitle = getDocumentTitle(document)

  if (headingOffset > 0) {
    const titleHeadingIndex = children.findIndex(
      (node) =>
        node.type === "heading" &&
        node.depth === 1 &&
        getNodeText(node).replace(/\s+/gu, " ").trim() === documentTitle,
    )
    if (titleHeadingIndex >= 0) children.splice(titleHeadingIndex, 1)
  }

  await renderVegaLiteCharts(children, state)
  const context: DocxRenderContext = { document, headingOffset, state }
  return children.flatMap((node) => blockChildren(node, 0, context))
}

export async function markdownToDocx(
  input: string | DocumentBundle,
): Promise<Buffer> {
  const bundle: DocumentBundle = typeof input === "string"
    ? {
        appendices: [],
        availablePaths: ["article.md"],
        primary: { markdown: input, path: "article.md" },
      }
    : input
  const title = getDocumentTitle(bundle.primary)
  const state: DocxRenderState = {
    availablePaths: bundle.availablePaths,
    chartCount: 0,
    includedPaths: new Set(
      [bundle.primary, ...bundle.appendices].map((document) => document.path.toLowerCase()),
    ),
  }
  const primaryChildren = await sourceDocumentChildren(bundle.primary, 0, state)
  const sections: ISectionOptions[] = [
    {
      properties: {
        page: {
          margin: { bottom: 720, left: 1080, right: 1080, top: 1080 },
        },
      },
      children: [documentAnchorParagraph(bundle.primary), ...primaryChildren],
    },
  ]

  for (const appendix of bundle.appendices) {
    const sourceTitle = getDocumentTitle(appendix)
    const appendixTitle = `Appendix. ${getAppendixTitle(appendix, title)}`
    const content = await sourceDocumentChildren(appendix, 1, state)
    sections.push({
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          margin: { bottom: 720, left: 1080, right: 1080, top: 1080 },
        },
      },
      children: [
        documentAnchorParagraph(appendix),
        new Paragraph({
          children: [
            new Bookmark({
              id: getDocxHeadingAnchor(appendix.path, sourceTitle),
              children: [new TextRun(appendixTitle)],
            }),
          ],
          heading: HeadingLevel.HEADING_1,
          keepNext: true,
          spacing: { after: 160 },
        }),
        ...content,
      ],
    })
  }

  const document = new Document({
    creator: "Arche",
    title,
    numbering: {
      config: [
        { reference: BULLET_NUMBERING, levels: numberingLevels(LevelFormat.BULLET) },
        { reference: ORDERED_NUMBERING, levels: numberingLevels(LevelFormat.DECIMAL) },
      ],
    },
    sections,
    styles: {
      default: {
        document: {
          run: { font: "Aptos", size: 22 },
          paragraph: { spacing: { line: 300 } },
        },
      },
    },
  })

  return Packer.toBuffer(document)
}
