import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

type ParsedDefinition<TDefinition> = {
  definition: TDefinition
  order: number
}

type LoadDefinitionsOptions<TDefinition extends { id: string }> = {
  directoryCandidates: string[]
  definitionKind: string
  idKind: string
  parse: (raw: string, fileName: string) => ParsedDefinition<TDefinition>
}

function resolveDefinitionDirectory(options: {
  directoryCandidates: string[]
  definitionKind: string
}): string {
  for (const candidate of options.directoryCandidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(
    `${options.definitionKind} definitions directory not found. Tried: ${options.directoryCandidates.join(', ')}`
  )
}

export function loadDefinitions<TDefinition extends { id: string }>(
  options: LoadDefinitionsOptions<TDefinition>
): TDefinition[] {
  const definitionsDirectory = resolveDefinitionDirectory(options)
  const definitionFiles = readdirSync(definitionsDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))

  if (definitionFiles.length === 0) {
    throw new Error(`No ${options.definitionKind.toLowerCase()} definitions were found`)
  }

  const loadedDefinitions = definitionFiles.map((fileName) => {
    const filePath = join(definitionsDirectory, fileName)
    const parsed = options.parse(readFileSync(filePath, 'utf-8'), fileName)

    if (`${parsed.definition.id}.json` !== fileName) {
      throw new Error(
        `${options.definitionKind} file name must match ${options.idKind} id: ${fileName} -> ${parsed.definition.id}`
      )
    }

    return parsed
  })

  loadedDefinitions.sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order
    }

    return left.definition.id.localeCompare(right.definition.id)
  })

  const seenIds = new Set<string>()
  const definitions: TDefinition[] = []

  for (const { definition } of loadedDefinitions) {
    if (seenIds.has(definition.id)) {
      throw new Error(`Duplicate ${options.definitionKind.toLowerCase()} id: ${definition.id}`)
    }

    seenIds.add(definition.id)
    definitions.push(definition)
  }

  return definitions
}
