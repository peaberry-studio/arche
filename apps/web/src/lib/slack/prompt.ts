export function buildSlackPrompt(args: {
  contextText: string
  mentionTokens: string[]
}): string {
  const mentions = args.mentionTokens.length > 0 ? args.mentionTokens.join(', ') : 'none'

  return [
    'You are responding inside Slack.',
    'Keep the reply concise, helpful, and formatted with simple Markdown only.',
    `If you mention a Slack user, only use these exact mention tokens: ${mentions}.`,
    'Do not narrate tool use, hidden reasoning, or status updates.',
    'Do not pretend you have Slack context beyond what is provided below.',
    'If important context is missing, say so briefly instead of guessing.',
    '',
    'Slack context:',
    args.contextText,
  ].join('\n')
}
