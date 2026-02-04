'use server'

import { cookies } from 'next/headers'
import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { createInstanceClient } from '@/lib/opencode/client'
import { prisma } from '@/lib/prisma'
import { decryptPassword } from '@/lib/spawner/crypto'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'
import type {
  WorkspaceFileNode,
  WorkspaceFileContent,
  WorkspaceSession,
  WorkspaceMessage,
  AvailableModel,
  MessagePart,
  WorkspaceConnectionState,
  ToolState
} from '@/lib/opencode/types'

// ============================================================================
// Authentication helper
// ============================================================================

async function getAuthenticatedUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return getSessionFromToken(token)
}

async function getAuthorizedClient(slug: string) {
  const session = await getAuthenticatedUser()
  if (!session) return { error: 'unauthorized' as const, client: null }
  
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return { error: 'forbidden' as const, client: null }
  }
  
  const client = await createInstanceClient(slug)
  if (!client) {
    return { error: 'instance_unavailable' as const, client: null }
  }
  
  return { error: null, client }
}

// ============================================================================
// Connection & Health
// ============================================================================

export async function checkConnectionAction(slug: string): Promise<WorkspaceConnectionState> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) {
    return { status: 'error', error }
  }
  
  try {
    const health = await client!.global.health()
    if (health.data?.healthy) {
      return { status: 'connected', version: health.data.version }
    }
    return { status: 'error', error: 'unhealthy' }
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : 'unknown' }
  }
}

// ============================================================================
// Files
// ============================================================================

