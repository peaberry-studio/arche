import { mkdir, rm, writeFile } from 'fs/promises'
import path from 'path'

import type { SkillBundle } from '@/lib/skills/types'

export async function writeRuntimeSkills(baseDir: string, skills: SkillBundle[]): Promise<void> {
  await rm(baseDir, { recursive: true, force: true })

  if (skills.length === 0) {
    return
  }

  for (const skill of skills) {
    const skillDir = path.join(baseDir, skill.skill.frontmatter.name)
    await mkdir(skillDir, { recursive: true })

    for (const file of skill.files) {
      const filePath = path.join(skillDir, file.path)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, Buffer.from(file.content))
    }
  }
}
