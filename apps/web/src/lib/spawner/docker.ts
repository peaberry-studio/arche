import { chmod, writeFile } from "fs/promises";
import { join } from "path";

import { withWorkspacePermissionGuards } from "@/lib/spawner/runtime-config-utils";
import { getUserDataHostPath, ensureUserDirectory } from "@/lib/user-data";
import {
  getContainerSocketPath,
  getContainerProxyUrl,
  getOpencodeImage,
  getOpencodeNetwork,
  getKbContentHostPath,
  getWorkspaceAgentPort,
} from "./config";

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

export async function createContainer(
  slug: string,
  password: string,
  opencodeConfigContent?: string,
  agentsMd?: string,
  gitAuthor?: { name: string; email?: string }
) {
  const docker = await getContainerClient();
  const containerName = `opencode-${slug}`;
  const volumeName = `arche-workspace-${slug}`;
  const opencodeShareVolumeName = `arche-opencode-share-${slug}`;
  const opencodeStateVolumeName = `arche-opencode-state-${slug}`;

  // Configure provider base URLs to route through Arche's internal gateway.
  // Auth is still managed at runtime via the OpenCode /auth endpoints.
  const providerGatewayConfig = {
    provider: {
      openai: {
        options: { baseURL: "http://web:3000/api/internal/providers/openai" },
      },
      anthropic: {
        options: {
          baseURL: "http://web:3000/api/internal/providers/anthropic",
        },
      },
      fireworks: {
        options: {
          baseURL: "http://web:3000/api/internal/providers/fireworks",
        },
      },
      openrouter: {
        options: {
          baseURL: "http://web:3000/api/internal/providers/openrouter",
        },
      },
      opencode: {
        options: {
          baseURL: "http://web:3000/api/internal/providers/opencode",
        },
      },
    },
  };

  // Merge passed-in config (agents, MCP connectors, etc.) with provider gateway
  const baseConfig: Record<string, unknown> = (() => {
    if (!opencodeConfigContent) return {};
    const parsed: unknown = JSON.parse(opencodeConfigContent);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid opencode config: expected a JSON object");
    }
    return parsed as Record<string, unknown>;
  })();
  const mergedConfig = withWorkspacePermissionGuards({
    ...baseConfig,
    ...providerGatewayConfig,
  });

  // Ensure volumes exist for persistent workspace and OpenCode state
  for (const name of [
    volumeName,
    opencodeShareVolumeName,
    opencodeStateVolumeName,
  ]) {
    try {
      await docker.createVolume({ Name: name });
    } catch (err) {
      console.warn('[docker] Volume creation skipped (may already exist):', { name, error: err instanceof Error ? err.message : err })
    }
  }

  // Build binds array: always mount workspace and OpenCode runtime state,
  // optionally mount KB and user data.
  const binds = [
    `${volumeName}:/workspace`,
    `${opencodeShareVolumeName}:/home/workspace/.local/share/opencode`,
    `${opencodeStateVolumeName}:/home/workspace/.local/state/opencode`,
  ];
  const kbContentHostPath = getKbContentHostPath();
  binds.push(`${kbContentHostPath}:/kb-content`);

  // Persist runtime files in host user-data directory.
  // We mount files individually into /tmp inside the container so the workspace
  // can remain empty during init-workspace git bootstrap.
  const userDataPath = getUserDataHostPath(slug);
  await ensureUserDirectory(slug);

  // Write OpenCode config as a file instead of env var to avoid
  // Docker API URI length limits with large agent prompts.
  const opencodeConfigPath = join(userDataPath, "opencode-config.json");
  await writeFile(
    opencodeConfigPath,
    JSON.stringify(mergedConfig),
    "utf-8"
  );
  await chmod(opencodeConfigPath, 0o644);
  binds.push(`${opencodeConfigPath}:/tmp/arche-user-data/opencode-config.json:ro`);

  if (agentsMd) {
    const agentsPath = join(userDataPath, "AGENTS.md");
    await writeFile(agentsPath, agentsMd, "utf-8");
    await chmod(agentsPath, 0o644);
    binds.push(`${agentsPath}:/tmp/arche-user-data/AGENTS.md:ro`);
  }

  const env = [
    `OPENCODE_SERVER_PASSWORD=${password}`,
    `OPENCODE_SERVER_USERNAME=opencode`,
    `OPENCODE_CONFIG_DIR=/opt/arche/opencode-config`,
    // The workspace image runs as root for Podman volume compatibility.
    // Force HOME/XDG to mounted /home/workspace paths so session data persists.
    `HOME=/home/workspace`,
    `XDG_DATA_HOME=/home/workspace/.local/share`,
    `XDG_STATE_HOME=/home/workspace/.local/state`,
    `WORKSPACE_AGENT_PORT=${getWorkspaceAgentPort()}`,
    `WORKSPACE_GIT_AUTHOR_NAME=${gitAuthor?.name ?? slug}`,
    `WORKSPACE_GIT_AUTHOR_EMAIL=${gitAuthor?.email ?? `${slug}@arche.local`}`,
  ];

  return docker.createContainer({
    Image: getOpencodeImage(),
    name: containerName,
    WorkingDir: "/workspace",
    // arche-workspace image has an entrypoint wrapper that initializes the workspace
    Cmd: ["serve", "--hostname", "0.0.0.0", "--port", "4096"],
    Env: env,
    HostConfig: {
      NetworkMode: getOpencodeNetwork(),
      RestartPolicy: { Name: "unless-stopped" },
      Binds: binds,
    },
    Labels: {
      "arche.managed": "true",
      "arche.user.slug": slug,
    },
  });
}

export async function startContainer(containerId: string): Promise<void> {
  const docker = await getContainerClient();
  const container = docker.getContainer(containerId);
  await container.start();
}

export async function stopContainer(containerId: string): Promise<void> {
  const docker = await getContainerClient();
  const container = docker.getContainer(containerId);
  await container.stop({ t: 10 });
}

export async function removeContainer(containerId: string): Promise<void> {
  const docker = await getContainerClient();
  const container = docker.getContainer(containerId);
  await container.remove({ force: true });
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
