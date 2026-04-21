import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from 'child_process'

export type RuntimeSupervisorState = 'stopped' | 'starting' | 'running' | 'error'

type ProcessExitSignal = NodeJS.Signals | null

type ChildProcessLike = Pick<
  ChildProcess,
  'kill' | 'killed' | 'on' | 'once' | 'pid' | 'stdout' | 'stderr'
>

type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessLike

type ReadinessProbe = () => Promise<boolean>

type RuntimeLogEvent = {
  component: string
  event: string
  state: RuntimeSupervisorState
  detail?: string
  pid?: number
  code?: number | null
  signal?: ProcessExitSignal
}

type RuntimeSupervisorOptions = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  componentName: string
  probeReadiness: ReadinessProbe
  readyTimeoutMs?: number
  readyPollIntervalMs?: number
  shutdownTimeoutMs?: number
  restartOnCrash?: boolean
  maxRestarts?: number
  platform?: NodeJS.Platform
  spawnProcess?: SpawnProcess
  log?: (event: RuntimeLogEvent) => void
}

type HttpProbeOptions = {
  headers?: Record<string, string>
  validateResponse?: (response: Response, bodyText: string) => boolean | Promise<boolean>
}

const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_READY_POLL_INTERVAL_MS = 250
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForExit(
  child: ChildProcessLike,
  timeoutMs: number,
): Promise<boolean> {
  if (child.killed) {
    return true
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

function killProcessTree(
  child: ChildProcessLike,
  platform: NodeJS.Platform,
  signal: NodeJS.Signals,
): void {
  const pid = child.pid

  if (!pid) {
    child.kill(signal)
    return
  }

  if (platform !== 'win32') {
    try {
      process.kill(-pid, signal)
      return
    } catch {
      // fall through to direct kill
    }
  }

  child.kill(signal)
}

export class RuntimeSupervisor {
  private readonly options: RuntimeSupervisorOptions
  private state: RuntimeSupervisorState = 'stopped'
  private child: ChildProcessLike | null = null
  private startPromise: Promise<void> | null = null
  private stopPromise: Promise<void> | null = null
  private expectedExit = false
  private restartCount = 0

  constructor(options: RuntimeSupervisorOptions) {
    this.options = options
  }

  getState(): RuntimeSupervisorState {
    return this.state
  }

  async start(): Promise<void> {
    if (this.state === 'running') {
      return
    }

    if (this.startPromise) {
      return this.startPromise
    }

    this.startPromise = this.startInternal()

    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise
    }

    this.stopPromise = this.stopInternal()

    try {
      await this.stopPromise
    } finally {
      this.stopPromise = null
    }
  }

  private async startInternal(): Promise<void> {
    this.transition('starting')

    const child = (this.options.spawnProcess ?? spawn)(
      this.options.command,
      this.options.args,
      {
        cwd: this.options.cwd,
        env: this.options.env,
        detached: this.getPlatform() !== 'win32',
        stdio: 'pipe',
      },
    )

    this.child = child
    this.expectedExit = false
    this.attachProcessLogging(child)

    const readyTimeoutMs = this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    const readyPollIntervalMs =
      this.options.readyPollIntervalMs ?? DEFAULT_READY_POLL_INTERVAL_MS

    await new Promise<void>((resolve, reject) => {
      let settled = false

      const fail = (error: Error) => {
        if (settled) {
          return
        }
        settled = true
        this.transition('error', error.message)
        reject(error)
      }

      const succeed = () => {
        if (settled) {
          return
        }
        settled = true
        this.transition('running', undefined, child.pid)
        resolve()
      }

      child.once('error', (error) => {
        const message = error instanceof Error ? error.message : 'spawn_failed'
        fail(new Error(`${this.options.componentName} failed to start: ${message}`))
      })

      child.once('exit', (code, signal) => {
        this.handleExit(code, signal)
        if (!settled && !this.expectedExit) {
          fail(
            new Error(
              `${this.options.componentName} exited before readiness (code=${String(code)}, signal=${String(signal)})`,
            ),
          )
        }
      })

      const deadline = Date.now() + readyTimeoutMs
      void (async () => {
        while (!settled) {
          if (Date.now() >= deadline) {
            fail(new Error(`${this.options.componentName} readiness timeout after ${readyTimeoutMs}ms`))
            return
          }

          try {
            const ready = await this.options.probeReadiness()
            if (ready) {
              succeed()
              return
            }
          } catch {
            // keep polling until timeout or process exit
          }

          await delay(readyPollIntervalMs)
        }
      })()
    }).catch(async (error) => {
      await this.stopInternal()
      throw error
    })
  }

  private async stopInternal(): Promise<void> {
    const child = this.child
    const preserveErrorState = this.state === 'error'

    if (!child) {
      if (!preserveErrorState) {
        this.transition('stopped')
      }
      return
    }

    this.expectedExit = true
    this.log({ event: 'shutdown_requested', state: this.state, pid: child.pid })

    killProcessTree(child, this.getPlatform(), 'SIGTERM')

    const shutdownTimeoutMs = this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    const exited = await waitForExit(child, shutdownTimeoutMs)
    if (!exited) {
      this.log({
        event: 'shutdown_escalated',
        state: this.state,
        pid: child.pid,
        detail: `timeout=${shutdownTimeoutMs}`,
      })
      killProcessTree(child, this.getPlatform(), 'SIGKILL')
      await waitForExit(child, shutdownTimeoutMs)
    }

    this.child = null
    if (!preserveErrorState) {
      this.transition('stopped')
    }
  }

  private attachProcessLogging(child: ChildProcessLike): void {
    child.stdout?.on('data', (data: Buffer | string) => {
      this.log({
        event: 'stdout',
        state: this.state,
        pid: child.pid,
        detail: data.toString().trim(),
      })
    })

    child.stderr?.on('data', (data: Buffer | string) => {
      this.log({
        event: 'stderr',
        state: this.state,
        pid: child.pid,
        detail: data.toString().trim(),
      })
    })
  }

  private handleExit(code: number | null, signal: ProcessExitSignal): void {
    this.log({ event: 'exit', state: this.state, pid: this.child?.pid, code, signal })

    if (this.expectedExit) {
      this.child = null
      return
    }

    this.child = null

    const maxRestarts = this.options.maxRestarts ?? 3
    if (
      this.options.restartOnCrash &&
      this.state === 'running' &&
      this.restartCount < maxRestarts
    ) {
      this.restartCount++
      this.log({
        event: 'restart',
        state: this.state,
        detail: `attempt=${this.restartCount}/${maxRestarts}`,
      })
      void this.startInternal().catch(() => {
        this.transition('error', `restart failed after ${this.restartCount} attempts`)
      })
      return
    }

    this.transition('error', `code=${String(code)} signal=${String(signal)}`)
  }

  private transition(
    state: RuntimeSupervisorState,
    detail?: string,
    pid?: number,
  ): void {
    this.state = state
    this.log({ event: 'state_changed', state, detail, pid })
  }

  private log(event: Omit<RuntimeLogEvent, 'component'>): void {
    this.options.log?.({ component: this.options.componentName, ...event })
  }

  private getPlatform(): NodeJS.Platform {
    return this.options.platform ?? process.platform
  }
}

export async function probeHttpServerReady(
  url: string,
  options: HttpProbeOptions = {},
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: options.headers,
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(1_000),
    })

    if (options.validateResponse) {
      const bodyText = await response.text()
      return await options.validateResponse(response, bodyText)
    }

    return response.status > 0
  } catch {
    return false
  }
}
