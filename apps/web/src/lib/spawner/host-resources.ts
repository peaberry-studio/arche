import { readFile } from 'fs/promises'
import { freemem, totalmem } from 'os'

export type HostMemory = {
  availableBytes: number
  totalBytes: number
  source: 'meminfo' | 'os'
}

export type MemoryPressurePolicy = {
  minAvailableMb: number | null
  minAvailablePercent: number
}

const MEMINFO_PATH = '/proc/meminfo'

function readMeminfoField(content: string, field: string): number | null {
  const match = content.match(new RegExp(`^${field}:\\s+(\\d+)\\s+kB$`, 'm'))
  return match ? Number(match[1]) * 1024 : null
}

// MemAvailable (kernel's estimate of memory usable without swapping) is the
// right signal; MemFree undercounts reclaimable page cache.
export function parseMeminfo(content: string): Omit<HostMemory, 'source'> | null {
  const totalBytes = readMeminfoField(content, 'MemTotal')
  const availableBytes = readMeminfoField(content, 'MemAvailable')
  if (!totalBytes || availableBytes === null) return null
  return { availableBytes, totalBytes }
}

// The reaper runs in a container on the workspace host; /proc/meminfo there
// reports the host's memory, which every workspace container shares. Hosts
// without it (macOS development) fall back to Node's view.
export async function readHostMemory(
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<HostMemory> {
  try {
    const parsed = parseMeminfo(await read(MEMINFO_PATH))
    if (parsed) return { ...parsed, source: 'meminfo' }
  } catch {
    // Not Linux, or /proc is not mounted.
  }
  return { availableBytes: freemem(), totalBytes: totalmem(), source: 'os' }
}

export function isUnderMemoryPressure(memory: HostMemory, policy: MemoryPressurePolicy): boolean {
  const availablePercent = (memory.availableBytes / memory.totalBytes) * 100
  if (availablePercent < policy.minAvailablePercent) return true
  return policy.minAvailableMb !== null && memory.availableBytes < policy.minAvailableMb * 1024 * 1024
}
