// Client-safe constants shared by the server-side workspace broadcast
// publishers and the client event-bus matcher. Keep this module free of any
// server-only imports so route modules and browser hooks can both import it.
export const KNOWLEDGE_PROPOSALS_CHANGED_EVENT = 'knowledge.proposals_changed'
