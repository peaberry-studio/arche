import { createSkillMarkdown } from '@/lib/skills/skill-markdown'
import {
  SKILL_MARKDOWN_FILE_NAME,
  type SkillBundle,
} from '@/lib/skills/types'

export const SYSTEM_FLOW_AUTHORING_SKILL_NAME = 'arche-flow-authoring'

const FLOW_AUTHORING_SKILL_DESCRIPTION = 'Use when creating Arche flows, flow templates, FlowDefinition JSON, node definitions, template variables, or calling flow_propose.'

const FLOW_AUTHORING_SKILL_BODY = `# Arche Flow Authoring

Use this skill before calling \`flow_propose\` or drafting an Arche flow template.

## Tool Shape

Call \`flow_propose\` with this top-level object:

\`\`\`json
{
  "name": "Flow name",
  "description": "Optional description",
  "enabled": false,
  "cronExpression": null,
  "timezone": "UTC",
  "definition": {
    "version": 1,
    "startNodeId": "agent-1",
    "nodes": [],
    "edges": []
  }
}
\`\`\`

Do not put \`format: arche-flow-template/v1\` inside \`definition\`. The tool adds the template format after validation.

## FlowDefinition

Required fields:

- \`version\`: always \`1\`.
- \`startNodeId\`: id of the first node.
- \`nodes\`: non-empty array of node objects.
- \`edges\`: array of directed connections.
- \`layout\`: optional \`{ "nodes": [{ "nodeId": "agent-1", "x": 120, "y": 120 }] }\`.

Rules:

- Node ids and edge ids must be unique.
- \`startNodeId\` and every edge endpoint must reference an existing node id.
- Flows cannot contain cycles or self-edges.
- Prefer readable kebab-case ids such as \`draft-summary\` or \`human-review\`.

## Node Types

Agent node:

\`\`\`json
{
  "id": "agent-1",
  "type": "agent",
  "name": "Draft summary",
  "targetAgentId": null,
  "promptTemplate": "Summarize the latest metrics.",
  "compactOutput": false
}
\`\`\`

Use \`targetAgentId: null\` for portable templates. The user can remap the agent in the editor.

Human node:

\`\`\`json
{
  "id": "review",
  "type": "human",
  "name": "Human review",
  "instructions": "Review the draft and approve or request changes.",
  "required": true
}
\`\`\`

Condition node with rules:

\`\`\`json
{
  "id": "route",
  "type": "condition",
  "name": "Route result",
  "mode": "rules",
  "rules": [
    {
      "id": "urgent",
      "variable": "previous.output",
      "operator": "contains",
      "value": "urgent",
      "targetNodeId": "urgent-agent"
    }
  ]
}
\`\`\`

Condition operators: \`contains\`, \`ends_with\`, \`equals\`, \`exists\`, \`matches\`, \`not_equals\`, \`not_exists\`, \`starts_with\`.

Condition node with AI evaluation:

\`\`\`json
{
  "id": "ai-route",
  "type": "condition",
  "name": "AI route",
  "mode": "ai",
  "evaluatorPrompt": "Choose the next branch from the previous output."
}
\`\`\`

Slack node:

\`\`\`json
{
  "id": "notify",
  "type": "slack",
  "name": "Notify channel",
  "target": { "type": "channel", "channelId": "C123" },
  "messageMode": "template",
  "messageTemplate": "Flow {{flow.name}} finished: {{previous.output}}"
}
\`\`\`

Slack targets are \`{ "type": "channel", "channelId": "..." }\` or \`{ "type": "dm", "userId": "..." }\`. Message modes are \`fixed\`, \`previous_output\`, and \`template\`.

Merge node:

\`\`\`json
{ "id": "merge", "type": "merge", "name": "Merge branches" }
\`\`\`

Compaction node:

\`\`\`json
{
  "id": "compact",
  "type": "compaction",
  "name": "Compact output",
  "promptTemplate": "Extract decisions and next actions from {{previous.output}}."
}
\`\`\`

## Edges

Edges connect normal traversal steps:

\`\`\`json
{ "id": "agent-1-to-review", "sourceNodeId": "agent-1", "targetNodeId": "review" }
\`\`\`

For \`condition\` nodes, every rule \`targetNodeId\` must exist. The validator adds missing condition-rule edges automatically, but including them with stable ids is fine.

## Template Variables

Use variables inside \`promptTemplate\`, human \`instructions\`, condition \`evaluatorPrompt\`, and Slack template messages:

- \`{{previous.output}}\`: output handed to the current step.
- \`{{flow.name}}\`: current flow name.
- \`{{run.id}}\`: current run id.
- \`{{steps.<nodeId>.output}}\`: output recorded by a prior node.
- \`{{human.<nodeId>.response}}\`: response submitted for a human node.

Rule condition variables do not use curly braces. Use values like \`previous.output\`, \`steps.agent-1.output\`, or \`human.review.response\`.

## Minimal Valid Example

\`\`\`json
{
  "name": "Weekly review",
  "description": "Draft a weekly summary and wait for review.",
  "enabled": false,
  "cronExpression": null,
  "timezone": "UTC",
  "definition": {
    "version": 1,
    "startNodeId": "draft-summary",
    "nodes": [
      {
        "id": "draft-summary",
        "type": "agent",
        "name": "Draft summary",
        "targetAgentId": null,
        "promptTemplate": "Draft a concise weekly summary.",
        "compactOutput": false
      },
      {
        "id": "review",
        "type": "human",
        "name": "Review summary",
        "instructions": "Review this draft: {{previous.output}}",
        "required": true
      }
    ],
    "edges": [
      {
        "id": "draft-summary-to-review",
        "sourceNodeId": "draft-summary",
        "targetNodeId": "review"
      }
    ],
    "layout": {
      "nodes": [
        { "nodeId": "draft-summary", "x": 120, "y": 120 },
        { "nodeId": "review", "x": 420, "y": 120 }
      ]
    }
  }
}
\`\`\`
`

export function createFlowAuthoringSystemSkillBundle(): SkillBundle {
  const raw = createSkillMarkdown({
    body: FLOW_AUTHORING_SKILL_BODY,
    description: FLOW_AUTHORING_SKILL_DESCRIPTION,
    name: SYSTEM_FLOW_AUTHORING_SKILL_NAME,
  })

  return {
    files: [
      {
        content: Buffer.from(raw, 'utf-8'),
        path: SKILL_MARKDOWN_FILE_NAME,
      },
    ],
    skill: {
      body: FLOW_AUTHORING_SKILL_BODY,
      frontmatter: {
        description: FLOW_AUTHORING_SKILL_DESCRIPTION,
        name: SYSTEM_FLOW_AUTHORING_SKILL_NAME,
      },
      raw,
    },
  }
}

export function withSystemSkillBundles(skills: SkillBundle[]): SkillBundle[] {
  const userSkills = skills.filter(
    (skill) => skill.skill.frontmatter.name !== SYSTEM_FLOW_AUTHORING_SKILL_NAME
  )
  return [...userSkills, createFlowAuthoringSystemSkillBundle()]
}
