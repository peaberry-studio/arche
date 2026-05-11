export type SlackApiObject = Record<string, unknown>

type SlackApiBodyValue = boolean | number | string | undefined

type SlackApiCallOptions = {
  body?: Record<string, SlackApiBodyValue>
  contentType?: 'form' | 'json'
}

function stripUndefined(body: Record<string, SlackApiBodyValue>): Record<string, boolean | number | string> {
  return Object.fromEntries(
    Object.entries(body).filter((entry): entry is [string, boolean | number | string] => entry[1] !== undefined),
  )
}

function serializeSlackBody(options: SlackApiCallOptions): string {
  const body = options.body ? stripUndefined(options.body) : {}
  if (options.contentType === 'json') {
    return JSON.stringify(body)
  }

  return new URLSearchParams(
    Object.entries(body).map(([key, value]) => [key, String(value)]),
  ).toString()
}

export async function callSlackApi<T extends SlackApiObject>(
  method: string,
  token: string,
  options: SlackApiCallOptions = {},
): Promise<T> {
  const contentType = options.contentType ?? 'form'
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType === 'json'
        ? 'application/json; charset=utf-8'
        : 'application/x-www-form-urlencoded',
    },
    body: serializeSlackBody({ ...options, contentType }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })

  const data = await response.json().catch(() => null) as (T & { ok?: boolean; error?: string }) | null
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `slack_${method.replace(/\./g, '_')}_failed`)
  }

  return data
}
