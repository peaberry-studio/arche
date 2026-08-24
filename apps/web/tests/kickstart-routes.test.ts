import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

const mockValidateSameOrigin = vi.fn()
vi.mock('@/lib/csrf', () => ({
  validateSameOrigin: (...args: unknown[]) => mockValidateSameOrigin(...args),
}))

const mockGetKickstartTemplateSummaries = vi.fn()
vi.mock('@/kickstart/templates', () => ({
  getKickstartTemplateSummaries: (...args: unknown[]) =>
    mockGetKickstartTemplateSummaries(...args),
}))

const mockGetKickstartAgentSummaries = vi.fn()
vi.mock('@/kickstart/agents/catalog', () => ({
  getKickstartAgentSummaries: (...args: unknown[]) =>
    mockGetKickstartAgentSummaries(...args),
}))

const mockApplyKickstart = vi.fn()
vi.mock('@/kickstart/apply', () => ({
  applyKickstart: (...args: unknown[]) => mockApplyKickstart(...args),
}))

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { user: { id: 'user-1', email: 'a@b.com', slug, role }, sessionId: 's1' }
}

async function callTemplates(slug = 'alice') {
  const { GET } = await import('@/app/api/u/[slug]/kickstart/templates/route')
  const request = new Request(`http://localhost/api/u/${slug}/kickstart/templates`)
  const response = await GET(request as never, { params: Promise.resolve({ slug }) })
  return { status: response.status, body: await response.json() }
}

async function callApply(slug = 'alice', body: unknown = {}) {
  const { POST } = await import('@/app/api/u/[slug]/kickstart/apply/route')
  const request = new Request(`http://localhost/api/u/${slug}/kickstart/apply`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const response = await POST(request as never, { params: Promise.resolve({ slug }) })
  return { status: response.status, body: await response.json() }
}

async function callApplyRaw(slug = 'alice', rawBody = '{}') {
  const { POST } = await import('@/app/api/u/[slug]/kickstart/apply/route')
  const request = new Request(`http://localhost/api/u/${slug}/kickstart/apply`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      'content-type': 'application/json',
    },
    body: rawBody,
  })
  const response = await POST(request as never, { params: Promise.resolve({ slug }) })
  return { status: response.status, body: await response.json() }
}

describe('kickstart routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice', 'ADMIN'))
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockGetKickstartTemplateSummaries.mockReturnValue([
      {
        id: 'blank',
        label: 'Blank',
        description: 'Minimal template',
        recommendedAgentIds: ['assistant'],
        agentOverrides: {},
      },
    ])
    mockGetKickstartAgentSummaries.mockReturnValue([
      {
        id: 'assistant',
        displayName: 'Assistant',
        description: 'Primary assistant',
        systemPrompt: 'prompt',
        recommendedModel: 'opencode/big-pickle',
        temperature: 0.2,
        tools: ['read'],
      },
    ])
    mockApplyKickstart.mockResolvedValue({ ok: true })
  })

  it('GET templates returns catalog payload', async () => {
    const { status, body } = await callTemplates('alice')
    expect(status).toBe(200)
    expect(body.templates).toHaveLength(1)
    expect(body.agents).toHaveLength(1)
  })

  it('POST apply rejects non-admin users', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice', 'USER'))

    const { status, body } = await callApply('alice', {
      companyName: 'Acme',
      companyDescription: 'Desc',
      templateId: 'blank',
      agents: [{ id: 'assistant' }],
    })

    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('POST apply returns 403 when CSRF validation fails', async () => {
    mockValidateSameOrigin.mockReturnValue({ ok: false })

    const { status, body } = await callApply('alice', {})
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('POST apply maps conflict errors to HTTP 409', async () => {
    mockApplyKickstart.mockResolvedValue({ ok: false, error: 'conflict' })

    const { status, body } = await callApply('alice', {
      companyName: 'Acme',
      companyDescription: 'Desc',
      templateId: 'blank',
      agents: [{ id: 'assistant' }],
    })

    expect(status).toBe(409)
    expect(body.error).toBe('conflict')
  })

  it.each([
    ['invalid_payload', 400],
    ['kb_unavailable', 503],
    ['already_configured', 409],
    ['something_else', 500],
  ])('toStatusCode maps %s to %s', async (error, expectedStatus) => {
    const { toStatusCode } = await import('@/app/api/u/[slug]/kickstart/apply/route')
    expect(toStatusCode(error)).toBe(expectedStatus)
  })

  it('POST apply returns 400 for malformed JSON payload', async () => {
    const { status, body } = await callApplyRaw('alice', '{"companyName":')
    expect(status).toBe(400)
    expect(body.error).toBe('invalid_payload')
  })

  it('POST apply delegates to applyKickstart with actor id', async () => {
    await callApply('alice', {
      companyName: 'Acme',
      companyDescription: 'Desc',
      templateId: 'blank',
      agents: [{ id: 'assistant' }],
    })

    expect(mockApplyKickstart).toHaveBeenCalledWith(
      {
        companyName: 'Acme',
        companyDescription: 'Desc',
        templateId: 'blank',
        agents: [{ id: 'assistant' }],
      },
      'user-1'
    )
  })
})
