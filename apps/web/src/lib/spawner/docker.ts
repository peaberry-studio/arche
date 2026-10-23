import { getConnectorGatewayBaseUrl } from '@/lib/connectors/gateway-config'
import type { SkillBundle } from '@/lib/skills/types'
import {
  getContainerProxyUrl,
  getContainerSocketPath,
  getKbContentHostPath,
  getOpencodeImage,
  getOpencodeNetwork,
  getOpencodeV1Image,
  getScratchSizeMb,
  getWorkspaceAgentPort,
} from '@/lib/spawner/config';
import {
  getDefaultWebRuntimeConfigContent,
  parseRuntimeConfigContent,
  serializeRuntimeConfig,
  WEB_SCRATCH,
} from '@/lib/spawner/runtime-config';
import { prepareWorkspaceVolumes } from '@/lib/spawner/volume-init'
import { ensureUserDirectory, getUserDataHostPath } from '@/lib/user-data';

type DockerConstructor = typeof import("dockerode");
type DockerClient = InstanceType<DockerConstructor>;

function importRuntimeModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<T>;
  }

  // SECURITY NOTE: Function() is used intentionally as a bundler bypass.
  // Next.js/webpack statically analyzes import() calls and may fail to resolve
  // dynamic specifiers at build time. The Function() constructor creates a scope
  // where import() is opaque to the bundler, ensuring the module is loaded at
  // runtime from node_modules. The specifier is NOT user-controlled — it is
  // always a hardcoded package name passed by callers within this module.
  return Function("runtimeSpecifier", "return import(runtimeSpecifier)")(specifier) as Promise<T>;
}

async function getDockerConstructor(): Promise<DockerConstructor> {
  const dockerModule = await importRuntimeModule<typeof import("dockerode")>("dockerode");
  const defaultExport = (dockerModule as { default?: DockerConstructor }).default;
  return defaultExport ?? dockerModule;
}

async function getContainerClient(): Promise<DockerClient> {
  const Docker = await getDockerConstructor();
  const socketPath = getContainerSocketPath();
  if (socketPath) {
    return new Docker({ socketPath });
  }
  const url = new URL(getContainerProxyUrl());
  return new Docker({
    host: url.hostname,
    port: parseInt(url.port),
  });
}

function getDockerErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') {
    return error;
  }

  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const record = error as { json?: { message?: unknown }; message?: unknown; reason?: unknown };
  if (typeof record.json?.message === 'string') {
    return record.json.message;
  }

  if (typeof record.message === 'string') {
    return record.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return typeof record.reason === 'string' ? record.reason : undefined;
}

function isContainerNameConflict(error: unknown): boolean {
  const message = getDockerErrorMessage(error)?.toLowerCase() ?? '';
  return (
    message.includes('name is already in use') ||
    (message.includes('container name') && message.includes('already in use'))
  );
}

function isNotFound(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404
}

function databaseScope(connectionString: string): string {
  const connection = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new Error('runtime_upgrade_database_unavailable')
  return JSON.stringify([
    connection.hostname.toLowerCase().replace(/\.$/, ''),
    connection.port || '5432',
    decodeURIComponent(connection.pathname),
    connection.searchParams.get('schema') ?? 'public',
  ])
}

export async function hasLegacyBackendWriters(): Promise<boolean> {
  if (!process.env.DATABASE_URL) throw new Error('runtime_upgrade_database_unavailable')
  const currentDatabase = databaseScope(process.env.DATABASE_URL)
  const docker = await getContainerClient()
  const containers = await docker.listContainers()
  for (const container of containers) {
    const labels = container.Labels
    const service = labels['com.docker.compose.service']
    if (labels['arche.role'] !== 'web' && !['web', 'flows', 'reaper'].includes(service)) continue
    if (labels['arche.runtime.contract'] === 'opencode-v2') continue
    if (!container.NetworkSettings.Networks[getOpencodeNetwork()]) continue
    let info
    try {
      info = await docker.getContainer(container.Id).inspect()
    } catch (error) {
      if (isNotFound(error)) continue
      throw error
    }
    if (!info.State.Running) continue
    const databaseUrl = info.Config.Env?.find((value) => value.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length)
    if (databaseUrl && databaseScope(databaseUrl) === currentDatabase) {
      console.warn('[spawner] Backend without the opencode-v2 runtime contract still shares the database', {
        container: container.Names?.[0] ?? container.Id,
      })
      return true
    }
    if (!databaseUrl && labels['arche.role'] === 'web') throw new Error('runtime_upgrade_database_unavailable')
  }
  return false
}

