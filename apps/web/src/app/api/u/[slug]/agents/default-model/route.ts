import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { readCommonWorkspaceConfig, writeCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import { withAuth } from '@/lib/runtime/with-auth'
import {
  createDefaultCommonWorkspaceConfig,
  getDefaultModel,
  parseCommonWorkspaceConfig,
  setDefaultModel,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'

type UpdateDefaultModelRequest = {
  defaultModel?: string | null
  expectedHash?: string
}

type DefaultModelResponse = {
  defaultModel?: string
  hash?: string
}

async function loadCommonConfig() {
  const result = await readCommonWorkspaceConfig()
  if (!result.ok) {
    return { ok: false as const, error: result.error }
  }

  const parsed = parseCommonWorkspaceConfig(result.content)
  if (!parsed.ok) {
    return { ok: false as const, error: parsed.error }
  }

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) {
    return { ok: false as const, error: validation.error ?? 'invalid_config' }
  }

  return {
    ok: true as const,
    config: parsed.config,
    hash: result.hash,
  }
}

export const PATCH = withAuth<DefaultModelResponse | { error: string }>(
  { csrf: true },
  async (request, { user, slug }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let body: UpdateDefaultModelRequest
    try {
      body = await request.json()
    } catch (err) {
      if (err instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }
      throw err
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    if (!('defaultModel' in body) || (body.defaultModel !== null && typeof body.defaultModel !== 'string')) {
      return NextResponse.json({ error: 'invalid_default_model' }, { status: 400 })
    }

    const loadedConfig = await loadCommonConfig()
    const configResult = loadedConfig.ok
      ? loadedConfig
      : loadedConfig.error === 'not_found'
        ? {
            ok: true as const,
            config: createDefaultCommonWorkspaceConfig(),
            hash: undefined,
          }
        : loadedConfig

    if (!configResult.ok) {
      const status = configResult.error === 'kb_unavailable' ? 503 : 500
      return NextResponse.json({ error: configResult.error }, { status })
    }

    if (configResult.hash && (typeof body.expectedHash !== 'string' || !body.expectedHash)) {
      return NextResponse.json({ error: 'invalid_expected_hash' }, { status: 400 })
    }

    const nextConfig = setDefaultModel(configResult.config, body.defaultModel)
    const validation = validateCommonWorkspaceConfig(nextConfig)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error ?? 'invalid_config' }, { status: 400 })
    }

    const writeResult = await writeCommonWorkspaceConfig(
      JSON.stringify(nextConfig, null, 2),
      configResult.hash ? body.expectedHash : undefined,
    )
    if (!writeResult.ok) {
      const status = writeResult.error === 'conflict' ? 409 : 500
      return NextResponse.json({ error: writeResult.error ?? 'write_failed' }, { status })
    }

    await auditEvent({
      actorUserId: user.id,
      action: 'agent.default_model.updated',
      metadata: { slug, defaultModel: getDefaultModel(nextConfig) ?? null },
    })

    return NextResponse.json({ defaultModel: getDefaultModel(nextConfig), hash: writeResult.hash })
  }
)
