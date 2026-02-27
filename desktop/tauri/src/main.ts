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

function setLogs(value: string) {
  if (!logsEl) return
  logsEl.textContent = value
}

async function refresh() {
  const status = await invoke('status_arche')
  setStatus(status)
  const logs = await invoke<string>('tail_logs')
  setLogs(logs)
}

startBtn?.addEventListener('click', async () => {
  setStatus('Starting runtime...')
  try {
    const output = await invoke('start_arche')
    setStatus(output)
  } catch (error) {
    setStatus({ error })
  }
  await refresh()
})

stopBtn?.addEventListener('click', async () => {
  setStatus('Stopping runtime...')
  try {
    const output = await invoke('stop_arche')
    setStatus(output)
  } catch (error) {
    setStatus({ error })
  }
  await refresh()
})

refreshBtn?.addEventListener('click', async () => {
  await refresh()
})

refresh().catch((error) => setStatus({ error }))
