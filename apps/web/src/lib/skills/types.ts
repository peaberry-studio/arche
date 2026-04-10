export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const SKILLS_CONFIG_DIRECTORY = 'skills'
export const SKILL_MARKDOWN_FILE_NAME = 'SKILL.md'

export type SkillFrontmatter = {
  compatibility?: string
  description: string
  license?: string
  metadata?: Record<string, string>
  name: string
  [key: string]: unknown
}

export type SkillDocument = {
  body: string
  frontmatter: SkillFrontmatter
  raw: string
}

export type SkillBundleFile = {
  content: Uint8Array
  path: string
}

export type SkillBundle = {
  files: SkillBundleFile[]
  skill: SkillDocument
}

export type SkillSummary = {
  assignedAgentIds: string[]
  description: string
  hasResources: boolean
  name: string
  resourcePaths: string[]
}

export type SkillDetail = SkillSummary & {
  body: string
}

export type SkillArchive = {
  files: SkillBundleFile[]
  skill: SkillDocument
}
