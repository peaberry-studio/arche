'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import {
  checkConnectionAction,
  listSessionsAction,
  createSessionAction,
  deleteSessionAction,
  updateSessionAction,
  listMessagesAction,
  abortSessionAction,
  loadFileTreeAction,
  readFileAction,
  getWorkspaceDiffsAction,
  listModelsAction
} from '@/actions/opencode'
import {
  readWorkspaceFileAction,
  writeWorkspaceFileAction,
  deleteWorkspaceFileAction,
  applyWorkspacePatchAction
} from '@/actions/workspace-agent'
import type {
  WorkspaceFileNode,
  WorkspaceSession,
  WorkspaceMessage,
  WorkspaceConnectionState,
  AvailableModel,
  MessageStatus
} from '@/lib/opencode/types'

export type WorkspaceDiff = {
  path: string
  status: 'modified' | 'added' | 'deleted'
  additions: number
  deletions: number
  diff: string
  conflicted: boolean
}

export type UseWorkspaceOptions = {
  slug: string
  /** Poll interval in ms for session status updates */
  pollInterval?: number
  /** Skip connection attempts when false */
  enabled?: boolean
}

export type UseWorkspaceReturn = {
  // Connection
  connection: WorkspaceConnectionState
  isConnected: boolean
  
  // Files
  fileTree: WorkspaceFileNode[]
  isLoadingFiles: boolean
  refreshFiles: () => Promise<void>
  readFile: (path: string) => Promise<{ content: string; type: 'raw' | 'patch' } | null>
  writeFile: (path: string, content: string, expectedHash?: string) => Promise<{ ok: boolean; hash?: string }>
  deleteFile: (path: string) => Promise<boolean>
  applyPatch: (patch: string) => Promise<boolean>
  
  // Sessions
  sessions: WorkspaceSession[]
  activeSessionId: string | null
  activeSession: WorkspaceSession | null
  isLoadingSessions: boolean
  selectSession: (id: string) => void
  createSession: (title?: string) => Promise<WorkspaceSession | null>
  deleteSession: (id: string) => Promise<boolean>
  renameSession: (id: string, title: string) => Promise<boolean>
  
  // Messages
  messages: WorkspaceMessage[]
  isLoadingMessages: boolean
  isSending: boolean
  sendMessage: (text: string, model?: { providerId: string; modelId: string }) => Promise<void>
  abortSession: () => Promise<void>
  refreshMessages: () => Promise<void>
  
  // Diffs
  diffs: WorkspaceDiff[]
  isLoadingDiffs: boolean
  diffsError: string | null
  refreshDiffs: () => Promise<void>
  
  // Models
  models: AvailableModel[]
  selectedModel: AvailableModel | null
  setSelectedModel: (model: AvailableModel | null) => void
}

