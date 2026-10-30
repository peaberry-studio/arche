import { lookup } from 'node:dns/promises'

import { Agent } from 'undici'

import { isE2eFakeOAuthEndpoint } from '@/lib/e2e/runtime'
import { isBlockedIpAddress, validateConnectorTestEndpoint } from '@/lib/security/ssrf'

const dispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
        if (!addresses.length || addresses.some(({ address }) => isBlockedIpAddress(address))) {
          callback(new Error('blocked_endpoint'), [], 0)
          return
        }
        if (options.all) {
          callback(null, addresses)
        } else {
          const address = addresses[0]
          callback(null, address.address, address.family)
        }
      }, (error: Error) => callback(error, [], 0))
    },
  },
})

export async function publicFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (isE2eFakeOAuthEndpoint(url)) return fetch(url, { ...init, redirect: 'error' })
  const validation = await validateConnectorTestEndpoint(url)
  if (!validation.ok) throw new Error(validation.error)
  const options: RequestInit & { dispatcher: Agent } = {
    ...init,
    dispatcher,
    redirect: 'error',
  }
  return fetch(validation.url.toString(), options)
}
