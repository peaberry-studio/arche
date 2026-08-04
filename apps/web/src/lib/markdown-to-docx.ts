import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Math as DocxMath,
  MathRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type ParagraphChild,
} from "docx"
import remarkParse from "remark-parse"
import { unified } from "unified"

import { parseMarkdownFrontmatter } from "@/components/workspace/markdown-frontmatter"
import { workspaceRemarkPlugins } from "@/components/workspace/markdown-plugins"

type MarkdownNode = {
  type: string
  value?: string
  url?: string
  alt?: string
  depth?: number
  ordered?: boolean
  start?: number | null
  checked?: boolean | null
  children?: MarkdownNode[]
}

type InlineStyle = {
  bold?: boolean
  italics?: boolean
  strike?: boolean
}

const BULLET_NUMBERING = "arche-bullets"
const ORDERED_NUMBERING = "arche-numbering"
const CODE_FONT = "Consolas"
const TABLE_BORDER = { color: "D1D5DB", size: 4, style: BorderStyle.SINGLE }

function isSafeExternalUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:"
  } catch {
    return false
  }
}

function inlineChildren(nodes: MarkdownNode[], style: InlineStyle = {}): ParagraphChild[] {
  return nodes.flatMap((node): ParagraphChild[] => {
    switch (node.type) {
      case "text":
        return [new TextRun({ text: node.value ?? "", ...style })]
      case "strong":
        return inlineChildren(node.children ?? [], { ...style, bold: true })
      case "emphasis":
        return inlineChildren(node.children ?? [], { ...style, italics: true })
      case "delete":
        return inlineChildren(node.children ?? [], { ...style, strike: true })
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
        if (!isSafeExternalUrl(node.url)) {
          return inlineChildren(node.children ?? [], style)
        }
        return [
          new ExternalHyperlink({
            link: node.url,
            children: inlineChildren(node.children ?? [], style),
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
        return inlineChildren(node.children ?? [], style)
    }
  })
}

function paragraphFromInline(
  nodes: MarkdownNode[],
  options: ConstructorParameters<typeof Paragraph>[0] = {},
): Paragraph {
  return new Paragraph({
    spacing: { after: 160, line: 300 },
    ...options,
    children: inlineChildren(nodes),
  })
}

function listChildren(node: MarkdownNode, level: number): FileChild[] {
  const output: FileChild[] = []
  const reference = node.ordered ? ORDERED_NUMBERING : BULLET_NUMBERING

  for (const item of node.children ?? []) {
    const children = item.children ?? []
    let wroteFirstParagraph = false

    for (const child of children) {
      if (child.type === "list") {
        output.push(...listChildren(child, Math.min(level + 1, 8)))
        continue
      }

      if (child.type !== "paragraph") {
        output.push(...blockChildren(child, level + 1))
        continue
      }

      const prefix = !wroteFirstParagraph && typeof item.checked === "boolean"
        ? [new TextRun({ text: item.checked ? "☒ " : "☐ " })]
        : []
      output.push(
        new Paragraph({
          children: [...prefix, ...inlineChildren(child.children ?? [])],
          numbering: { reference, level },
          spacing: { after: 80, line: 280 },
        }),
      )
      wroteFirstParagraph = true
    }
  }

  return output
}

function tableFromNode(node: MarkdownNode): Table {
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
              children: inlineChildren(cell.children ?? [], rowIndex === 0 ? { bold: true } : {}),
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

function blockChildren(node: MarkdownNode, quoteDepth = 0): FileChild[] {
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
      return [
        paragraphFromInline(node.children ?? [], {
          heading: levels[Math.min(Math.max((node.depth ?? 1) - 1, 0), 5)],
          keepNext: true,
          spacing: { after: 160, before: node.depth === 1 ? 0 : 240 },
        }),
      ]
    }
    case "paragraph":
      return [paragraphFromInline(node.children ?? [], quoteOptions)]
    case "blockquote":
      return (node.children ?? []).flatMap((child) => blockChildren(child, quoteDepth + 1))
    case "list":
      return listChildren(node, 0)
    case "code":
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
    case "math":
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new DocxMath({ children: [new MathRun(node.value ?? "")] })],
          spacing: { after: 180, before: 120 },
        }),
      ]
    case "table":
      return [tableFromNode(node), new Paragraph({ spacing: { after: 120 } })]
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
      if (node.children) return node.children.flatMap((child) => blockChildren(child, quoteDepth))
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

export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const frontmatter = parseMarkdownFrontmatter(markdown)
  let processor = unified().use(remarkParse)
  for (const plugin of workspaceRemarkPlugins) processor = processor.use(plugin)
  const tree = processor.parse(frontmatter.body) as MarkdownNode
  const titleProperty = frontmatter.properties.find(
    (property) => property.key.toLowerCase() === "title" && property.type === "string",
  )
  const document = new Document({
    creator: "Arche",
    title: titleProperty?.value,
    numbering: {
      config: [
        { reference: BULLET_NUMBERING, levels: numberingLevels(LevelFormat.BULLET) },
        { reference: ORDERED_NUMBERING, levels: numberingLevels(LevelFormat.DECIMAL) },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { bottom: 720, left: 1080, right: 1080, top: 1080 },
          },
        },
        children: (tree.children ?? []).flatMap((node) => blockChildren(node)),
      },
    ],
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
