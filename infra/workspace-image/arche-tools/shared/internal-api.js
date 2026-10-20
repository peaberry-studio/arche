export function getInternalHeaders() {
  const slug = process.env.ARCHE_WORKSPACE_SLUG
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!slug || !password) return null

  return {
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
    'Content-Type': 'application/json',
    'x-arche-workspace-slug': slug,
  }
}

export async function callInternalApi(path, body) {
  const baseUrl = process.env.ARCHE_INTERNAL_API_BASE_URL
  const headers = getInternalHeaders()
  if (!baseUrl || !headers) return { ok: false, error: 'missing_internal_api_config' }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) {
    return { ok: false, error: data?.error ?? `http_${response.status}` }
  }

  return { ok: true, data }
}
