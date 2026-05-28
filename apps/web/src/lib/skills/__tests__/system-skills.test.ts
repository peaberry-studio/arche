import { describe, expect, it } from 'vitest'

import {
  createFlowAuthoringSystemSkillBundle,
  SYSTEM_FLOW_AUTHORING_SKILL_NAME,
  withSystemSkillBundles,
} from '@/lib/skills/system-skills'
import type { SkillBundle } from '@/lib/skills/types'

function createUserSkill(name: string): SkillBundle {
  return {
    files: [{ path: 'SKILL.md', content: new TextEncoder().encode(`---\nname: ${name}\ndescription: Test\n---\nBody`) }],
    skill: {
      body: 'Body',
      frontmatter: { name, description: 'Test' },
      raw: '',
    },
  }
}

describe('system skills', () => {
  it('creates the built-in flow authoring skill bundle', () => {
    const bundle = createFlowAuthoringSystemSkillBundle()

    expect(bundle.skill.frontmatter.name).toBe(SYSTEM_FLOW_AUTHORING_SKILL_NAME)
    expect(bundle.skill.body).toContain('FlowDefinition')
    expect(bundle.skill.body).toContain('agent')
    expect(Buffer.from(bundle.files[0]?.content ?? new Uint8Array()).toString('utf-8')).toContain(
      `name: ${SYSTEM_FLOW_AUTHORING_SKILL_NAME}`
    )
  })

  it('appends system skills without duplicating user skills with the same name', () => {
    const bundles = withSystemSkillBundles([
      createUserSkill('pdf-processing'),
      createUserSkill(SYSTEM_FLOW_AUTHORING_SKILL_NAME),
    ])

    expect(bundles.map((bundle) => bundle.skill.frontmatter.name)).toEqual([
      'pdf-processing',
      SYSTEM_FLOW_AUTHORING_SKILL_NAME,
    ])
    expect(bundles.at(-1)?.skill.body).toContain('flow_propose')
  })
})
