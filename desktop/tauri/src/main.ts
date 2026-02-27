import { invoke } from '@tauri-apps/api/core'

const statusEl = document.querySelector<HTMLPreElement>('#status')
const logsEl = document.querySelector<HTMLPreElement>('#logs')
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')
const stopBtn = document.querySelector<HTMLButtonElement>('#stop-btn')
const refreshBtn = document.querySelector<HTMLButtonElement>('#refresh-btn')

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

async function refresh() {
  try {
    const status = await invoke('status_arche')
    setStatus(status)
  } catch (error) {
    setStatus({ action: 'status_arche', ...formatError(error) })
  }

  try {
    const logs = await invoke<string>('tail_logs')
    setLogs(logs)
  } catch (error) {
    setLogs(JSON.stringify({ action: 'tail_logs', ...formatError(error) }, null, 2))
  }
}

startBtn?.addEventListener('click', async () => {
  setStatus('Starting runtime...')
  try {
    const output = await invoke('start_arche')
    setStatus(output)
    await refresh()
  } catch (error) {
    setStatus({ action: 'start_arche', ...formatError(error) })
    try {
      const logs = await invoke<string>('tail_logs')
      setLogs(logs)
    } catch {
      // no-op
    }
  }
})

stopBtn?.addEventListener('click', async () => {
  setStatus('Stopping runtime...')
  try {
    const output = await invoke('stop_arche')
    setStatus(output)
    await refresh()
  } catch (error) {
    setStatus({ action: 'stop_arche', ...formatError(error) })
  }
})

refreshBtn?.addEventListener('click', async () => {
  await refresh()
})

refresh().catch((error) => setStatus({ error }))
