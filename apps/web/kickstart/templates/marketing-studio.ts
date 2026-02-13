import type { KickstartTemplateDefinition } from '@/kickstart/types'

const BASE_MODEL = 'opencode/kimi-k2.5-free'

export const marketingStudioTemplate: KickstartTemplateDefinition = {
  id: 'marketing-studio',
  label: 'Marketing Studio',
  description: 'Campaign planning, copy systems, and growth diagnostics.',
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
        '## Brand Positioning\n\n' +
        '- Category:\n' +
        '- Promise:\n' +
        '- Differentiator:\n',
    },
    {
      type: 'file',
      path: 'Company/01 - Glossary.md',
      content:
        '# Brand Glossary\n\n' +
        '| Term | Definition |\n' +
        '| --- | --- |\n' +
        '| {{companyName}} | {{companyDescription}} |\n',
    },
    {
      type: 'file',
      path: 'Outputs/Marketing/00 - Campaign Backlog.md',
      content:
        '# Campaign Backlog\n\n' +
        '| Campaign | Objective | Stage | Owner |\n' +
        '| --- | --- | --- | --- |\n' +
        '|  |  | Idea |  |\n',
    },
    {
      type: 'file',
      path: 'Outputs/Marketing/01 - Message Bank.md',
      content:
        '# Message Bank\n\n' +
        '## Core Claims\n\n' +
        '-\n\n' +
        '## Proof Points\n\n' +
        '-\n',
    },
    {
      type: 'file',
      path: 'Outputs/SEO/00 - SEO Priorities.md',
      content:
        '# SEO Priorities\n\n' +
        '| Priority | Topic | Intent | Owner |\n' +
        '| --- | --- | --- | --- |\n' +
        '| P1 |  |  |  |\n',
    },
    {
      type: 'file',
      path: 'Templates/Copy Brief Template.md',
      content:
        '# Copy Brief Template\n\n' +
        '## Audience\n\n' +
        '## Offer\n\n' +
        '## Constraints\n\n' +
        '## CTA\n',
    },
  ],
  agentsMdTemplate:
    '# AGENTS.md\n\n' +
    'Workspace profile: **Marketing Studio**\n\n' +
    'Company: {{companyName}}\n\n' +
    'Context: {{companyDescription}}\n\n' +
    'Prioritize message clarity, campaign learning loops, and channel-specific execution.\n',
  recommendedAgentIds: [
    'assistant',
    'knowledge-curator',
    'copywriter',
    'ads-scripts',
    'performance-marketing',
    'seo',
  ],
  recommendedModels: {
    assistant: BASE_MODEL,
    'knowledge-curator': BASE_MODEL,
    copywriter: BASE_MODEL,
    'ads-scripts': BASE_MODEL,
    'performance-marketing': BASE_MODEL,
    seo: BASE_MODEL,
  },
}
