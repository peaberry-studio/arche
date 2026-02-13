import type { KickstartTemplateDefinition } from '@/kickstart/types'

const BASE_MODEL = 'opencode/kimi-k2.5-free'

export const blankTemplate: KickstartTemplateDefinition = {
  id: 'blank',
  label: 'Blank',
  description: 'Minimal workspace with only core structure and baseline agents.',
  kbSkeleton: [
    { type: 'dir', path: 'Outputs' },
    { type: 'file', path: 'Outputs/.gitkeep', content: '' },
    { type: 'dir', path: 'Company' },
    {
      type: 'file',
      path: 'Company/00 - Company Profile.md',
      content:
        '# {{companyName}}\n\n' +
        '## Company Description\n\n' +
        '{{companyDescription}}\n\n' +
        '## Mission\n\n' +
        '- Define your mission statement here.\n\n' +
        '## Current Priorities\n\n' +
        '- Add current priorities here.\n',
    },
    {
      type: 'file',
      path: 'Company/01 - Glossary.md',
      content:
        '# Glossary\n\n' +
        '| Term | Definition |\n' +
        '| --- | --- |\n' +
        '| {{companyName}} | {{companyDescription}} |\n',
    },
  ],
  agentsMdTemplate:
    '# AGENTS.md\n\n' +
    'Workspace guidelines for **{{companyName}}**.\n\n' +
    'Company summary: {{companyDescription}}\n\n' +
    'Use this workspace as a clean slate. Keep the KB structured, concise, and easy to extend as the team grows.\n',
  recommendedAgentIds: ['assistant', 'knowledge-curator'],
  recommendedModels: {
    assistant: BASE_MODEL,
    'knowledge-curator': BASE_MODEL,
  },
}