async function removeManagedContainerForSlugWithClient(docker: DockerClient, slug: string): Promise<boolean> {
  const container = docker.getContainer(`opencode-${slug}`);

  try {
    const info = await container.inspect();
    const labels = info.Config?.Labels ?? {};

    if (labels["arche.managed"] !== "true" || labels["arche.user.slug"] !== slug) {
      console.warn('[docker] Refusing to remove unmanaged container name conflict:', { slug });
      return false;
    }

    await container.remove({ force: true });
    return true;
  } catch {
    return false;
  }
}

// Resolves the boot model catalog for a workspace, falling back to the one its
// previous start wrote when upstream is unavailable. Callers resolve it before
// tearing anything down, so an outage leaves the old container in place.
export async function prepareModelsCatalog(slug: string): Promise<{ ok: true; data: string } | { ok: false; error: 'catalog_unavailable' }> {
  const { getRuntimeInternalApiRoot } = await import('@/lib/runtime/internal-api')
  const { getGatewayModelsCatalog } = await import('@/lib/providers/zen-catalog')
  const { readFile } = await importRuntimeModule<typeof import("fs/promises")>("fs/promises");
  const { join } = await importRuntimeModule<typeof import("path")>("path");
  const lastRendered = await readFile(join(getUserDataHostPath(slug), 'models-catalog.json'), 'utf-8').catch(() => null)
  return getGatewayModelsCatalog(`${getRuntimeInternalApiRoot()}/providers`, lastRendered)
}

