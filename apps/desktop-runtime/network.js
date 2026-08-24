'use strict'

const net = require('net')

const LOOPBACK_HOST = '127.0.0.1'
const MAX_FALLBACK_PORT_ATTEMPTS = 10

async function findAvailablePort(preferredPort, hostOrExcludedPorts = LOOPBACK_HOST, excludedPorts = []) {
  const host = Array.isArray(hostOrExcludedPorts) ? LOOPBACK_HOST : hostOrExcludedPorts
  const resolvedExcludedPorts = Array.isArray(hostOrExcludedPorts)
    ? hostOrExcludedPorts
    : excludedPorts
  const preferredResult = await tryListen(preferredPort, host)
  if (preferredResult.ok && !resolvedExcludedPorts.includes(preferredResult.port)) {
    return preferredResult.port
  }

  if (!preferredResult.ok && preferredResult.errorCode !== 'EADDRINUSE') {
    throw preferredResult.error
  }

  const maxFallbackAttempts = Math.max(MAX_FALLBACK_PORT_ATTEMPTS, resolvedExcludedPorts.length + 1)
  for (let attempt = 0; attempt < maxFallbackAttempts; attempt++) {
    const fallbackResult = await tryListen(0, host)
    if (!fallbackResult.ok) {
      throw fallbackResult.error
    }

    if (!resolvedExcludedPorts.includes(fallbackResult.port)) {
      return fallbackResult.port
    }
  }

  throw new Error(
    `Failed to find an available port after ${String(maxFallbackAttempts)} fallback attempts.`,
  )
}

function tryListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', (error) => {
      resolve({ ok: false, error, errorCode: error.code })
    })

    server.listen(port, host, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => {
          resolve({ ok: false, error: new Error('Failed to resolve listening port') })
        })
        return
      }

      server.close(() => {
        resolve({ ok: true, port: address.port })
      })
    })
  })
}

module.exports = { findAvailablePort }
