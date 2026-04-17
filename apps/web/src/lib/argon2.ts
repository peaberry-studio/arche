type Argon2Api = {
  hash(value: string): Promise<string>
  verify(hash: string, value: string): Promise<boolean>
}

let argon2Promise: Promise<Argon2Api> | null = null

async function importArgon2Module(): Promise<unknown> {
  return import('argon2')
}

function isArgon2Api(value: unknown): value is Argon2Api {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return 'hash' in value && typeof value.hash === 'function' && 'verify' in value && typeof value.verify === 'function'
}

async function getArgon2(): Promise<Argon2Api> {
  if (!argon2Promise) {
    argon2Promise = importArgon2Module()
      .then((module) => {
        if (isArgon2Api(module)) {
          return module
        }

        if (typeof module === 'object' && module !== null && 'default' in module && isArgon2Api(module.default)) {
          return module.default
        }

        throw new Error('argon2 module did not expose hash/verify functions')
      })
      .catch((error) => {
        argon2Promise = null
        throw error
      })
  }

  return argon2Promise
}

export async function hashArgon2(value: string): Promise<string> {
  const argon2 = await getArgon2()
  return argon2.hash(value)
}

export async function verifyArgon2(hash: string, value: string): Promise<boolean> {
  const argon2 = await getArgon2()
  return argon2.verify(hash, value)
}
