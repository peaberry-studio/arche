import { constants } from 'node:fs'
import { lstat, open, readlink, realpath } from 'node:fs/promises'
import path from 'node:path'

const LAST_USED_MARKER = '.last-used'
const MARKER_REFRESH_INTERVAL_MS = 60_000

// Native reads leave no trace in the folder, so own-session access refreshes
// the retention marker that scratch_dir created. Never follows a link and never
// touches a hardlinked marker.
async function refreshMarker(dir) {
  let handle
  try {
    handle = await open(path.join(dir, LAST_USED_MARKER), constants.O_WRONLY | constants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (stat.isFile() && stat.nlink === 1) {
      const now = new Date()
      await handle.utimes(now, now)
    }
  } catch {
    // No marker yet: scratch_dir has not run for this session.
  } finally {
    await handle?.close()
  }
}

async function canonical(file) {
  try {
    return await realpath(file)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const stat = await lstat(file).catch((cause) => {
      if (cause.code !== 'ENOENT') throw cause
      return undefined
    })
    if (stat?.isSymbolicLink()) {
      return canonical(path.resolve(path.dirname(file), await readlink(file)))
    }
    const parent = path.dirname(file)
    if (parent === file) throw error
    return path.join(await canonical(parent), path.basename(file))
  }
}

function contains(parent, target) {
  const relative = path.relative(parent, target)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export const scratchIsolation = {
  id: 'arche.scratch-isolation',
  async setup(ctx) {
    const configuredRoot = path.resolve(ctx.options.root)
    const root = await canonical(configuredRoot)
    const refreshedAt = new Map()
    await ctx.permission.hook('evaluate', async (event) => {
      let targets
      if (event.action === 'external_directory') {
        targets = event.resources.map((resource) => resource.replace(/[/\\]\*$/, ''))
      } else if (event.action === 'read' || event.action === 'edit') {
        targets = event.resources
      } else if (event.action === 'glob' || event.action === 'grep') {
        targets = [event.metadata?.path ?? '.']
      } else {
        return
      }
      const own = path.join(root, event.sessionID)
      let ownOnly = true
      let touchesOwn = false
      for (const target of targets) {
        const absolute = path.resolve(ctx.location.directory, target)
        const resolved = await canonical(absolute)
        if ([configuredRoot, root].some((base) => contains(base, absolute) &&
              (!contains(path.join(base, event.sessionID), absolute) || !contains(own, resolved))) ||
            (contains(root, resolved) && !contains(own, resolved)) || contains(resolved, root)) {
          event.effect = 'deny'
          event.message = 'Scratch access is restricted to the calling session.'
          return
        }
        if (!contains(own, resolved)) ownOnly = false
        else touchesOwn = true
      }
      if (event.action === 'external_directory' && ownOnly && event.effect !== 'deny') {
        event.effect = 'allow'
      }
      if (touchesOwn && event.effect !== 'deny' && Date.now() - (refreshedAt.get(event.sessionID) ?? 0) >= MARKER_REFRESH_INTERVAL_MS) {
        refreshedAt.set(event.sessionID, Date.now())
        await refreshMarker(own)
      }
    })
  },
}

export default scratchIsolation
