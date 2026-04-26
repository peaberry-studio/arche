#!/usr/bin/env node

import {
  existsSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const standaloneDir = resolve(process.argv[2] ?? 'apps/web/.next/standalone')

const brokenLinks = []
walk(standaloneDir)

if (brokenLinks.length === 0) {
  console.log(`No broken symlinks found in ${standaloneDir}`)
  process.exit(0)
}

const repairedLinks = []
const unresolvedLinks = []

for (const linkPath of brokenLinks) {
  const repairResult = repairBrokenPnpmSymlink(linkPath)

  if (repairResult.ok) {
    repairedLinks.push(repairResult)
    continue
  }

  unresolvedLinks.push(repairResult)
}

if (repairedLinks.length > 0) {
  console.log(`Repaired ${repairedLinks.length} broken pnpm symlink(s) in ${standaloneDir}`)

  for (const repairedLink of repairedLinks) {
    console.log(`- ${relative(process.cwd(), repairedLink.linkPath)} -> ${repairedLink.relativeTarget}`)
  }
}

if (unresolvedLinks.length > 0) {
  console.error(`Unable to repair ${unresolvedLinks.length} broken symlink(s) in ${standaloneDir}`)

  for (const unresolvedLink of unresolvedLinks) {
    console.error(`- ${relative(process.cwd(), unresolvedLink.linkPath)}: ${unresolvedLink.reason}`)
  }

  process.exit(1)
}

function walk(directoryPath) {
  const directoryEntries = readdirSync(directoryPath, { withFileTypes: true })

  for (const directoryEntry of directoryEntries) {
    const entryPath = join(directoryPath, directoryEntry.name)

    if (directoryEntry.isSymbolicLink()) {
      const symlinkTarget = readlinkSync(entryPath)
      const resolvedTargetPath = resolve(dirname(entryPath), symlinkTarget)

      if (!existsSync(resolvedTargetPath)) {
        brokenLinks.push(entryPath)
      }

      continue
    }

    if (directoryEntry.isDirectory()) {
      walk(entryPath)
    }
  }
}

function repairBrokenPnpmSymlink(linkPath) {
  const virtualStoreLink = getVirtualStoreLink(linkPath)

  if (virtualStoreLink === null) {
    return {
      ok: false,
      linkPath,
      reason: 'broken symlink is outside pnpm virtual store aliases',
    }
  }

  const encodedStorePrefix = getEncodedStorePrefix(virtualStoreLink.packageSegments)
  const candidateTargets = readdirSync(virtualStoreLink.storeRoot, { withFileTypes: true })
    .filter(
      (directoryEntry) =>
        directoryEntry.isDirectory() &&
        directoryEntry.name !== 'node_modules' &&
        directoryEntry.name.startsWith(encodedStorePrefix),
    )
    .map((directoryEntry) => join(virtualStoreLink.storeRoot, directoryEntry.name, 'node_modules', ...virtualStoreLink.packageSegments))
    .filter((candidatePath) => existsSync(candidatePath))
    .sort()

  if (candidateTargets.length === 0) {
    return {
      ok: false,
      linkPath,
      reason: `no candidate package found for ${virtualStoreLink.packageSegments.join('/')}`,
    }
  }

  if (candidateTargets.length > 1) {
    return {
      ok: false,
      linkPath,
      reason: `multiple candidate packages found for ${virtualStoreLink.packageSegments.join('/')}`,
    }
  }

  const targetPath = candidateTargets[0]
  const relativeTarget = relative(dirname(linkPath), targetPath)

  unlinkSync(linkPath)
  symlinkSync(relativeTarget, linkPath)

  return {
    ok: true,
    linkPath,
    relativeTarget,
  }
}

function getEncodedStorePrefix(packageSegments) {
  if (packageSegments[0]?.startsWith('@')) {
    return `${packageSegments[0]}+${packageSegments[1]}@`
  }

  return `${packageSegments[0]}@`
}

function getVirtualStoreLink(linkPath) {
  const packageSegments = []
  let currentPath = linkPath

  while (true) {
    const parentPath = dirname(currentPath)

    if (parentPath === currentPath) {
      return null
    }

    packageSegments.unshift(currentPath.slice(parentPath.length + 1))

    const virtualStorePath = dirname(parentPath)

    if (parentPath.endsWith('/node_modules') || parentPath.endsWith('\\node_modules')) {
      if (virtualStorePath.endsWith('/.pnpm') || virtualStorePath.endsWith('\\.pnpm')) {
        return {
          storeRoot: virtualStorePath,
          packageSegments,
        }
      }
    }

    currentPath = parentPath
  }
}