export function useWorkspace({ slug, pollInterval = 5000, enabled = true }: UseWorkspaceOptions): UseWorkspaceReturn {
  // Connection state
  const [connection, setConnection] = useState<WorkspaceConnectionState>({ status: 'connecting' })
  
  // Files
  const [fileTree, setFileTree] = useState<WorkspaceFileNode[]>([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  
  // Sessions
  const [sessions, setSessions] = useState<WorkspaceSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  
  // Messages
  const [messages, setMessages] = useState<WorkspaceMessage[]>([])
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const isSendingRef = useRef(false) // Ref to track sending state without causing re-renders
  
  // Diffs
  const [diffs, setDiffs] = useState<WorkspaceDiff[]>([])
  const [isLoadingDiffs, setIsLoadingDiffs] = useState(false)
  const [diffsError, setDiffsError] = useState<string | null>(null)
  const [diffsRefreshTrigger, setDiffsRefreshTrigger] = useState(0)
  const isLoadingDiffsRef = useRef(false)
  
  // Models
  const [models, setModels] = useState<AvailableModel[]>([])
  const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null)
  
  const isConnected = connection.status === 'connected'
  
  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null
  
  // Check connection
  const checkConnection = useCallback(async () => {
    const result = await checkConnectionAction(slug)
    setConnection(result)
    return result.status === 'connected'
  }, [slug])
  
  // Load files
  const refreshFiles = useCallback(async () => {
    setIsLoadingFiles(true)
    try {
      const result = await loadFileTreeAction(slug)
      if (result.ok && result.tree) {
        setFileTree(result.tree)
      }
    } finally {
      setIsLoadingFiles(false)
    }
  }, [slug])
  
  // Read single file
  const readFile = useCallback(async (path: string) => {
    const agentResult = await readWorkspaceFileAction(slug, path)
    if (agentResult.ok && agentResult.content) {
      return { content: agentResult.content.content, type: agentResult.content.type }
    }

    const result = await readFileAction(slug, path)
    if (result.ok && result.content) {
      return { content: result.content.content, type: result.content.type }
    }

    return null
  }, [slug])

  const writeFile = useCallback(async (path: string, content: string, expectedHash?: string) => {
    const result = await writeWorkspaceFileAction(slug, path, content, expectedHash)
    if (result.ok) {
      return { ok: true, hash: result.hash }
    }
    return { ok: false }
  }, [slug])

  const deleteFile = useCallback(async (path: string) => {
    const result = await deleteWorkspaceFileAction(slug, path)
    return result.ok
  }, [slug])

  const applyPatch = useCallback(async (patch: string) => {
    const result = await applyWorkspacePatchAction(slug, patch)
    return result.ok
  }, [slug])
  
  // Load sessions
  const loadSessions = useCallback(async () => {
    console.log('[useWorkspace] loadSessions: loading...')
    setIsLoadingSessions(true)
    try {
      const result = await listSessionsAction(slug)
      console.log('[useWorkspace] loadSessions result:', result.ok, 'sessions:', result.sessions?.length)
      if (result.ok && result.sessions) {
        setSessions(result.sessions)
        
        // Auto-select first session if none selected
        // Use functional update to avoid dependency on activeSessionId
        const sessions = result.sessions
        setActiveSessionId(prev => {
          if (!prev && sessions.length > 0) {
            console.log('[useWorkspace] Auto-selecting first session:', sessions[0].id)
            return sessions[0].id
          }
          return prev
        })
      }
    } finally {
      setIsLoadingSessions(false)
    }
  }, [slug])
  
  // Select session
  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id)
    setMessages([]) // Clear messages when switching sessions
  }, [])
  
  // Create session
  const createSession = useCallback(async (title?: string) => {
    const result = await createSessionAction(slug, title)
    if (result.ok && result.session) {
      setSessions(prev => [result.session!, ...prev])
      setActiveSessionId(result.session.id)
      setMessages([])
      return result.session
    }
    return null
  }, [slug])
  
  // Delete session
  const deleteSession = useCallback(async (id: string) => {
    const result = await deleteSessionAction(slug, id)
    if (result.ok) {
      setSessions(prev => {
        const filtered = prev.filter(s => s.id !== id)
        // Select another session if the deleted one was active
        if (activeSessionId === id && filtered.length > 0) {
          setActiveSessionId(filtered[0].id)
        } else if (filtered.length === 0) {
          setActiveSessionId(null)
        }
        return filtered
      })
      return true
    }
    return false
  }, [slug, activeSessionId])
  
  // Rename session
  const renameSession = useCallback(async (id: string, title: string) => {
    const result = await updateSessionAction(slug, id, title)
    if (result.ok && result.session) {
      setSessions(prev => prev.map(s => s.id === id ? result.session! : s))
      return true
    }
    return false
  }, [slug])
  
  // Load messages for active session
  const refreshMessages = useCallback(async () => {
    if (!activeSessionId) {
      console.log('[useWorkspace] refreshMessages: no activeSessionId, skipping')
      return
    }
    
    // Don't refresh if we're currently sending a message (use ref to avoid dependency)
    if (isSendingRef.current) {
      console.log('[useWorkspace] refreshMessages: skipping, currently sending')
      return
    }
    
    console.log('[useWorkspace] refreshMessages: loading for session', activeSessionId)
    setIsLoadingMessages(true)
    try {
      const result = await listMessagesAction(slug, activeSessionId)
      console.log('[useWorkspace] refreshMessages result:', result.ok, 'messages:', result.messages?.length)
      if (result.ok && result.messages) {
        setMessages(result.messages)
      }
    } finally {
      setIsLoadingMessages(false)
    }
  }, [slug, activeSessionId])
  
  // Send message with SSE streaming
  const sendMessage = useCallback(async (text: string, model?: { providerId: string; modelId: string }) => {
    console.log('[useWorkspace] sendMessage called', { text, model, activeSessionId })
    
    // Auto-create session if none exists
    let sessionId = activeSessionId
    if (!sessionId) {
      console.log('[useWorkspace] No activeSessionId, creating new session')
      const newSession = await createSession()
      if (!newSession) {
        console.log('[useWorkspace] Failed to create session')
        return
      }
      sessionId = newSession.id
    }
    
    // Add optimistic user message
    const tempUserMsgId = `temp-user-${Date.now()}`
    const tempUserMsg: WorkspaceMessage = {
      id: tempUserMsgId,
      sessionId: sessionId,
      role: 'user',
      content: text,
      timestamp: 'Just now',
      parts: [{ type: 'text', text }],
      pending: true
    }
    
    // Add placeholder assistant message with "connecting" status
    const tempAssistantMsgId = `temp-assistant-${Date.now()}`
    const tempAssistantMsg: WorkspaceMessage = {
      id: tempAssistantMsgId,
      sessionId: sessionId,
      role: 'assistant',
      content: '',
      timestamp: 'Just now',
      parts: [],
      pending: true,
      statusInfo: { status: 'thinking' }
    }
    
    setMessages(prev => [...prev, tempUserMsg, tempAssistantMsg])
    setIsSending(true)
    isSendingRef.current = true
    
    let accumulatedText = ''
    let streamCompleted = false
    
    try {
      // Use SSE streaming endpoint
      const response = await fetch(`/api/w/${slug}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text, model })
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to send message')
      }
      
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }
      
      const decoder = new TextDecoder()
      let buffer = ''
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        
        // Parse SSE events
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        
        let eventType = ''
        let eventData = ''
        
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            eventData = line.slice(5).trim()
          } else if (line === '' && eventData) {
            // Process event
            try {
              const data = JSON.parse(eventData)
              
              switch (eventType) {
                case 'status': {
                  const status = data.status as MessageStatus
                  setMessages(prev => prev.map(m => {
                    if (m.id === tempAssistantMsgId) {
                      return {
                        ...m,
                        statusInfo: { 
                          status,
                          toolName: data.toolName,
                          detail: data.detail
                        }
                      }
                    }
                    return m
                  }))
                  break
                }
                
                case 'message_start': {
                  // Message started - we don't need to track the ID since we refresh at the end
                  console.log('[useWorkspace] Message started:', data.messageId)
                  break
                }
                
                case 'text': {
                  accumulatedText += data.text || ''
                  setMessages(prev => prev.map(m => {
                    if (m.id === tempAssistantMsgId) {
                      return {
                        ...m,
                        content: accumulatedText,
                        statusInfo: { status: 'writing' }
                      }
                    }
                    return m
                  }))
                  break
                }
                
                case 'tool': {
                  // Tool invocation - update status to show which tool is being used
                  console.log('[useWorkspace] Tool event:', data.name, data.status)
                  if (data.status === 'running' || data.status === 'pending') {
                    setMessages(prev => prev.map(m => {
                      if (m.id === tempAssistantMsgId) {
                        return {
                          ...m,
                          statusInfo: { 
                            status: 'tool-calling',
                            toolName: data.name,
                            detail: data.title
                          }
                        }
                      }
                      return m
                    }))
                  }
                  break
                }
                
                case 'done': {
                  // Stream completed - mark as done, cleanup will happen in finally
                  console.log('[useWorkspace] done event received')
                  streamCompleted = true
                  break
                }
                
                case 'error': {
                  setMessages(prev => prev.map(m => {
                    if (m.id === tempAssistantMsgId) {
                      return {
                        ...m,
                        pending: false,
                        statusInfo: { status: 'error', detail: data.error }
                      }
                    }
                    return m
                  }))
                  break
                }
              }
            } catch {
              // Invalid JSON, skip
            }
            
            eventType = ''
            eventData = ''
          }
        }
      }
      
    } catch (error) {
      console.error('[useWorkspace] Streaming error:', error)
      setMessages(prev => prev.map(m => {
        if (m.id === tempAssistantMsgId) {
          return {
            ...m,
            pending: false,
            statusInfo: { 
              status: 'error', 
              detail: error instanceof Error ? error.message : 'Unknown error' 
            }
          }
        }
        if (m.id === tempUserMsgId) {
          return { ...m, pending: false }
        }
        return m
      }))
    } finally {
      // If stream completed successfully, fetch final messages from server
      if (streamCompleted) {
        console.log('[useWorkspace] Stream completed, fetching final messages')
        
        // FIRST: Remove the temp assistant message to prevent duplication
        setMessages(prev => prev.filter(m => m.id !== tempAssistantMsgId))
        
        // Small delay to ensure server has persisted the message
        await new Promise(resolve => setTimeout(resolve, 100))
        
        const result = await listMessagesAction(slug, sessionId)
        if (result.ok && result.messages) {
          setMessages(result.messages)
        }
        // Trigger diffs refresh
        setDiffsRefreshTrigger(prev => prev + 1)
      }
      
      setIsSending(false)
      isSendingRef.current = false
    }
  }, [slug, activeSessionId, createSession])
  
  // Abort session
  const abortSession = useCallback(async () => {
    if (!activeSessionId) return
    await abortSessionAction(slug, activeSessionId)
  }, [slug, activeSessionId])
  
  // Load diffs
  const refreshDiffs = useCallback(async () => {
    if (!enabled) return
    if (!isConnected) return

    // Avoid overlapping refreshes (interval + manual triggers)
    if (isLoadingDiffsRef.current) return

    setIsLoadingDiffs(true)
    isLoadingDiffsRef.current = true
    try {
      console.log('[useWorkspace] refreshDiffs: loading...')
      const result = await getWorkspaceDiffsAction(slug)
      if (result.ok && result.diffs) {
        setDiffs(result.diffs)
        setDiffsError(null)
        console.log('[useWorkspace] refreshDiffs result:', true, 'diffs:', result.diffs.length)
      } else {
        const err = result.error ?? 'unknown'
        setDiffsError(err)
        console.log('[useWorkspace] refreshDiffs result:', false, 'error:', err)
      }
    } finally {
      setIsLoadingDiffs(false)
      isLoadingDiffsRef.current = false
    }
  }, [slug, enabled, isConnected])
  
  // Load models
  const loadModels = useCallback(async () => {
    const result = await listModelsAction(slug)
    if (result.ok && result.models) {
      setModels(result.models)
      // Auto-select default model
      const defaultModel = result.models.find(m => m.isDefault)
      if (defaultModel) {
        setSelectedModel(defaultModel)
      }
    }
  }, [slug])
  
  // Initial load when connected - with retry on failure
  useEffect(() => {
    if (!enabled) {
      setConnection({ status: 'connecting' })
      return
    }

    let mounted = true
    let retryTimeout: ReturnType<typeof setTimeout> | null = null
    let retryCount = 0
    const MAX_RETRIES = 10
    const BASE_DELAY = 1000

    async function init() {
      const connected = await checkConnection()
      if (!mounted) return

      if (connected) {
        retryCount = 0 // Reset on success
        // Load initial data in parallel
        await Promise.all([
          refreshFiles(),
          loadSessions(),
          loadModels(),
          refreshDiffs(),
        ])
      } else if (retryCount < MAX_RETRIES) {
        // Retry with exponential backoff (1s, 2s, 4s, 8s... capped at 30s)
        retryCount++
        const delay = Math.min(BASE_DELAY * Math.pow(2, retryCount - 1), 30000)
        console.log(`[useWorkspace] Connection failed, retrying in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES})`)
        retryTimeout = setTimeout(() => {
          if (mounted) init()
        }, delay)
      } else {
        console.log('[useWorkspace] Max retries reached, giving up')
      }
    }

    init()

    return () => {
      mounted = false
      if (retryTimeout) clearTimeout(retryTimeout)
    }
  }, [checkConnection, refreshFiles, loadSessions, loadModels, refreshDiffs, enabled])
  
  // Load messages when active session changes
  useEffect(() => {
    console.log('[useWorkspace] activeSessionId changed:', activeSessionId, 'isConnected:', isConnected)
    if (activeSessionId && isConnected) {
      refreshMessages()
    }
  }, [activeSessionId, isConnected, refreshMessages])
  
  // Refresh diffs when triggered by message completion
  useEffect(() => {
    if (diffsRefreshTrigger > 0 && isConnected) {
      refreshDiffs()
    }
  }, [diffsRefreshTrigger, isConnected, refreshDiffs])

  
  // Poll for session status updates
  useEffect(() => {
    if (!isConnected || pollInterval <= 0) return
    
    const interval = setInterval(() => {
      loadSessions()
      refreshDiffs()
    }, pollInterval)
    
    return () => clearInterval(interval)
  }, [isConnected, pollInterval, loadSessions, refreshDiffs])
  
  return {
    connection,
    isConnected,
    fileTree,
    isLoadingFiles,
    refreshFiles,
    readFile,
    writeFile,
    deleteFile,
    applyPatch,
    sessions,
    activeSessionId,
    activeSession,
    isLoadingSessions,
    selectSession,
    createSession,
    deleteSession,
    renameSession,
    messages,
    isLoadingMessages,
    isSending,
    sendMessage,
    abortSession,
    refreshMessages,
    diffs,
    isLoadingDiffs,
    diffsError,
    refreshDiffs,
    models,
    selectedModel,
    setSelectedModel
  }
}