export async function listFilesAction(slug: string, path?: string): Promise<{
  ok: boolean
  files?: WorkspaceFileNode[]
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    const result = await client!.file.list({ path: path ?? '' })
    const files = result.data ?? []
    
    // SDK returns a flat list of files/directories at the given path
    const transformed: WorkspaceFileNode[] = files
      .filter(f => !f.ignored)
      .map(node => ({
        id: node.path,
        name: node.name,
        path: node.path,
        type: node.type
      }))
    
    return { ok: true, files: transformed }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export async function readFileAction(slug: string, path: string): Promise<{
  ok: boolean
  content?: WorkspaceFileContent
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    const result = await client!.file.read({ path })
    if (!result.data) {
      return { ok: false, error: 'file_not_found' }
    }
    
    // Handle base64 encoded content
    let content = result.data.content
    if (result.data.encoding === 'base64') {
      content = Buffer.from(content, 'base64').toString('utf-8')
    }
    
    return {
      ok: true,
      content: {
        path,
        content,
        type: result.data.type === 'text' ? 'raw' : 'patch'
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export async function searchFilesAction(slug: string, query: string): Promise<{
  ok: boolean
  files?: string[]
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    const result = await client!.find.files({ query, limit: 50 })
    return { ok: true, files: result.data ?? [] }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

/**
 * Load the full file tree by recursively fetching directories.
 */
export async function loadFileTreeAction(slug: string, maxDepth = 4): Promise<{
  ok: boolean
  tree?: WorkspaceFileNode[]
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    async function loadDirectory(path: string, depth: number): Promise<WorkspaceFileNode[]> {
      if (depth > maxDepth) return []
      
      const result = await client!.file.list({ path })
      const items = result.data ?? []
      
      const nodes: WorkspaceFileNode[] = []
      
      for (const item of items) {
        if (item.ignored) continue
        
        const node: WorkspaceFileNode = {
          id: item.path,
          name: item.name,
          path: item.path,
          type: item.type
        }
        
        // Recursively load children for directories
        if (item.type === 'directory') {
          const children = await loadDirectory(item.path, depth + 1)
          if (children.length > 0) {
            node.children = children
          }
        }
        
        nodes.push(node)
      }
      
      // Sort: directories first, then alphabetically
      nodes.sort((a, b) => {
        if (a.type === 'directory' && b.type === 'file') return -1
        if (a.type === 'file' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })
      
      return nodes
    }
    
    const tree = await loadDirectory('', 0)
    return { ok: true, tree }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

// ============================================================================
// Sessions
// ============================================================================

/**
 * Format a timestamp (unix ms or Date) for display.
 */
function formatTimestamp(timestamp: number | Date | string | undefined): string {
  if (!timestamp) return ''
  
  let d: Date
  if (typeof timestamp === 'number') {
    d = new Date(timestamp)
  } else if (typeof timestamp === 'string') {
    d = new Date(timestamp)
  } else {
    d = timestamp
  }
  
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} min ago`
  
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

export async function listSessionsAction(slug: string): Promise<{
  ok: boolean
  sessions?: WorkspaceSession[]
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    const result = await client!.session.list()
    const sessions = result.data ?? []
    
    // Get status for all sessions
    const statusResult = await client!.session.status()
    const statuses = statusResult.data ?? {}
    
    const transformed: WorkspaceSession[] = sessions.map(s => {
      const sessionStatus = statuses[s.id]
      let status: 'active' | 'idle' | 'busy' | 'error' = 'idle'
      if (sessionStatus?.type === 'busy') status = 'busy'
      else if (sessionStatus?.type === 'retry') status = 'busy'
      
      return {
        id: s.id,
        title: s.title || 'Untitled',
        status,
        updatedAt: formatTimestamp(s.time?.updated),
        parentId: s.parentID,
        share: s.share ? { url: s.share.url, version: 1 } : undefined
      }
    })
    
    return { ok: true, sessions: transformed }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export async function createSessionAction(slug: string, title?: string): Promise<{
  ok: boolean
  session?: WorkspaceSession
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    const result = await client!.session.create({ title })
    if (!result.data) {
      return { ok: false, error: 'create_failed' }
    }
    
    const s = result.data
    return {
      ok: true,
      session: {
        id: s.id,
        title: s.title || 'Untitled',
        status: 'active',
        updatedAt: formatTimestamp(s.time?.updated),
        parentId: s.parentID
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export async function deleteSessionAction(slug: string, sessionId: string): Promise<{
  ok: boolean
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    await client!.session.delete({ sessionID: sessionId })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export async function updateSessionAction(slug: string, sessionId: string, title: string): Promise<{
  ok: boolean
  session?: WorkspaceSession
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    const result = await client!.session.update({ 
      sessionID: sessionId, 
      title 
    })
    if (!result.data) {
      return { ok: false, error: 'update_failed' }
    }
    
    const s = result.data
    return {
      ok: true,
      session: {
        id: s.id,
        title: s.title || 'Untitled',
        status: 'idle',
        updatedAt: formatTimestamp(s.time?.updated),
        parentId: s.parentID
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

// ============================================================================
// Messages
// ============================================================================

/**
 * Internal-only parts that should be completely hidden.
 * These are OpenCode internals that have no user-facing value.
 */
const HIDDEN_PART_TYPES = new Set([
  'snapshot',     // Internal state snapshot
  'compaction',   // Session compaction marker
])

/**
 * Transform OpenCode parts to UI-friendly MessagePart types.
 * Unknown types are preserved with 'unknown' type for debugging.
 */
function transformParts(parts: unknown[]): MessagePart[] {
  const mapped = parts
    .map((p): MessagePart | null => {
      const part = p as Record<string, unknown>
      const partType = String(part.type ?? 'unknown')
      const partId = String(part.id ?? `part-${Date.now()}`)
      
      // Completely hide internal parts
      if (HIDDEN_PART_TYPES.has(partType)) {
        return null
      }
      
      switch (partType) {
        case 'text': {
          const text = String(part.text ?? '')
          // Skip empty text parts
          if (!text.trim()) return null
          return { type: 'text' as const, text }
        }
        
        case 'reasoning': {
          const text = String(part.text ?? '')
          // Skip empty reasoning
          if (!text.trim()) return null
          return { type: 'reasoning' as const, text }
        }
        
        case 'tool': {
          const state = part.state as Record<string, unknown> | undefined
          const toolName = String(part.tool ?? 'unknown')

          // Map state to our ToolState type
          let toolState: ToolState
          const status = String(state?.status ?? 'pending')
          const input = (state?.input ?? {}) as Record<string, unknown>
          
          if (status === 'completed') {
            toolState = {
              status: 'completed',
              input,
              output: String(state?.output ?? ''),
              title: String(state?.title ?? toolName)
            }
          } else if (status === 'error') {
            toolState = {
              status: 'error',
              input,
              error: String(state?.error ?? 'Unknown error')
            }
          } else if (status === 'running') {
            toolState = {
              status: 'running',
              input,
              title: state?.title ? String(state.title) : undefined
            }
          } else {
            toolState = { status: 'pending', input }
          }
          
          return {
            type: 'tool' as const,
            id: String(part.callID ?? partId),
            name: toolName,
            state: toolState
          }
        }
        
        case 'file': {
          return {
            type: 'file' as const,
            path: String(part.filename ?? part.path ?? ''),
            filename: part.filename ? String(part.filename) : undefined,
            mime: part.mime ? String(part.mime) : undefined,
            url: part.url ? String(part.url) : undefined
          }
        }
        
        case 'image': {
          return {
            type: 'image' as const,
            url: String(part.url ?? '')
          }
        }
        
        case 'step-start': {
          return {
            type: 'step-start' as const,
            id: partId,
            snapshot: part.snapshot ? String(part.snapshot) : undefined
          }
        }
        
        case 'step-finish': {
          const tokens = part.tokens as Record<string, number> | undefined
          return {
            type: 'step-finish' as const,
            id: partId,
            reason: String(part.reason ?? ''),
            cost: Number(part.cost ?? 0),
            tokens: {
              input: Number(tokens?.input ?? 0),
              output: Number(tokens?.output ?? 0)
            }
          }
        }
        
        case 'patch': {
          return {
            type: 'patch' as const,
            id: partId,
            files: Array.isArray(part.files) ? part.files.map(String) : []
          }
        }
        
        case 'agent': {
          return {
            type: 'agent' as const,
            id: partId,
            name: String(part.name ?? 'unknown')
          }
        }
        
        case 'subtask': {
          return {
            type: 'subtask' as const,
            id: partId,
            prompt: String(part.prompt ?? ''),
            description: String(part.description ?? ''),
            agent: String(part.agent ?? 'unknown')
          }
        }
        
        case 'retry': {
          const error = part.error as Record<string, unknown> | undefined
          const errorData = error?.data as Record<string, unknown> | undefined
          return {
            type: 'retry' as const,
            id: partId,
            attempt: Number(part.attempt ?? 0),
            error: String(errorData?.message ?? error?.message ?? 'Unknown error')
          }
        }
        
        default: {
          // Unknown type - preserve as fallback for debugging
          console.log('[transformParts] Unknown part type:', partType, part)
          return {
            type: 'unknown' as const,
            originalType: partType,
            data: part as Record<string, unknown>
          }
        }
      }
    })
  return mapped.filter((p): p is MessagePart => p !== null)
}

function extractTextContent(parts: MessagePart[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } | { type: 'reasoning'; text: string } => 
      p.type === 'text' || p.type === 'reasoning'
    )
    .map(p => p.text)
    .join('\n')
}

export async function listMessagesAction(slug: string, sessionId: string): Promise<{
  ok: boolean
  messages?: WorkspaceMessage[]
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    const result = await client!.session.messages({ sessionID: sessionId })
    const messages = result.data ?? []
    
    const transformed: WorkspaceMessage[] = messages.map(m => {
      const parts = transformParts(m.parts ?? [])
      const rawTimestamp = m.info.time?.created
      return {
        id: m.info.id,
        sessionId,
        role: m.info.role as 'user' | 'assistant',
        content: extractTextContent(parts),
        timestamp: formatTimestamp(rawTimestamp),
        timestampRaw: typeof rawTimestamp === 'number' ? rawTimestamp : undefined,
        parts
      }
    })
    
    return { ok: true, messages: transformed }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export async function sendMessageAction(
  slug: string, 
  sessionId: string, 
  text: string,
  model?: { providerId: string; modelId: string }
): Promise<{
  ok: boolean
  message?: WorkspaceMessage
  error?: string
}> {
  console.log('[sendMessageAction] Called with:', { slug, sessionId, text: text.substring(0, 50), model })
  
  // Verify user is authorized
  const session = await getAuthenticatedUser()
  if (!session) {
    return { ok: false, error: 'unauthorized' }
  }
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return { ok: false, error: 'forbidden' }
  }
  
  try {
    // Get credentials for direct fetch (bypassing SDK due to streaming issues)
    const instance = await prisma.instance.findUnique({
      where: { slug },
      select: { serverPassword: true, status: true }
    })
    
    if (!instance || !instance.serverPassword || instance.status !== 'running') {
      console.log('[sendMessageAction] Instance unavailable:', { 
        hasInstance: !!instance, 
        hasPassword: !!instance?.serverPassword, 
        status: instance?.status 
      })
      return { ok: false, error: 'instance_unavailable' }
    }
    
    const password = decryptPassword(instance.serverPassword)
    const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
    const baseUrl = `http://opencode-${slug}:4096`
    
    console.log('[sendMessageAction] Sending to:', `${baseUrl}/session/${sessionId}/message`)
    
    const body = {
      parts: [{ type: 'text', text }],
      model: model ? { providerID: model.providerId, modelID: model.modelId } : undefined
    }
    
    const response = await fetch(`${baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(body)
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      return { ok: false, error: `HTTP ${response.status}: ${errorText}` }
    }
    
    // Response is JSON with { info, parts } structure
    const responseText = await response.text()
    
    let messageId = ''
    let textContent = ''
    
    try {
      const data = JSON.parse(responseText)
      messageId = data.info?.id || `msg-${Date.now()}`
      
      // Extract text from parts array
      if (Array.isArray(data.parts)) {
        for (const part of data.parts) {
          if (part.type === 'text' && part.text) {
            textContent += part.text
          }
        }
      }
      
      console.log('[sendMessageAction] Extracted text:', textContent.substring(0, 100))
    } catch (e) {
      // If not valid JSON, maybe it's streaming format (NDJSON)
      console.log('[sendMessageAction] JSON parse failed, trying NDJSON')
      const lines = responseText.split('\n')
      
      for (const line of lines) {
        if (line.trim().startsWith('{')) {
          try {
            const event = JSON.parse(line)
            if (event.messageID && !messageId) {
              messageId = event.messageID
            }
            if (event.type === 'text' && event.text) {
              textContent += event.text
            }
          } catch {
            // Not JSON, might be plain text
            if (line.trim()) textContent += line + '\n'
          }
        } else if (line.trim()) {
          textContent += line + '\n'
        }
      }
      textContent = textContent.trim()
    }
    
    const m = {
      info: {
        id: messageId,
        role: 'assistant' as const,
        time: { created: Date.now() }
      },
      parts: [{ type: 'text', text: textContent }]
    }
    
    const parts = transformParts(m.parts ?? [])
    
    return {
      ok: true,
      message: {
        id: m.info.id,
        sessionId,
        role: m.info.role as 'user' | 'assistant',
        content: extractTextContent(parts),
        timestamp: formatTimestamp(m.info.time?.created),
        parts
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export async function abortSessionAction(slug: string, sessionId: string): Promise<{
  ok: boolean
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    await client!.session.abort({ sessionID: sessionId })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

// ============================================================================
// Diffs
// ============================================================================

type GitDiffEntry = {
  path: string
  status: 'modified' | 'added' | 'deleted'
  additions: number
  deletions: number
  diff: string
  conflicted: boolean
}

export async function getWorkspaceDiffsAction(slug: string): Promise<{
  ok: boolean
  diffs?: GitDiffEntry[]
  error?: string
}> {
  const session = await getAuthenticatedUser()
  if (!session) return { ok: false, error: 'unauthorized' }

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return { ok: false, error: 'forbidden' }
  }

  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) return { ok: false, error: 'instance_unavailable' }

  try {
    const response = await fetch(`${agent.baseUrl}/git/diffs`, {
      headers: {
        Authorization: agent.authHeader,
        Accept: 'application/json'
      },
      cache: 'no-store'
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { ok: false, error: `workspace_agent_http_${response.status}: ${errorText}` }
    }

    const data = await response.json() as { ok: boolean; diffs?: GitDiffEntry[]; error?: string }
    if (!data.ok) {
      return { ok: false, error: data.error ?? 'workspace_agent_error' }
    }

    return { ok: true, diffs: data.diffs ?? [] }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'workspace_agent_unreachable' }
  }
}

export async function getSessionDiffsAction(slug: string, sessionId: string): Promise<{
  ok: boolean
  diffs?: Array<{
    path: string
    status: 'modified' | 'added' | 'deleted'
    additions: number
    deletions: number
    diff: string
  }>
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    const result = await client!.session.diff({ sessionID: sessionId })
    const diffs = result.data ?? []
    
    return {
      ok: true,
      diffs: diffs.map(d => {
        // Determine status based on before/after content
        let status: 'modified' | 'added' | 'deleted' = 'modified'
        if (!d.before || d.before === '') status = 'added'
        else if (!d.after || d.after === '') status = 'deleted'
        
        // Generate unified diff format
        const diff = `--- a/${d.file}\n+++ b/${d.file}\n${generateUnifiedDiff(d.before, d.after)}`
        
        return {
          path: d.file,
          status,
          additions: d.additions,
          deletions: d.deletions,
          diff
        }
      })
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

/**
 * Generate a simple unified diff representation.
 */
function generateUnifiedDiff(before: string, after: string): string {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  
  // Simple line-by-line diff for display
  const lines: string[] = []
  const maxLines = Math.max(beforeLines.length, afterLines.length)
  
  for (let i = 0; i < maxLines; i++) {
    const beforeLine = beforeLines[i]
    const afterLine = afterLines[i]
    
    if (beforeLine === afterLine) {
      if (beforeLine !== undefined) lines.push(` ${beforeLine}`)
    } else {
      if (beforeLine !== undefined) lines.push(`-${beforeLine}`)
      if (afterLine !== undefined) lines.push(`+${afterLine}`)
    }
  }
  
  return lines.join('\n')
}

// ============================================================================
// Providers & Models
// ============================================================================

export async function listModelsAction(slug: string): Promise<{
  ok: boolean
  models?: AvailableModel[]
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    const result = await client!.config.providers()
    const data = result.data
    if (!data) return { ok: true, models: [] }
    
    const { providers, default: defaults } = data
    const models: AvailableModel[] = []
    
    for (const provider of providers ?? []) {
      // Models is an object with modelId as key
      const providerModels = provider.models ?? {}
      for (const [modelId, model] of Object.entries(providerModels)) {
        const isDefault = defaults?.[provider.id] === modelId
        models.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId,
          modelName: model.name ?? modelId,
          isDefault
        })
      }
    }
    
    // Sort: defaults first, then by provider name
    models.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1
      if (!a.isDefault && b.isDefault) return 1
      return a.providerName.localeCompare(b.providerName)
    })
    
    return { ok: true, models }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

// ============================================================================
// Agents
// ============================================================================

export async function listAgentsAction(slug: string): Promise<{
  ok: boolean
  agents?: Array<{ id: string; name: string; description?: string }>
  error?: string
}> {
  const { error, client } = await getAuthorizedClient(slug)
  if (error) return { ok: false, error }
  
  try {
    const result = await client!.app.agents()
    const agents = result.data ?? []
    
    return {
      ok: true,
      agents: agents.map(a => ({
        id: a.name, // Agent uses name as id
        name: a.name,
        description: a.description
      }))
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}
