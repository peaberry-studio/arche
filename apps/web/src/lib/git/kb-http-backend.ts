import { execFile } from 'node:child_process'
import { basename, dirname } from 'node:path'

const MAX_BYTES = 64 * 1024 * 1024

export async function serveKbGit(request: Request, repository: string, path: string): Promise<Response> {
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
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) {
        await reader.cancel()
        return Response.json({ error: 'payload_too_large' }, { status: 413 })
      }
      chunks.push(value)
    }
  }
  const output = await new Promise<Buffer>((resolve, reject) => {
    const child = execFile('git', [
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'http.receivepack=true',
      '-c', 'receive.denyNonFastForwards=true',
      '-c', 'receive.denyDeletes=true',
      'http-backend',
    ], {
      encoding: 'buffer',
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
    child.stdin?.end(Buffer.concat(chunks))
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