export async function createContainer(
  slug: string,
  password: string,
  opencodeConfigContent?: string,
  agentsMd?: string,
  skills?: SkillBundle[],
  gitAuthor?: { name: string; email?: string },
  modelsCatalog?: string,
) {
  const docker = await getContainerClient();
  const { getRuntimeModelsCatalogUrl } = await import('@/lib/runtime/internal-api')
  const catalog = modelsCatalog === undefined ? await prepareModelsCatalog(slug) : { ok: true as const, data: modelsCatalog }
  if (!catalog.ok) throw new Error(catalog.error)
  const containerName = `opencode-${slug}`;
  const volumeName = `arche-workspace-${slug}`;
  // OpenCode 2 state lives apart from the OpenCode 1 volumes (`arche-opencode-*`),
  // which only the legacy archive helper still mounts.
  const opencodeShareVolumeName = `arche-opencode2-share-${slug}`;
  const opencodeStateVolumeName = `arche-opencode2-state-${slug}`;

  const runtimeConfigContent = (() => {
    if (!opencodeConfigContent) {
      return getDefaultWebRuntimeConfigContent();
    }

    return serializeRuntimeConfig(parseRuntimeConfigContent(opencodeConfigContent));
  })();

  // Ensure volumes exist for persistent workspace and OpenCode state
  for (const name of [
    volumeName,
    opencodeShareVolumeName,
    opencodeStateVolumeName,
  ]) {
    await docker.createVolume({ Name: name });
  }

  // Build binds array: always mount workspace and OpenCode runtime state,
  // optionally mount KB and user data.
  const binds = [
    `${volumeName}:/workspace`,
    `${opencodeShareVolumeName}:/home/workspace/.local/share/opencode`,
    `${opencodeStateVolumeName}:/home/workspace/.local/state/opencode`,
  ];
  const kbContentHostPath = getKbContentHostPath();
  binds.push(`${kbContentHostPath}:/kb-content:ro`);

  // Persist runtime files in host user-data directory.
  // We mount files individually into /tmp inside the container so the workspace
  // can remain empty during init-workspace git bootstrap.
  const { chmod, mkdir, rm, writeFile } = await importRuntimeModule<typeof import("fs/promises")>("fs/promises");
  const { join } = await importRuntimeModule<typeof import("path")>("path");
  const userDataPath = getUserDataHostPath(slug);
  await ensureUserDirectory(slug);

  const modelsCatalogPath = join(userDataPath, 'models-catalog.json')
  await writeFile(modelsCatalogPath, catalog.data, 'utf-8')
  await chmod(modelsCatalogPath, 0o644)

  // Write OpenCode config as a file instead of env var to avoid
  // Docker API URI length limits with large agent prompts.
  const opencodeConfigPath = join(userDataPath, "opencode-config.json");
  await writeFile(
    opencodeConfigPath,
    runtimeConfigContent,
    "utf-8"
  );
  await chmod(opencodeConfigPath, 0o644);

  const agentsPath = join(userDataPath, 'AGENTS.md')
  if (agentsMd) {
    await writeFile(agentsPath, agentsMd, "utf-8");
    await chmod(agentsPath, 0o644);
  } else {
    await rm(agentsPath, { force: true }).catch(() => {})
  }

  const skillsDir = join(userDataPath, 'skills')
  await rm(skillsDir, { recursive: true, force: true }).catch(() => {})
  for (const skill of skills ?? []) {
    const skillDir = join(skillsDir, skill.skill.frontmatter.name)
    await mkdir(skillDir, { recursive: true })
    for (const file of skill.files) {
      const filePath = join(skillDir, file.path)
      await mkdir(join(skillDir, file.path.split('/').slice(0, -1).join('/')), { recursive: true })
      await writeFile(filePath, Buffer.from(file.content))
    }
  }

  binds.push(`${modelsCatalogPath}:/tmp/arche-user-data/models-catalog.json:ro`);
  binds.push(`${opencodeConfigPath}:/tmp/arche-user-data/opencode-config.json:ro`);
  if (agentsMd) binds.push(`${agentsPath}:/tmp/arche-user-data/AGENTS.md:ro`);
  if (skills?.length) binds.push(`${skillsDir}:/tmp/arche-user-data/skills:ro`);

  const env = [
    `OPENCODE_SERVER_PASSWORD=${password}`,
    `OPENCODE_SERVER_USERNAME=opencode`,
    `ARCHE_WORKSPACE_SLUG=${slug}`,
    `ARCHE_CONNECTOR_GATEWAY_BASE_URL=${getConnectorGatewayBaseUrl()}`,
    `ARCHE_KB_PUSH_URL=${process.env.ARCHE_INTERNAL_API_BASE_URL ?? 'http://web:3000'}/api/internal/kb/${slug}`,
    `ARCHE_INTERNAL_API_BASE_URL=${process.env.ARCHE_INTERNAL_API_BASE_URL ?? 'http://web:3000'}`,
    `HOME=/home/workspace`,
    `XDG_DATA_HOME=/home/workspace/.local/share`,
    `XDG_CONFIG_HOME=/home/workspace/.config`,
    `XDG_STATE_HOME=/home/workspace/.local/state`,
    `WORKSPACE_AGENT_PORT=${getWorkspaceAgentPort()}`,
    `WORKSPACE_GIT_AUTHOR_NAME=${gitAuthor?.name ?? slug}`,
    `WORKSPACE_GIT_AUTHOR_EMAIL=${gitAuthor?.email ?? `${slug}@arche.local`}`,
    `OPENCODE_MODELS_URL=${getRuntimeModelsCatalogUrl()}`,
    'OPENCODE_MODELS_PATH=/tmp/arche-user-data/models-catalog.json',
    `ARCHE_SCRATCH_DIR=${WEB_SCRATCH.root}`,
  ];

  const options = {
    Image: getOpencodeImage(),
    User: '1000:1000',
    name: containerName,
    WorkingDir: "/workspace",
    // arche-workspace image has an entrypoint wrapper that initializes the workspace
    Cmd: ["serve", "--hostname", "0.0.0.0", "--port", "4096"],
    Env: env,
    HostConfig: {
      NetworkMode: getOpencodeNetwork(),
      CapDrop: ["ALL"],
      ReadonlyRootfs: true,
      SecurityOpt: ["no-new-privileges"],
      PidsLimit: 512,
      Memory: 2 * 1024 * 1024 * 1024,
      MemorySwap: 2 * 1024 * 1024 * 1024,
      NanoCpus: 2_000_000_000,
      RestartPolicy: { Name: "on-failure", MaximumRetryCount: 5 },
      Binds: binds,
      Tmpfs: {
        '/tmp': 'rw,nosuid,nodev,size=512m,mode=1777',
        '/home/workspace': 'rw,nosuid,nodev,size=256m,mode=1777',
        [WEB_SCRATCH.root]: `rw,nosuid,nodev,size=${getScratchSizeMb()}m,mode=1777`,
      },
    },
    Labels: {
      "arche.managed": "true",
      "arche.user.slug": slug,
      "arche.runtime.kind": "opencode-v2",
    },
  };

  await prepareWorkspaceVolumes(docker, slug, getOpencodeImage(), [volumeName, opencodeShareVolumeName, opencodeStateVolumeName])

  try {
    return await docker.createContainer(options);
  } catch (error) {
    if (!isContainerNameConflict(error)) {
      throw error;
    }

    const removed = await removeManagedContainerForSlugWithClient(docker, slug);
    if (!removed) {
      throw error;
    }

    console.warn('[docker] Removed managed container after name conflict, retrying create:', { slug });
    return docker.createContainer(options);
  }
}

