const LEARNING_SESSION_PREFIX = 'Learning |'
const LEARNING_FLOW_SESSION_PREFIX = 'Flow | Learning |'

export function isLearningSessionTitle(title: string): boolean {
  return title.startsWith(LEARNING_SESSION_PREFIX) || title.startsWith(LEARNING_FLOW_SESSION_PREFIX)
}

export function getLearningSessionTitle(title: string): string {
  return `${LEARNING_SESSION_PREFIX} ${title}`
}
