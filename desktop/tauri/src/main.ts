import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

const statusEl = document.querySelector<HTMLPreElement>('#status')
const logsEl = document.querySelector<HTMLPreElement>('#logs')
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')
const stopBtn = document.querySelector<HTMLButtonElement>('#stop-btn')
const refreshBtn = document.querySelector<HTMLButtonElement>('#refresh-btn')
const startProgressEl = document.querySelector<HTMLDivElement>('#start-progress')
const startProgressLabelEl = document.querySelector<HTMLElement>('#start-progress-label')
const startProgressPercentEl = document.querySelector<HTMLElement>('#start-progress-percent')
const startProgressFillEl = document.querySelector<HTMLDivElement>('#start-progress-fill')

const LIVE_LOG_LINES_LIMIT = 220

const START_PHASES: Record<string, { label: string; progress: number }> = {
  prepare: { label: 'Preparando runtime', progress: 10 },
  vm_disk: { label: 'Provisionando VM', progress: 28 },
  vm_boot: { label: 'Arrancando VM', progress: 45 },
  images: { label: 'Cargando imagenes', progress: 62 },
  services: { label: 'Iniciando servicios', progress: 80 },
  migrate: { label: 'Aplicando migraciones', progress: 86 },
  health: { label: 'Verificando estado', progress: 94 },
  ready: { label: 'Runtime listo', progress: 100 },
}

let isStartInProgress = false
let startProgressValue = 0
let liveLogLines: string[] = []

type RuntimeCommandErrorEvent = {
  action: string
  error: string
}

type RuntimeCommandProgressEvent = {
  action: string
  stream: string
  phase: string | null
  message: string
}

type RuntimeCommandFinishedEvent = {
  action: string
  ok: boolean
  output: string
}

function setStatus(value: unknown) {
  if (!statusEl) return
  statusEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    }
  }
  return { error }
}

function setLogs(value: string) {
  if (!logsEl) return
  logsEl.textContent = value
}

function appendLiveLogLine(line: string) {
  if (!line.trim()) return
  liveLogLines.push(line)
  if (liveLogLines.length > LIVE_LOG_LINES_LIMIT) {
    liveLogLines = liveLogLines.slice(liveLogLines.length - LIVE_LOG_LINES_LIMIT)
  }
  setLogs(liveLogLines.join('\n'))
}

function setButtonsDisabled(disabled: boolean) {
  if (startBtn) startBtn.disabled = disabled
  if (stopBtn) stopBtn.disabled = disabled
  if (refreshBtn) refreshBtn.disabled = disabled
}

function setStartProgress(progress: number, label: string, active: boolean) {
  startProgressValue = Math.max(0, Math.min(100, progress))
  if (startProgressEl) {
    startProgressEl.dataset.active = active ? 'true' : 'false'
  }
  if (startProgressLabelEl) {
    startProgressLabelEl.textContent = label
  }
  if (startProgressPercentEl) {
    startProgressPercentEl.textContent = `${Math.round(startProgressValue)}%`
  }
  if (startProgressFillEl) {
    startProgressFillEl.style.width = `${startProgressValue}%`
  }
}

function beginStartProgress() {
  if (!isStartInProgress) {
    liveLogLines = []
    isStartInProgress = true
  }
  setButtonsDisabled(true)
  setStartProgress(Math.max(startProgressValue, 6), 'Inicializando runtime', true)
}

function finishStartProgress(label: string, progress: number) {
  isStartInProgress = false
  setButtonsDisabled(false)
  setStartProgress(progress, label, false)
}

function extractStartResult(output: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const lastLine = lines.at(-1)
  if (!lastLine) {
    return { ok: true }
  }

  try {
    return JSON.parse(lastLine)
  } catch {
    return { ok: true, output: lastLine }
  }
}

async function refresh() {
  try {
    const status = await invoke('status_arche')
    setStatus(status)
  } catch (error) {
    setStatus({ action: 'status_arche', ...formatError(error) })
  }

  await refreshLogs()
}

async function refreshLogs() {
  try {
    const logs = await invoke<string>('tail_logs')
    setLogs(logs)
  } catch (error) {
    setLogs(JSON.stringify({ action: 'tail_logs', ...formatError(error) }, null, 2))
  }
}

startBtn?.addEventListener('click', async () => {
  beginStartProgress()
  appendLiveLogLine('[start] Solicitud de arranque enviada')
  setStatus('Starting runtime...')
  try {
    await invoke('start_arche')
  } catch (error) {
    setStatus({ action: 'start_arche', ...formatError(error) })
    appendLiveLogLine(`[error] ${JSON.stringify(formatError(error))}`)
    finishStartProgress('Error al iniciar', Math.max(startProgressValue, 8))
    await refreshLogs()
  }
})

stopBtn?.addEventListener('click', async () => {
  setStatus('Stopping runtime...')
  try {
    const output = await invoke('stop_arche')
    setStatus(output)
    if (!isStartInProgress) {
      setStartProgress(0, 'Runtime detenido', false)
    }
    await refresh()
  } catch (error) {
    setStatus({ action: 'stop_arche', ...formatError(error) })
  }
})

refreshBtn?.addEventListener('click', async () => {
  await refresh()
})

listen('runtime-refresh-requested', () => {
  void refresh()
}).catch(() => {
  // no-op
})

listen<RuntimeCommandProgressEvent>('runtime-command-progress', (event) => {
  if (event.payload.action !== 'start_arche') {
    return
  }

  if (!isStartInProgress) {
    beginStartProgress()
  }

  const phaseDetails = event.payload.phase ? START_PHASES[event.payload.phase] : undefined
  const nextProgress = phaseDetails
    ? Math.max(startProgressValue, phaseDetails.progress)
    : startProgressValue
  const nextLabel = phaseDetails?.label ?? event.payload.message

  setStartProgress(nextProgress, nextLabel, true)
  appendLiveLogLine(`[${event.payload.stream}] ${event.payload.message}`)
}).catch(() => {
  // no-op
})

listen<RuntimeCommandFinishedEvent>('runtime-command-finished', (event) => {
  if (event.payload.action !== 'start_arche') {
    return
  }

  setStatus(extractStartResult(event.payload.output))
  appendLiveLogLine('[start] Runtime iniciado correctamente')
  finishStartProgress('Runtime listo', 100)
  void refresh()
}).catch(() => {
  // no-op
})

listen<RuntimeCommandErrorEvent>('runtime-command-error', (event) => {
  setStatus({ action: event.payload.action, error: event.payload.error })
  appendLiveLogLine(`[error] ${event.payload.error}`)
  if (event.payload.action === 'start_arche') {
    finishStartProgress('Error al iniciar', Math.max(startProgressValue, 10))
    void refreshLogs()
    return
  }
  void refresh()
}).catch(() => {
  // no-op
})

setButtonsDisabled(false)
setStartProgress(0, 'Idle', false)

refresh().catch((error) => setStatus({ error }))