export async function startContainer(containerId: string): Promise<void> {
  const docker = await getContainerClient();
  const container = docker.getContainer(containerId);
  await container.start();
}

export async function createArchiveContainer(slug: string, password: string): Promise<{ id: string; name: string }> {
  const docker = await getContainerClient()
  if (await findLegacyArchiveSource(slug, null)) throw new Error('legacy_archive_source_not_removed')
  const image = getOpencodeV1Image()
  try {
    await docker.getImage(image).inspect()
  } catch (error) {
    if (!isNotFound(error)) throw error
    const stream = await docker.pull(image)
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (pullError: Error | null) => pullError ? reject(pullError) : resolve())
    })
  }
  const name = `opencode-archive-${slug}`
  const options = {
    Image: image,
    User: '0:0',
    name,
    WorkingDir: '/workspace',
    Entrypoint: ['sh', '-c',
      'mkdir -p /home/workspace/.local/share/opencode /home/workspace/.local/state/opencode && ' +
      'cp -R /tmp/arche-archive-source/share/. /home/workspace/.local/share/opencode/ && ' +
      'cp -R /tmp/arche-archive-source/state/. /home/workspace/.local/state/opencode/ && ' +
      'exec opencode "$@"', 'arche-archive'],
    Cmd: ['serve', '--hostname', '0.0.0.0', '--port', '4096'],
    Env: [
      `OPENCODE_SERVER_PASSWORD=${password}`,
      'OPENCODE_SERVER_USERNAME=opencode',
      'HOME=/home/workspace',
      'XDG_DATA_HOME=/home/workspace/.local/share',
      'XDG_STATE_HOME=/home/workspace/.local/state',
      'XDG_CONFIG_HOME=/tmp/arche-archive-config',
      'GIT_CONFIG_COUNT=1',
      'GIT_CONFIG_KEY_0=safe.directory',
      'GIT_CONFIG_VALUE_0=/workspace',
      'OPENCODE_DISABLE_PROJECT_CONFIG=true',
      'OPENCODE_DISABLE_MODELS_FETCH=true',
      'OPENCODE_CONFIG_CONTENT={"mcp":{},"plugin":[],"enabled_providers":[]}',
    ],
    HostConfig: {
      NetworkMode: getOpencodeNetwork(),
      RestartPolicy: { Name: 'no' },
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      CapAdd: ['DAC_OVERRIDE'],
      SecurityOpt: ['no-new-privileges'],
      PidsLimit: 128,
      Memory: 2 * 1024 * 1024 * 1024,
      MemorySwap: 2 * 1024 * 1024 * 1024,
      NanoCpus: 2_000_000_000,
      Tmpfs: {
        '/tmp': 'rw,nosuid,nodev,size=256m,mode=1777',
        '/home/workspace': 'rw,nosuid,nodev,size=2048m,mode=0700',
      },
      Binds: [
        `arche-workspace-${slug}:/workspace:ro`,
        `arche-opencode-share-${slug}:/tmp/arche-archive-source/share:ro`,
        `arche-opencode-state-${slug}:/tmp/arche-archive-source/state:ro`,
      ],
    },
    Labels: { 'arche.managed': 'true', 'arche.user.slug': slug, 'arche.runtime.kind': 'opencode-v1', 'arche.archive': 'true' },
  }
  const container = await docker.createContainer(options).catch(async (error: unknown) => {
    if (!isContainerNameConflict(error)) throw error
    await removeManagedArchiveContainerWithClient(docker, slug)
    return docker.createContainer(options)
  })
  return { id: container.id, name }
}

