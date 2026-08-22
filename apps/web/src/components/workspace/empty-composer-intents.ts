export const EMPTY_COMPOSER_INTENTS = [
  "Let's fucking go",
  "Let's go",
  'Today we crash it',
  'Fuck it, send it',
  'Hell yes',
  'About damn time',
  'No warm-up',
  'Ship something',
  'Make it messy',
  "Don't be precious",
  'Start ugly',
  'Punch up',
  'Go on then',
  'Leave a mark',
  'Skip the speech',
  'Run it hot',
  'Break a plate',
  'Make them blink',
  'We have teeth',
  'Cut the fluff',
  'Do the loud version',
  'Be unreasonable',
  'Stir the pot',
  'Burn the draft',
  'Today we bite',
  'Drop the act',
  'Make a dent',
  'Turn it up',
  'Get dirty',
  'Finish something',
  'Stop circling',
  'Kick the door',
  'Go too far',
  'Make it count',
  "We're already late",
  'Say it anyway',
  'One clean hit',
  'Less polite',
  'Do it live',
  'Crack it open',
  'Just go',
  'Today we cook',
  'Make it sting',
  'No half-measures',
  'Pick a fight',
  'Make it obvious',
  'Cause trouble',
  'Full send',
  'Lock in',
  'No notes',
] as const

export type EmptyComposerIntent = (typeof EMPTY_COMPOSER_INTENTS)[number]

let lastIntent: EmptyComposerIntent | null = null

export function pickEmptyComposerIntent(
  random: () => number = Math.random,
): EmptyComposerIntent {
  const count = EMPTY_COMPOSER_INTENTS.length
  const index = Math.min(count - 1, Math.max(0, Math.floor(random() * count)))
  let next = EMPTY_COMPOSER_INTENTS[index]

  if (next === lastIntent && count > 1) {
    next = EMPTY_COMPOSER_INTENTS[(index + 1) % count]
  }

  lastIntent = next
  return next
}
