import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function runGit(args, options = {}) {
  await execFileAsync('git', args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      ...options.env,
    },
  })
}

export async function ensureBareRepo(repoPath) {
  await mkdir(repoPath, { recursive: true })

  try {
    await runGit(['--git-dir', repoPath, 'rev-parse', '--git-dir'])
    return
  } catch {
    await runGit(['init', '--bare', '--initial-branch=main', repoPath])
  }

  const cloneRoot = await mkdtemp(path.join(tmpdir(), 'arche-e2e-bare-'))
  const checkoutPath = path.join(cloneRoot, 'checkout')

  try {
    await runGit(['clone', repoPath, checkoutPath])
    await runGit(['commit', '--allow-empty', '-m', 'Initialize bare repository'], {
      cwd: checkoutPath,
      env: {
        GIT_AUTHOR_NAME: 'Arche E2E',
        GIT_AUTHOR_EMAIL: 'e2e@arche.local',
        GIT_COMMITTER_NAME: 'Arche E2E',
        GIT_COMMITTER_EMAIL: 'e2e@arche.local',
      },
    })
    await runGit(['push', 'origin', 'HEAD:refs/heads/main'], { cwd: checkoutPath })
  } finally {
    await rm(cloneRoot, { recursive: true, force: true })
  }
}

export async function writeBareRepoFiles(repoPath, files, commitMessage) {
  await ensureBareRepo(repoPath)

  const cloneRoot = await mkdtemp(path.join(tmpdir(), 'arche-e2e-clone-'))
  const checkoutPath = path.join(cloneRoot, 'checkout')
  const gitEnv = {
    GIT_AUTHOR_NAME: 'Arche E2E',
    GIT_AUTHOR_EMAIL: 'e2e@arche.local',
    GIT_COMMITTER_NAME: 'Arche E2E',
    GIT_COMMITTER_EMAIL: 'e2e@arche.local',
  }

  try {
    await runGit(['clone', repoPath, checkoutPath])

    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(checkoutPath, relativePath)
      await mkdir(path.dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, content)
    }

    await runGit(['add', '.'], { cwd: checkoutPath })

    try {
      await runGit(['commit', '-m', commitMessage], { cwd: checkoutPath, env: gitEnv })
    } catch {
      return
    }

    await runGit(['push', 'origin', 'HEAD:refs/heads/main'], { cwd: checkoutPath })
  } finally {
    await rm(cloneRoot, { recursive: true, force: true })
  }
}
