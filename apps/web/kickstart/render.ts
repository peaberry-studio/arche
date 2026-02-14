import { normalizeRepoPath } from '@/kickstart/parse-utils'
import type {
  KickstartPlaceholderContext,
  KickstartRenderedFile,
  KickstartTemplateDefinition,
} from '@/kickstart/types'

const PLACEHOLDER_PATTERN = /{{\s*(companyName|companyDescription)\s*}}/g

function collectParentDirectories(filePath: string): string[] {
  const normalizedPath = normalizeRepoPath(filePath)
  if (!normalizedPath) return []

  const segments = normalizedPath.split('/').filter(Boolean)
  const directories: string[] = []

  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join('/'))
  }

  return directories
}

export function renderKickstartText(
  template: string,
  context: KickstartPlaceholderContext
): string {
  return template.replace(PLACEHOLDER_PATTERN, (_, key: keyof KickstartPlaceholderContext) => {
    return context[key] ?? ''
  })
}

export function renderKickstartKbSkeleton(
  definition: KickstartTemplateDefinition,
  context: KickstartPlaceholderContext
): {
  directories: string[]
  files: KickstartRenderedFile[]
} {
  const directories = new Set<string>()
  const files: KickstartRenderedFile[] = []

  for (const entry of definition.kbSkeleton) {
    const renderedPath = normalizeRepoPath(renderKickstartText(entry.path, context))
    if (!renderedPath) continue

    if (entry.type === 'dir') {
      directories.add(renderedPath)
      continue
    }

    for (const parent of collectParentDirectories(renderedPath)) {
      directories.add(parent)
    }

    files.push({
      path: renderedPath,
      content: renderKickstartText(entry.content, context),
    })
  }

  return {
    directories: Array.from(directories).sort((a, b) => a.localeCompare(b)),
    files,
  }
}