export async function removeOrphanedV2ContainerForSlug(slug: string): Promise<void> {
  const docker = await getContainerClient()
  let info
  try {
    info = await docker.getContainer(`opencode-${slug}`).inspect()
  } catch (error) {
    if (isNotFound(error)) return
    throw error
  }
  const labels = info.Config.Labels
  if (labels['arche.managed'] !== 'true' || labels['arche.user.slug'] !== slug ||
    labels['arche.runtime.kind'] !== 'opencode-v2' || labels['arche.archive'] === 'true') return
  await removeContainer(info.Id)
}

export async function findLegacyArchiveSource(slug: string, containerId: string | null): Promise<{ id: string; name: string; running: boolean } | null> {
  const docker = await getContainerClient()
  const containers = await docker.listContainers({ all: true, filters: { label: ['arche.managed=true', `arche.user.slug=${slug}`] } })
  const candidates = new Set([`opencode-${slug}`, ...containers.filter((container) => container.Labels['arche.archive'] !== 'true').map((container) => container.Id)])
  if (containerId) candidates.add(containerId)
  const sources = new Map<string, { id: string; name: string; running: boolean }>()
  for (const candidate of candidates) {
    let info
    try {
      info = await docker.getContainer(candidate).inspect()
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404) continue
      throw error
    }
    const labels = info.Config?.Labels ?? {}
    if (labels['arche.managed'] !== 'true' || labels['arche.user.slug'] !== slug || labels['arche.archive'] === 'true' ||
      (labels['arche.runtime.kind'] && labels['arche.runtime.kind'] !== 'opencode-v1')) {
      throw new Error('legacy_archive_source_not_owned_v1')
    }
    if (!info.Id || !info.Name || typeof info.State?.Running !== 'boolean') throw new Error('legacy_archive_source_inspection_incomplete')
    sources.set(info.Id, { id: info.Id, name: info.Name.replace(/^\//, ''), running: info.State.Running })
  }
  if (sources.size > 1) throw new Error('legacy_archive_multiple_sources')
  return sources.values().next().value ?? null
}

async function removeManagedArchiveContainerWithClient(docker: DockerClient, slug: string): Promise<void> {
  const container = docker.getContainer(`opencode-archive-${slug}`)
  let info
  try {
    info = await container.inspect()
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404) return
    throw error
  }
  const labels = info.Config?.Labels ?? {}
  if (labels['arche.managed'] !== 'true' || labels['arche.user.slug'] !== slug || labels['arche.archive'] !== 'true') {
    throw new Error('archive_container_not_managed')
  }
  await container.remove({ force: true })
}

export async function removeManagedArchiveContainerForSlug(slug: string): Promise<void> {
  await removeManagedArchiveContainerWithClient(await getContainerClient(), slug)
}

export async function stopContainer(containerId: string): Promise<void> {
  const docker = await getContainerClient();
  const container = docker.getContainer(containerId);
  await container.stop({ t: 10 });
}

export async function removeContainer(containerId: string): Promise<void> {
  const docker = await getContainerClient();
  const container = docker.getContainer(containerId);
  try {
    await container.remove({ force: true });
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
}

export async function removeManagedContainerForSlug(slug: string): Promise<boolean> {
  const docker = await getContainerClient();
  return removeManagedContainerForSlugWithClient(docker, slug);
}

export async function inspectContainer(containerId: string) {
  const docker = await getContainerClient();
  const container = docker.getContainer(containerId);
  return container.inspect();
}

export async function isContainerRunning(
  containerId: string
): Promise<boolean> {
  try {
    const info = await inspectContainer(containerId);
    return info.State.Running;
  } catch {
    return false;
  }
}

/**
 * Check if OpenCode inside the container is healthy and responding.
 * This verifies the actual service, not just the container state.
 */
export async function isOpencodeHealthy(containerId: string): Promise<boolean> {
  try {
    const result = await execInContainer(
      containerId,
      [
        "wget",
        "-q",
        "-O",
        "-",
        "--timeout=2",
        "http://localhost:4096/global/health",
      ],
      { timeout: 5000 }
    );

    if (result.exitCode !== 0) return false;

    // Parse the health response
    const data = JSON.parse(result.stdout);
    return data.healthy === true;
  } catch (err) {
    console.warn('[docker] Health check failed:', { containerId, error: err instanceof Error ? err.message : err });
    return false;
  }
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute a command inside a running container.
 * Returns stdout, stderr, and exit code.
 */
export async function execInContainer(
  containerId: string,
  cmd: string[],
  options: { workingDir?: string; timeout?: number } = {}
): Promise<ExecResult> {
  const docker = await getContainerClient();
  const container = docker.getContainer(containerId);

  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: options.workingDir || "/workspace",
  });

  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 30000;

    const timer = setTimeout(() => {
      reject(new Error(`Exec timed out after ${timeout}ms`));
    }, timeout);

    exec.start({ hijack: true, stdin: false }, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return reject(err);
      }

      if (!stream) {
        clearTimeout(timer);
        return reject(new Error("No stream returned from exec"));
      }

      let stdout = "";
      let stderr = "";

      // Docker multiplexes stdout/stderr in a single stream with headers.
      // Chunks may split frames, so we must buffer across 'data' events.
      // Format: [type (1 byte)][0][0][0][size (4 bytes big-endian)][payload]
      // type: 1 = stdout, 2 = stderr
      let pending: Buffer = Buffer.alloc(0);
      stream.on("data", (chunk: Buffer) => {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;

        while (pending.length >= 8) {
          const type = pending[0];
          const size = pending.readUInt32BE(4);
          const frameSize = 8 + size;

          if (pending.length < frameSize) break;

          const payload = pending.subarray(8, frameSize).toString("utf8");
          if (type === 1) stdout += payload;
          else if (type === 2) stderr += payload;

          pending = pending.subarray(frameSize);
        }
      });

      stream.on("end", async () => {
        clearTimeout(timer);
        try {
          const inspectData = await exec.inspect();
          resolve({
            exitCode: inspectData.ExitCode ?? 0,
            stdout,
            stderr,
          });
        } catch (inspectErr) {
          console.warn('[docker] exec.inspect() failed, assuming exit code 0:', inspectErr instanceof Error ? inspectErr.message : inspectErr);
          resolve({ exitCode: 0, stdout, stderr });
        }
      });

      stream.on("error", (streamErr: Error) => {
        clearTimeout(timer);
        reject(streamErr);
      });
    });
  });
}
