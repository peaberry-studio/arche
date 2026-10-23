import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { KB_MAIN_REF, ZERO_OID, kbGit, proposalRef, readKbRef, validateKbCommit, withKbLock } from '@/lib/git/kb-publication'

const MAX_BYTES = 64 * 1024 * 1024

export async function serveKbGit(request: Request, repository: string, path: string, slug: string,
  accepted?: (event: { ref: string; commit: string; paths: string[] }) => Promise<void>,
): Promise<Response> {
  if (path !== 'info/refs' && path !== 'git-receive-pack') return Response.json({ error: 'not_found' }, { status: 404 })
  const ref = proposalRef(slug)
  return withKbLock(repository, async (signal) => {
    const directory = await mkdtemp(join(tmpdir(), 'arche-kb-quarantine-'))
    const quarantine = join(directory, 'repository.git')
    try {
      await kbGit(repository, ['clone', '--bare', '--shared', '--no-hardlinks', repository, quarantine], undefined, signal)
      const previous = await readKbRef(repository, ref, signal)
      const response = await receiveKbGit(request, quarantine, path, ref, previous, signal)
      if (request.method !== 'POST' || !response.ok) return response
      const commit = await readKbRef(quarantine, ref, signal)
      if (commit === previous) return response
      const base = await readKbRef(repository, KB_MAIN_REF, signal)
      const paths = await validateKbCommit(quarantine, commit, base, signal)
      if (previous !== ZERO_OID) await kbGit(quarantine, ['merge-base', '--is-ancestor', previous, commit], undefined, signal)
      await kbGit(repository, ['fetch', '--no-tags', '--no-write-fetch-head', quarantine, commit], undefined, signal)
      await kbGit(repository, ['update-ref', ref, commit, previous], undefined, signal)
      try { await accepted?.({ ref, commit, paths }) } catch (error) {
        await kbGit(repository, previous === ZERO_OID ? ['update-ref', '-d', ref, commit] : ['update-ref', ref, previous, commit])
        throw error
      }
      return response
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
}

function validatePush(body: Buffer, ref: string, previous: string): void {
  if (body.length < 8 || !/^[0-9a-f]{4}$/.test(body.subarray(0, 4).toString())) throw new Error('invalid_push')
  const length = Number.parseInt(body.subarray(0, 4).toString(), 16)
  if (length < 4 || length > 1024 || length > body.length || body.subarray(length, length + 4).toString() !== '0000') throw new Error('single_ref_push_required')
  const command = body.subarray(4, length).toString().split('\0')[0].trimEnd()
  const parts = command.split(' ')
  if (parts.length !== 3 || parts[2] !== ref || parts[0] !== previous || !/^[a-f0-9]{40}$/.test(parts[1]) || parts[1] === ZERO_OID) throw new Error('forbidden_push')
}

async function receiveKbGit(request: Request, repository: string, path: string, ref: string, previous: string, signal: AbortSignal): Promise<Response> {
  const query = new URL(request.url).searchParams
  const advertisement = request.method === 'GET' && path === 'info/refs' && query.get('service') === 'git-receive-pack'
  const push = request.method === 'POST' && path === 'git-receive-pack'
  if (!advertisement && !push) return Response.json({ error: 'not_found' }, { status: 404 })
  if (push && request.headers.get('content-type') !== 'application/x-git-receive-pack-request') {
    return Response.json({ error: 'invalid_content_type' }, { status: 415 })
  }
  if (request.headers.has('content-encoding')) return Response.json({ error: 'unsupported_encoding' }, { status: 415 })
  const chunks: Uint8Array[] = []
  let size = 0
  if (request.body) {
    const reader = request.body.getReader()
    while (true) {
      signal.throwIfAborted()
      const abort = () => { void reader.cancel() }
      signal.addEventListener('abort', abort, { once: true })
      const { value, done } = await reader.read().finally(() => signal.removeEventListener('abort', abort))
      signal.throwIfAborted()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) {
        await reader.cancel()
        return Response.json({ error: 'payload_too_large' }, { status: 413 })
      }
      chunks.push(value)
    }
  }
  const body = Buffer.concat(chunks)
  if (push) validatePush(body, ref, previous)
  const output = await new Promise<Buffer>((resolve, reject) => {
    const child = execFile('git', [
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'http.receivepack=true',
      '-c', 'receive.denyNonFastForwards=true',
      '-c', 'receive.denyDeletes=true',
      '-c', 'receive.fsckObjects=true',
      '-c', 'receive.maxInputSize=67108864',
      'http-backend',
    ], {
      encoding: 'buffer',
      signal,
      timeout: 60_000,
      maxBuffer: MAX_BYTES,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_PROJECT_ROOT: dirname(repository),
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: `/${basename(repository)}/${path}`,
        QUERY_STRING: advertisement ? 'service=git-receive-pack' : '',
        REQUEST_METHOD: request.method,
        CONTENT_TYPE: request.headers.get('content-type') ?? '',
        CONTENT_LENGTH: String(size),
        REMOTE_USER: 'workspace',
      },
    }, (error, stdout) => error ? reject(error) : resolve(stdout))
    child.stdin?.on('error', reject)
    child.stdin?.end(body)
  })
  const separator = output.indexOf('\r\n\r\n')
  if (separator < 0) throw new Error('invalid_git_backend_response')
  const headers = new Headers({ 'cache-control': 'no-store' })
  let status = 200
  for (const line of output.subarray(0, separator).toString().split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon)
    const value = line.slice(colon + 1).trim()
    if (key.toLowerCase() === 'status') status = Number.parseInt(value, 10)
    else if (key.toLowerCase() === 'content-type') headers.set(key, value)
  }
  return new Response(new Uint8Array(output.subarray(separator + 4)), { status, headers })
}
