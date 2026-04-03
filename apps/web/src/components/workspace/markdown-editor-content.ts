function normalizeLineEndings(value: string): string {
  return value.replaceAll("\r\n", "\n")
}

function trimTrailingNewlines(value: string): string {
  return value.replace(/\n+$/u, "")
}

export function normalizeMarkdownForKb(value: string): string {
  return value.replaceAll("\u00A0", " ").replaceAll("&nbsp;", " ")
}

export function isEquivalentMarkdown(left: string, right: string): boolean {
  if (left === right) return true

  const normalizedLeft = trimTrailingNewlines(
    normalizeLineEndings(normalizeMarkdownForKb(left))
  )
  const normalizedRight = trimTrailingNewlines(
    normalizeLineEndings(normalizeMarkdownForKb(right))
  )

  return normalizedLeft === normalizedRight
}
