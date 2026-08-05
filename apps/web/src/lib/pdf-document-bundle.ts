import { createHash } from "node:crypto"
import path from "node:path"

import remarkParse from "remark-parse"
import { unified } from "unified"
import { visit } from "unist-util-visit"

import { parseMarkdownFrontmatter } from "@/components/workspace/markdown-frontmatter"
import {
  findObsidianLinks,
  getObsidianLinkDisplayLabel,
  getObsidianLinkFullPath,
  resolveObsidianLinkTarget,
} from "@/lib/kb-internal-links"
import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export type PdfSourceDocument = {
  markdown: string
  path: string
}

export type PdfDocumentBundle = {
  appendices: PdfSourceDocument[]
  availablePaths: string[]
  primary: PdfSourceDocument
}

export type PdfInternalLink =
  | { kind: "external" }
  | { kind: "resolved"; heading: string | null; path: string }
  | { kind: "unresolved" }

type MarkdownLinkNode = {
  type: "link"
  url: string
}

type MarkdownTextNode = {
  type: "text"
  value: string
}

type MarkdownAstNode = {
  children?: MarkdownAstNode[]
  depth?: number
  type: string
  value?: string
}

const EXTERNAL_SCHEME_REGEX = /^[a-z][a-z\d+.-]*:/iu

function decodeLinkValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function stripMarkdownExtension(value: string): string {
  return value.toLowerCase().endsWith(".md") ? value.slice(0, -3) : value
}

function normalizeLookupKey(value: string): string {
  return stripMarkdownExtension(normalizeWorkspacePath(value)).toLowerCase()
}

function splitLinkTarget(rawTarget: string): { heading: string | null; path: string } {
  const hashIndex = rawTarget.indexOf("#")
  if (hashIndex < 0) {
    return { heading: null, path: decodeLinkValue(rawTarget.trim()) }
  }

  const heading = decodeLinkValue(rawTarget.slice(hashIndex + 1).trim())
  return {
    heading: heading || null,
    path: decodeLinkValue(rawTarget.slice(0, hashIndex).trim()),
  }
}

function findAvailablePath(candidate: string, availablePaths: string[]): string | null {
  const lookupKey = normalizeLookupKey(candidate)
  if (!lookupKey) return null

  return (
    availablePaths.find((availablePath) => normalizeLookupKey(availablePath) === lookupKey) ??
    null
  )
}

function resolveRelativePath(
  rawPath: string,
  sourcePath: string,
  availablePaths: string[],
): string | null {
  const sourceDirectory = path.posix.dirname(normalizeWorkspacePath(sourcePath))
  const relativeCandidate = normalizeWorkspacePath(
    rawPath.startsWith("/")
      ? rawPath
      : path.posix.join(sourceDirectory === "." ? "" : sourceDirectory, rawPath),
  )

  return findAvailablePath(relativeCandidate, availablePaths)
}

function getMarkdownAstText(node: MarkdownAstNode): string {
  const value = typeof node.value === "string" ? node.value : ""
  const children = node.children?.map(getMarkdownAstText).join("") ?? ""
  return `${value}${children}`
}

export function resolvePdfInternalLink(
  rawTarget: string,
  sourcePath: string,
  availablePaths: string[],
  syntax: "markdown" | "obsidian",
): PdfInternalLink {
  const normalizedTarget =
    syntax === "obsidian" ? getObsidianLinkFullPath(rawTarget) : rawTarget.trim()

  if (
    syntax === "markdown" &&
    (normalizedTarget.startsWith("//") || EXTERNAL_SCHEME_REGEX.test(normalizedTarget))
  ) {
    return { kind: "external" }
  }

  const target = splitLinkTarget(normalizedTarget)
  if (!target.path) {
    return target.heading
      ? { kind: "resolved", heading: target.heading, path: normalizeWorkspacePath(sourcePath) }
      : { kind: "unresolved" }
  }

  if (syntax === "markdown") {
    const extension = path.posix.extname(target.path).toLowerCase()
    if (extension && extension !== ".md") {
      return { kind: "external" }
    }
  }

  const relativeMatch = resolveRelativePath(target.path, sourcePath, availablePaths)
  const resolvedPath =
    relativeMatch ??
    resolveObsidianLinkTarget(target.path, availablePaths.map(normalizeWorkspacePath))

  if (!resolvedPath) return { kind: "unresolved" }

  return {
    kind: "resolved",
    heading: target.heading,
    path: normalizeWorkspacePath(resolvedPath),
  }
}

export function findDirectPdfDocumentPaths(
  markdown: string,
  sourcePath: string,
  availablePaths: string[],
): string[] {
  const frontmatter = parseMarkdownFrontmatter(markdown)
  const tree = unified().use(remarkParse).parse(frontmatter.body)
  const sourceKey = normalizeLookupKey(sourcePath)
  const paths: string[] = []
  const seen = new Set<string>()

  function addTarget(rawTarget: string, syntax: "markdown" | "obsidian") {
    const resolved = resolvePdfInternalLink(
      rawTarget,
      sourcePath,
      availablePaths,
      syntax,
    )
    if (resolved.kind !== "resolved") return

    const key = normalizeLookupKey(resolved.path)
    if (key === sourceKey || seen.has(key)) return

    seen.add(key)
    paths.push(resolved.path)
  }

  visit(tree, (node, _index, parent) => {
    if (node.type === "link") {
      addTarget((node as MarkdownLinkNode).url, "markdown")
      return
    }
    if (node.type === "text" && parent?.type !== "link") {
      for (const link of findObsidianLinks((node as MarkdownTextNode).value)) {
        addTarget(link.target, "obsidian")
      }
    }
  })

  return paths
}

export function getPdfDocumentAnchor(documentPath: string): string {
  const digest = createHash("sha256")
    .update(normalizeWorkspacePath(documentPath))
    .digest("hex")
    .slice(0, 12)
  return `document-${digest}`
}

export function slugifyPdfHeading(heading: string): string {
  return heading
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
}

export function getPdfHeadingAnchor(documentPath: string, heading: string): string {
  const slug = slugifyPdfHeading(heading) || "section"
  return `${getPdfDocumentAnchor(documentPath)}--${slug}`
}

export function getPdfDocumentTitle(document: PdfSourceDocument): string {
  const frontmatter = parseMarkdownFrontmatter(document.markdown)
  const title = frontmatter.properties.find(
    (property) => property.key.toLowerCase() === "title" && property.type === "string",
  )
  if (title?.type === "string" && title.value.trim()) return title.value.trim()

  const tree = unified().use(remarkParse).parse(frontmatter.body)
  let headingTitle: string | null = null
  visit(tree, "heading", (node) => {
    if (headingTitle) return

    const heading = node as MarkdownAstNode
    if (heading.depth !== 1) return

    const value = getMarkdownAstText(heading).replace(/\s+/gu, " ").trim()
    if (value) headingTitle = value
  })
  if (headingTitle) return headingTitle

  const basename = path.posix.basename(document.path)
  return stripMarkdownExtension(basename) || document.path
}

export function getObsidianPdfLinkLabel(rawTarget: string): string {
  return getObsidianLinkDisplayLabel(rawTarget)
}
