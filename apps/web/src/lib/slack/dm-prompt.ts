export function buildSlackDmPrompt(args: {
  text: string
}): string {
  return [
    'You are responding to a Slack direct message from the linked Arche user.',
    'Keep the reply concise and helpful. Use standard Markdown; the delivery layer normalizes it for Slack.',
    'Do not mention hidden reasoning or tool use.',
    '',
    'User message:',
    args.text,
  ].join('\n')
}
