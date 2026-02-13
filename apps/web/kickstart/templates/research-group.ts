import type { KickstartTemplateDefinition } from '@/kickstart/types'

const BASE_MODEL = 'opencode/kimi-k2.5-free'

export const researchGroupTemplate: KickstartTemplateDefinition = {
  id: 'research-group',
  label: 'Research Group',
  description: 'Hypothesis tracking, experiment logs, and structured findings.',
  kbSkeleton: [
    { type: 'dir', path: 'Outputs' },
    { type: 'file', path: 'Outputs/.gitkeep', content: '' },
    { type: 'dir', path: 'Company' },
    {
      type: 'file',
      path: 'Company/00 - Company Profile.md',
      content:
        '# {{companyName}}\n\n' +
        '## Research Context\n\n' +
        '{{companyDescription}}\n\n' +
        '## Key Questions\n\n' +
        '-\n',
    },
    {
      type: 'file',
      path: 'Company/01 - Glossary.md',
      content:
        '# Research Glossary\n\n' +
        '| Term | Definition |\n' +
        '| --- | --- |\n' +
        '| {{companyName}} | {{companyDescription}} |\n',
    },
    {
      type: 'file',
      path: 'Company/Research/00 - Research Charter.md',
      content:
        '# Research Charter\n\n' +
        '## Scope\n\n' +
        '## Methods\n\n' +
        '## Guardrails\n\n' +
        '## Decision Cadence\n',
    },
    {
      type: 'file',
      path: 'Outputs/Research/00 - Study Queue.md',
      content:
        '# Study Queue\n\n' +
        '| Priority | Question | Method | Status |\n' +
        '| --- | --- | --- | --- |\n' +
        '| P1 |  |  | Backlog |\n',
    },
    {
      type: 'file',
      path: 'Outputs/Research/01 - Findings Log.md',
      content:
        '# Findings Log\n\n' +
        '| Date | Finding | Confidence | Follow-up |\n' +
        '| --- | --- | --- | --- |\n' +
        '|  |  |  |  |\n',
    },
    {
      type: 'file',
      path: 'Templates/Experiment Plan Template.md',
      content:
        '# Experiment Plan Template\n\n' +
        '## Hypothesis\n\n' +
        '## Method\n\n' +
        '## Data Needed\n\n' +
        '## Success Criteria\n',
    },
  ],
  agentsMdTemplate:
    '# AGENTS.md\n\n' +
    'Workspace profile: **Research Group**\n\n' +
    'Company: {{companyName}}\n\n' +
    'Context: {{companyDescription}}\n\n' +
    'Keep research outputs explicit, traceable, and easy to reuse in future decisions.\n',
  recommendedAgentIds: ['assistant', 'knowledge-curator', 'requirements', 'support'],
  recommendedModels: {
    assistant: BASE_MODEL,
    'knowledge-curator': BASE_MODEL,
    requirements: BASE_MODEL,
    support: BASE_MODEL,
  },
}
