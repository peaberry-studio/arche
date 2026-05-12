import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'

type CreateOpencodeClientArgs = {
  authHeader: string
  baseUrl: string
}

function importRuntimeModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<T>
  }

  // Keep this hidden from tsx/esbuild so import() is not rewritten to require().
  // The SDK subpath must be resolved through ESM package exports at runtime.
  return Function('runtimeSpecifier', 'return import(runtimeSpecifier)')(specifier) as Promise<T>
}

export async function createConfiguredOpencodeClient(
  { baseUrl, authHeader }: CreateOpencodeClientArgs,
): Promise<OpencodeClient> {
  const { createOpencodeClient } = await importRuntimeModule<typeof import('@opencode-ai/sdk/v2/client')>(
    '@opencode-ai/sdk/v2/client',
  )

  return createOpencodeClient({
    baseUrl,
    fetch: async (input, init) => {
      // The SDK may pass a fully-formed Request object as `input` with
      // method, headers and body already set (and `init` undefined).
      // We must preserve all of those while injecting the auth header.
      const isRequest = input instanceof Request
      const method = init?.method ?? (isRequest ? input.method : 'GET')
      const mergedHeaders = new Headers(isRequest ? input.headers : undefined)
      if (init?.headers) {
        const extra = new Headers(init.headers)
        extra.forEach((value, key) => mergedHeaders.set(key, value))
      }
      mergedHeaders.set('Authorization', authHeader)
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()

      try {
        return await fetch(url, {
          ...init,
          method,
          headers: mergedHeaders,
          body: init?.body ?? (isRequest ? input.body : undefined),
          // @ts-expect-error -- Node/undici duplex hint for streaming bodies
          duplex: (init?.body ?? (isRequest ? input.body : undefined)) ? 'half' : undefined,
        })
      } catch (err) {
        console.error(`[opencode/client] Fetch error:`, err)
        throw err
      }
    },
  })
}

export type { CreateOpencodeClientArgs }
