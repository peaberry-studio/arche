export function buildSlackDmPrompt(args: {
  text: string
}): string {
  return [
    'You are responding to a Slack direct message from the linked Arche user.',
    'Keep the reply concise and Slack-friendly.',
    'Do not mention hidden reasoning or tool use.',
    '',
    'User message:',
    args.text,
  ].join('\n')
}
