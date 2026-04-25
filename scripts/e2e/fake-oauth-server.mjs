import { createServer } from 'node:http'
import { URL } from 'node:url'

const port = Number.parseInt(process.env.ARCHE_E2E_FAKE_OAUTH_PORT ?? '4212', 10)
const host = process.env.ARCHE_E2E_FAKE_OAUTH_HOST ?? '127.0.0.1'

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${host}:${port}`)

  if (req.method === 'GET' && url.pathname === '/__e2e/health') {
    sendJson(res, 200, { ok: true, version: 'e2e-fake-oauth' })
    return
  }

  if (req.method === 'GET' && url.pathname === '/mcp') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
    sendJson(res, 200, {
      issuer: `http://${host}:${port}`,
      authorization_endpoint: `http://${host}:${port}/authorize`,
      token_endpoint: `http://${host}:${port}/token`,
      registration_endpoint: `http://${host}:${port}/register`,
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri')
    const state = url.searchParams.get('state')
    const code = 'fake-oauth-code-' + Date.now()

    if (!redirectUri) {
      sendJson(res, 400, { error: 'missing redirect_uri' })
      return
    }

    const redirect = new URL(redirectUri)
    redirect.searchParams.set('code', code)
    if (state) redirect.searchParams.set('state', state)

    res.writeHead(302, { Location: redirect.toString() })
    res.end()
    return
  }

  if (req.method === 'POST' && url.pathname === '/token') {
    const body = (await readBody(req)).toString('utf8')
    const params = new URLSearchParams(body)

    const grantType = params.get('grant_type')
    const code = params.get('code')

    if (grantType === 'authorization_code' && !code) {
      sendJson(res, 400, { error: 'invalid_request' })
      return
    }

    sendJson(res, 200, {
      access_token: 'fake-access-token-' + Date.now(),
      refresh_token: 'fake-refresh-token-' + Date.now(),
      token_type: 'Bearer',
      expires_in: 3600,
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/register') {
    sendJson(res, 200, {
      client_id: 'fake-registered-client-' + Date.now(),
      client_secret: 'fake-registered-secret-' + Date.now(),
    })
    return
  }

  sendJson(res, 404, { error: 'not_found' })
})

server.listen(port, host, () => {
  console.log(`[fake-oauth] listening on http://${host}:${port}`)
})
