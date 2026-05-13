import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { config } from '../../config.js';
import type { NaviDatabase } from '../../db/database.js';
import type { AppsService } from '../apps/apps.service.js';
import { DeploymentsRepo } from './deployments.repo.js';

const execFileAsync = promisify(execFile);

const deployInputSchema = z.object({
  method: z.enum(['docker_run']).default('docker_run'),
  command: z.string().trim().min(1).max(8000),
  publishMode: z.enum(['reverse_proxy', 'public_domain_reverse_proxy']).default('reverse_proxy'),
  name: z.string().trim().min(1).max(80).optional(),
  publicHost: z.string().trim().min(1).max(253),
  routeMode: z.enum(['subdomain', 'subpath']).default('subdomain'),
  publicPath: z.string().trim().max(120).nullable().optional(),
  hostPort: z.number().int().min(1).max(65535).nullable().optional(),
  containerPort: z.number().int().min(1).max(65535).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  favorite: z.boolean().default(false),
  enabled: z.boolean().default(true)
});

type PublishedPort = {
  hostPort: number | null;
  containerPort: number;
  protocol: string;
};

type DockerRunPlan = {
  containerName: string;
  image: string;
  publishMode: 'reverse_proxy' | 'public_domain_reverse_proxy';
  hostPort: number | null;
  containerPort: number;
  protocol: string;
  targetUrl: string;
  hostMounts: HostMount[];
  appPayload: {
    name: string;
    iconType: 'builtin';
    iconValue: string | null;
    targetUrl: string;
    routeMode: 'subdomain' | 'subpath';
    publicHost: string;
    publicPath: string | null;
    enabled: boolean;
    sortOrder: number;
    category: string | null;
    tags: string[];
    favorite: boolean;
  };
  dockerArgs: string[];
  warnings: string[];
};

type DockerInspectPort = Array<{
  HostIp: string;
  HostPort: string;
}> | null;

type DockerInspectContainer = {
  Id: string;
  Name: string;
  State?: {
    Running?: boolean;
  };
  NetworkSettings?: {
    Ports?: Record<string, DockerInspectPort>;
  };
};

type HostMount = {
  source: string;
  target: string | null;
};

type DeployDoctorCheck = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
};

type DeployPermissionRequirement = {
  id: string;
  label: string;
  status: 'ready' | 'auto' | 'needs_user' | 'blocked';
  userHelpRequired: boolean;
  detail: string;
  commands: string[];
};

type DeployDoctorGrantStep = {
  title: string;
  description: string;
  commands: string[];
};

const deployDoctorInputSchema = z.object({
  command: z.string().trim().max(8000).optional(),
  publishMode: z.enum(['reverse_proxy', 'public_domain_reverse_proxy']).default('reverse_proxy'),
  publicHost: z.string().trim().max(253).optional(),
  hostPort: z.number().int().min(1).max(65535).nullable().optional(),
  containerPort: z.number().int().min(1).max(65535).nullable().optional()
}).passthrough();

const optionValueNames = new Set([
  '--add-host',
  '--attach',
  '--blkio-weight',
  '--cap-add',
  '--cap-drop',
  '--cgroup-parent',
  '--cidfile',
  '--cpuset-cpus',
  '--cpuset-mems',
  '--cpu-period',
  '--cpu-quota',
  '--cpu-rt-period',
  '--cpu-rt-runtime',
  '--cpu-shares',
  '--dns',
  '--dns-option',
  '--dns-search',
  '--entrypoint',
  '--env',
  '--env-file',
  '--expose',
  '--group-add',
  '--health-cmd',
  '--health-interval',
  '--health-retries',
  '--health-start-period',
  '--health-timeout',
  '--hostname',
  '--ip',
  '--ip6',
  '--label',
  '--label-file',
  '--log-driver',
  '--log-opt',
  '--memory',
  '--memory-reservation',
  '--memory-swap',
  '--mount',
  '--name',
  '--network',
  '--network-alias',
  '--platform',
  '--publish',
  '--restart',
  '--shm-size',
  '--stop-signal',
  '--stop-timeout',
  '--tmpfs',
  '--ulimit',
  '--user',
  '--volume',
  '--volumes-from',
  '--workdir'
]);

const shortOptionsWithValues = new Set([
  'a',
  'c',
  'e',
  'h',
  'l',
  'm',
  'p',
  'u',
  'v',
  'w'
]);

export class DeployInputError extends Error {}
export class DeployExecutionError extends Error {}
export class DeployRuntimeUnavailableError extends Error {}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function commandDetail(error: unknown) {
  return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
    ? error.stderr.trim()
    : error instanceof Error
      ? error.message
      : String(error);
}

function isDockerDaemonUnavailable(message: string) {
  return /Cannot connect to the Docker daemon/i.test(message);
}

function isDockerPermissionDenied(message: string) {
  return /permission denied/i.test(message) && /(docker\.sock|Docker daemon|unix:\/\/|connect)/i.test(message);
}

function isCredentialHelperUnavailable(message: string) {
  return /error getting credentials/i.test(message) && /docker-credential-.+?(not found|executable file not found)/i.test(message);
}

function pointsToColima(message: string) {
  return /\.colima|context:\s+colima|colima/i.test(message);
}

function isContainerNameConflict(message: string) {
  return /container name ".+?" is already in use/i.test(message);
}

async function commandExists(command: string) {
  try {
    await execFileAsync(command, ['--version'], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function commandOutput(command: string, args: string[], timeout = 10_000) {
  const { stdout } = await execFileAsync(command, args, {
    timeout,
    maxBuffer: 1024 * 1024
  });

  return stdout.trim();
}

async function currentGroupNames() {
  if (process.platform === 'win32') {
    return [];
  }

  try {
    return (await commandOutput('id', ['-Gn'])).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

function dockerPermissionGrantSteps(message: string): DeployDoctorGrantStep[] {
  const username = os.userInfo().username || '$USER';
  const steps: DeployDoctorGrantStep[] = [];

  if (process.platform === 'linux') {
    steps.push({
      title: 'Allow this user to use Docker',
      description: 'Add the user that runs NaviProxy to the docker group, then restart the shell or service.',
      commands: [
        `sudo usermod -aG docker ${username}`,
        'newgrp docker',
        'sudo systemctl enable --now docker'
      ]
    });
    steps.push({
      title: 'If NaviProxy runs as a systemd service',
      description: 'Make sure the service process also joins the docker group, then restart the service.',
      commands: [
        'sudo systemctl edit naviproxy',
        '[Service]',
        'SupplementaryGroups=docker',
        'sudo systemctl daemon-reload',
        'sudo systemctl restart naviproxy'
      ]
    });
    return steps;
  }

  if (process.platform === 'darwin') {
    steps.push({
      title: 'Use Colima with the same user as NaviProxy',
      description: 'Start Colima and launch NaviProxy from a shell that points Docker at the Colima socket.',
      commands: [
        'colima start',
        'export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock',
        'export DOCKER_BIN=$(command -v docker)',
        'npm run dev'
      ]
    });
    steps.push({
      title: 'Use Docker Desktop',
      description: 'Open Docker Desktop once and allow its privileged helper, then restart NaviProxy.',
      commands: [
        'open -a Docker',
        'docker info',
        'npm run dev'
      ]
    });
    return steps;
  }

  if (process.platform === 'win32') {
    steps.push({
      title: 'Start Docker Desktop for Windows',
      description: 'NaviProxy needs Docker Desktop or another Docker daemon reachable from this Windows user.',
      commands: [
        'Start-Process "Docker Desktop"',
        'docker info'
      ]
    });
    steps.push({
      title: 'Point NaviProxy at Docker on Windows',
      description: 'If Docker is installed in a custom location, start NaviProxy with the full docker.exe path.',
      commands: [
        'where docker',
        '$env:DOCKER_BIN="C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"',
        'npm run dev'
      ]
    });
    return steps;
  }

  steps.push({
    title: 'Grant Docker access to the NaviProxy process',
    description: 'Run NaviProxy as a user that can execute Docker and access the Docker daemon socket.',
    commands: [
      'docker info',
      'DOCKER_BIN=/full/path/to/docker npm run dev'
    ]
  });

  if (message) {
    steps.push({
      title: 'Current Docker error',
      description: message,
      commands: []
    });
  }

  return steps;
}

async function recoverColimaRuntime() {
  if (!(await commandExists('colima'))) {
    return false;
  }

  await execFileAsync('colima', ['start'], {
    timeout: 180_000,
    maxBuffer: 1024 * 1024
  }).catch(() => undefined);

  try {
    await execFileAsync(config.dockerBin, ['info'], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch {
    await execFileAsync('colima', ['restart'], {
      timeout: 240_000,
      maxBuffer: 1024 * 1024
    }).catch(() => undefined);
  }

  try {
    await execFileAsync(config.dockerBin, ['info'], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function dockerConfigWithoutCredentialHelpers() {
  const sourceDir =
    process.env.DOCKER_CONFIG ??
    (process.env.HOME ? path.join(process.env.HOME, '.docker') : null);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naviproxy-docker-'));
  let dockerConfig: Record<string, unknown> = {};

  if (sourceDir) {
    try {
      dockerConfig = JSON.parse(
        await fs.readFile(path.join(sourceDir, 'config.json'), 'utf8')
      ) as Record<string, unknown>;
    } catch {
      dockerConfig = {};
    }
  }

  delete dockerConfig.credsStore;
  delete dockerConfig.credHelpers;

  await fs.writeFile(
    path.join(tempDir, 'config.json'),
    `${JSON.stringify(dockerConfig, null, 2)}\n`,
    { mode: 0o600 }
  );

  return tempDir;
}

async function execDocker(args: string[], options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}) {
  return execFileAsync(config.dockerBin, args, {
    timeout: options.timeout ?? 120_000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      ...options.env
    }
  });
}

async function runDockerCommand(args: string[], options: { timeout?: number } = {}) {
  try {
    return await execDocker(args, options);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new DeployRuntimeUnavailableError(
        `Docker CLI was not found at "${config.dockerBin}". Install Docker or set DOCKER_BIN to the full docker binary path.`
      );
    }

    if (isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM')) {
      throw new DeployRuntimeUnavailableError(
        `Docker CLI at "${config.dockerBin}" is not executable by this process. Fix the binary permissions or set DOCKER_BIN to an executable Docker binary.`
      );
    }

    const detail = commandDetail(error);

    if (isCredentialHelperUnavailable(detail)) {
      let dockerConfig: string | null = null;

      try {
        dockerConfig = await dockerConfigWithoutCredentialHelpers();
        return await execDocker(args, {
          ...options,
          env: {
            DOCKER_CONFIG: dockerConfig
          }
        });
      } catch (retryError) {
        throw new DeployExecutionError(
          `${commandDetail(retryError) || detail} NaviProxy also tried a sanitized Docker config without the missing credential helper.`
        );
      } finally {
        if (dockerConfig) {
          await fs.rm(dockerConfig, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }

    if (isDockerPermissionDenied(detail)) {
      throw new DeployRuntimeUnavailableError(
        `${detail} NaviProxy cannot change Docker socket permissions safely. Start Docker with permissions for this user, or run NaviProxy as a user that can access Docker.`
      );
    }

    if (isDockerDaemonUnavailable(detail)) {
      const recovered = pointsToColima(detail) ? await recoverColimaRuntime() : false;

      if (recovered) {
        try {
          return await execDocker(args, options);
        } catch (retryError) {
          throw new DeployExecutionError(commandDetail(retryError) || 'Docker run failed.');
        }
      }

      const recoveryNote = pointsToColima(detail)
        ? ' NaviProxy tried to start or restart Colima automatically, but Docker is still unavailable.'
        : ' Start Docker, or point DOCKER_HOST/DOCKER_BIN at a running Docker runtime.';

      throw new DeployRuntimeUnavailableError(`${detail}${recoveryNote}`);
    }

    throw new DeployExecutionError(detail || 'Docker run failed.');
  }
}

async function inspectContainer(containerName: string) {
  const { stdout } = await runDockerCommand(['inspect', containerName]);
  const parsed = JSON.parse(stdout) as DockerInspectContainer[];
  const container = parsed[0];

  if (!container) {
    throw new DeployExecutionError(`Docker container ${containerName} was not found.`);
  }

  return container;
}

function firstPublishedPort(container: DockerInspectContainer, containerPort: number) {
  const ports = container.NetworkSettings?.Ports ?? {};
  const preferred = ports[`${containerPort}/tcp`]?.[0]?.HostPort;

  if (preferred) {
    return Number(preferred);
  }

  for (const bindings of Object.values(ports)) {
    const hostPort = bindings?.[0]?.HostPort;

    if (hostPort) {
      return Number(hostPort);
    }
  }

  return null;
}

function planWithExistingContainer(
  plan: DockerRunPlan,
  container: DockerInspectContainer
): DockerRunPlan {
  const hostPort = firstPublishedPort(container, plan.containerPort);

  if (!hostPort || !Number.isInteger(hostPort)) {
    throw new DeployExecutionError(
      `Existing container ${plan.containerName} does not publish a TCP port NaviProxy can route to.`
    );
  }

  const targetUrl = `http://127.0.0.1:${hostPort}`;

  return {
    ...plan,
    hostPort,
    targetUrl,
    appPayload: {
      ...plan.appPayload,
      targetUrl
    },
    warnings: [
      ...plan.warnings,
      `Adopted existing Docker container ${plan.containerName}.`
    ]
  };
}

function tokenizeShellCommand(command: string) {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (
      char === '\\' &&
      quote !== "'" &&
      !/^[A-Za-z]:/.test(current) &&
      !/[=,][A-Za-z]:/.test(current) &&
      !current.startsWith('\\') &&
      current !== ''
    ) {
      escaped = true;
      continue;
    }

    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }

    if (quote === char) {
      quote = null;
      continue;
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaped) {
    current += '\\';
  }

  if (quote) {
    throw new DeployInputError('Command contains an unterminated quote.');
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function trimDockerPrefix(tokens: string[]) {
  const sudoIndex = tokens[0] === 'sudo' ? 1 : 0;

  if (tokens[sudoIndex] !== 'docker' || tokens[sudoIndex + 1] !== 'run') {
    throw new DeployInputError('Only docker run commands are supported in this deployer.');
  }

  return tokens.slice(sudoIndex + 2);
}

function parsePortSpec(raw: string): PublishedPort | null {
  const [withoutProtocol, protocol = 'tcp'] = raw.split('/');
  const segments = withoutProtocol.split(':');
  const containerPart = segments.at(-1);

  if (!containerPart) {
    return null;
  }

  const containerPort = Number(containerPart);

  if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
    return null;
  }

  const hostPart = segments.length >= 2 ? segments.at(-2) : null;
  const hostPort =
    hostPart && /^\d+$/.test(hostPart)
      ? Number(hostPart)
      : segments.length === 1
        ? null
        : null;

  if (hostPort !== null && (hostPort < 1 || hostPort > 65535)) {
    return null;
  }

  return {
    hostPort,
    containerPort,
    protocol
  };
}

function looksLikeHostPath(value: string) {
  return (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('~') ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

function expandHostPath(value: string) {
  const expanded = value === '~'
    ? os.homedir()
    : value.startsWith('~/')
      ? path.join(os.homedir(), value.slice(2))
      : value;

  return path.resolve(process.cwd(), expanded);
}

function splitDockerVolumeSpec(value: string) {
  const windowsDriveSource = value.match(/^([A-Za-z]:[\\/][^:]*):(.+)$/);

  if (windowsDriveSource) {
    const rest = windowsDriveSource[2];

    return {
      source: windowsDriveSource[1],
      target: rest.match(/^[A-Za-z]:[\\/]/)
        ? rest.replace(/:ro$|:rw$|:z$|:Z$/, '')
        : rest.split(':')[0] ?? null
    };
  }

  const segments = value.split(':');

  if (segments.length < 2) {
    return null;
  }

  return {
    source: segments[0],
    target: segments[1] ?? null
  };
}

function parseVolumeMount(value: string): HostMount | null {
  const parsed = splitDockerVolumeSpec(value);

  if (!parsed) {
    return null;
  }

  const { source, target } = parsed;

  if (!source || !looksLikeHostPath(source)) {
    return null;
  }

  return {
    source,
    target
  };
}

function parseMountPairs(value: string) {
  const pairs = new Map<string, string>();

  for (const segment of value.split(',')) {
    const separator = segment.indexOf('=');

    if (separator === -1) {
      continue;
    }

    pairs.set(segment.slice(0, separator), segment.slice(separator + 1));
  }

  return pairs;
}

function parseBindMount(value: string): HostMount | null {
  const pairs = parseMountPairs(value);
  const type = pairs.get('type');
  const source = pairs.get('source') ?? pairs.get('src');
  const target = pairs.get('target') ?? pairs.get('destination') ?? pairs.get('dst') ?? null;

  if (!source || (type && type !== 'bind') || !looksLikeHostPath(source)) {
    return null;
  }

  return {
    source,
    target
  };
}

function hostMountFromOption(name: string, value: string) {
  if (name === '-v' || name === '--volume') {
    return parseVolumeMount(value);
  }

  if (name === '--mount') {
    return parseBindMount(value);
  }

  return null;
}

function likelyFileMount(mount: HostMount) {
  const sourceName = path.basename(mount.source);
  const targetName = mount.target ? path.posix.basename(mount.target) : '';

  return Boolean(path.extname(sourceName) || path.extname(targetName));
}

async function ensureHostMountsWritable(mounts: HostMount[]) {
  const uniqueSources = Array.from(new Map(mounts.map((mount) => [mount.source, mount])).values());

  for (const mount of uniqueSources) {
    const source = expandHostPath(mount.source);

    try {
      await fs.access(source, fsConstants.R_OK | fsConstants.W_OK);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        if (likelyFileMount(mount)) {
          await fs.mkdir(path.dirname(source), { recursive: true });
          await fs.writeFile(source, '', { flag: 'wx', mode: 0o600 });
        } else {
          await fs.mkdir(source, { recursive: true, mode: 0o755 });
        }

        continue;
      }

      if (isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM')) {
        throw new DeployRuntimeUnavailableError(
          `Docker bind mount path "${source}" is not readable and writable by NaviProxy. Move the app data to a writable path or fix permissions before deploying.`
        );
      }

      throw error;
    }
  }
}

function shellQuote(value: string) {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isDockerSocketMount(mount: HostMount) {
  const source = expandHostPath(mount.source);

  return source === '/var/run/docker.sock' || source.endsWith('/docker.sock');
}

function isProtectedHostPath(source: string) {
  const resolved = expandHostPath(source);
  const protectedRoots = (() => {
    if (process.platform === 'win32') {
      const systemDrive = process.env.SystemDrive ?? 'C:';

      return [
        `${systemDrive}\\Windows`,
        `${systemDrive}\\Program Files`,
        `${systemDrive}\\Program Files (x86)`,
        `${systemDrive}\\ProgramData`
      ].map((root) => path.resolve(root).toLowerCase());
    }

    if (process.platform === 'darwin') {
      return ['/System', '/Library', '/private', '/usr', '/bin', '/sbin', '/etc', '/var'];
    }

    return ['/boot', '/dev', '/etc', '/proc', '/root', '/run', '/sys', '/usr', '/var'];
  })();

  if (process.platform === 'win32') {
    const normalized = resolved.toLowerCase();

    return protectedRoots.some((root) => normalized === root || normalized.startsWith(`${root}\\`));
  }

  return protectedRoots.some((root) => resolved === root || resolved.startsWith(`${root}/`));
}

function createPathCommands(source: string) {
  const quotedSource = shellQuote(source);
  const username = os.userInfo().username;

  if (process.platform === 'win32') {
    return [
      `New-Item -ItemType Directory -Force -Path ${quotedSource}`,
      `icacls ${quotedSource} /grant "$env:USERNAME:(OI)(CI)M" /T`
    ];
  }

  return [
    `sudo mkdir -p ${quotedSource}`,
    `sudo chown -R ${shellQuote(username)} ${quotedSource}`
  ];
}

function fixPathPermissionCommands(source: string) {
  const quotedSource = shellQuote(source);
  const username = os.userInfo().username;

  if (process.platform === 'win32') {
    return [
      `icacls ${quotedSource} /grant "$env:USERNAME:(OI)(CI)M" /T`
    ];
  }

  return [
    `sudo chown -R ${shellQuote(username)} ${quotedSource}`,
    `chmod u+rwX ${quotedSource}`
  ];
}

function inspectDeviceCommand(device: string) {
  const source = device.split(':')[0] ?? device;

  if (process.platform === 'win32') {
    return `Get-Item ${shellQuote(source)}`;
  }

  return `ls -l ${shellQuote(source)}`;
}

async function mountRequirement(mount: HostMount): Promise<DeployPermissionRequirement> {
  const source = expandHostPath(mount.source);

  if (isDockerSocketMount(mount)) {
    return {
      id: `mount-docker-socket-${source}`,
      label: 'Docker socket mount',
      status: 'needs_user',
      userHelpRequired: true,
      detail: `${source} gives the container control over Docker on this host. User confirmation is required.`,
      commands: []
    };
  }

  try {
    await fs.access(source, fsConstants.R_OK | fsConstants.W_OK);

    return {
      id: `mount-ready-${source}`,
      label: `Bind mount ${mount.source}`,
      status: 'ready',
      userHelpRequired: false,
      detail: `${source} is readable and writable by NaviProxy.`,
      commands: []
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      if (!isProtectedHostPath(source)) {
        return {
          id: `mount-auto-${source}`,
          label: `Bind mount ${mount.source}`,
          status: 'auto',
          userHelpRequired: false,
          detail: `${source} does not exist yet. NaviProxy will create it before Docker starts.`,
          commands: []
        };
      }

      return {
        id: `mount-create-${source}`,
        label: `Bind mount ${mount.source}`,
        status: 'blocked',
        userHelpRequired: true,
        detail: `${source} is in a protected system location. Create it and grant ownership to the NaviProxy user first.`,
        commands: createPathCommands(source)
      };
    }

    if (isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM')) {
      return {
        id: `mount-permission-${source}`,
        label: `Bind mount ${mount.source}`,
        status: 'blocked',
      userHelpRequired: true,
      detail: `${source} exists but NaviProxy cannot read and write it.`,
      commands: fixPathPermissionCommands(source)
    };
  }

    return {
      id: `mount-unknown-${source}`,
      label: `Bind mount ${mount.source}`,
      status: 'blocked',
      userHelpRequired: true,
      detail: commandDetail(error),
      commands: []
    };
  }
}

async function portRequirement(port: number | null): Promise<DeployPermissionRequirement> {
  if (!port) {
    return {
      id: 'port-auto',
      label: 'Host port',
      status: 'auto',
      userHelpRequired: false,
      detail: 'No host port was requested. NaviProxy will assign a free port automatically.',
      commands: []
    };
  }

  if (needsPrivilegedPortRemap(port)) {
    return {
      id: `port-privileged-${port}`,
      label: `Host port ${port}`,
      status: 'auto',
      userHelpRequired: false,
      detail: `Port ${port} normally needs elevated system privileges. NaviProxy will route through an automatically assigned high port instead.`,
      commands: []
    };
  }

  if (!(await checkPortAvailable(port))) {
    return {
      id: `port-used-${port}`,
      label: `Host port ${port}`,
      status: 'auto',
      userHelpRequired: false,
      detail: `Port ${port} is already in use. NaviProxy will assign another free port automatically.`,
      commands: []
    };
  }

  return {
    id: `port-ready-${port}`,
    label: `Host port ${port}`,
    status: 'ready',
    userHelpRequired: false,
    detail: `Port ${port} is available.`,
    commands: []
  };
}

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal)
    .map((entry) => entry.address);
}

function normalizeHost(value: string) {
  return value.toLowerCase().replace(/\.$/, '');
}

async function resolveHostAddresses(host: string) {
  const addresses = new Set<string>();

  await Promise.all([
    dns.resolve4(host).then((items) => items.forEach((item) => addresses.add(item))).catch(() => undefined),
    dns.resolve6(host).then((items) => items.forEach((item) => addresses.add(item))).catch(() => undefined)
  ]);

  return [...addresses];
}

async function publicDomainRequirements(
  input: z.infer<typeof deployDoctorInputSchema>
): Promise<DeployPermissionRequirement[]> {
  if (input.publishMode !== 'public_domain_reverse_proxy') {
    return [];
  }

  const host = normalizeHost(input.publicHost ?? '');

  if (!host) {
    return [
      {
        id: 'public-domain-missing',
        label: 'Public domain',
        status: 'blocked',
        userHelpRequired: true,
        detail: 'Enter a public domain before deploying with public domain binding.',
        commands: []
      }
    ];
  }

  const addresses = await resolveHostAddresses(host);
  const local = localAddresses();
  const matchesLocal = addresses.some((address) => local.includes(address));

  return [
    {
      id: 'public-domain-dns',
      label: `DNS for ${host}`,
      status: addresses.length > 0 ? (matchesLocal ? 'ready' : 'needs_user') : 'needs_user',
      userHelpRequired: addresses.length === 0 || !matchesLocal,
      detail:
        addresses.length === 0
          ? `${host} does not resolve yet. Add an A/AAAA or CNAME record that points to this host before external clients can reach it.`
          : matchesLocal
            ? `${host} resolves to this machine: ${addresses.join(', ')}.`
            : `${host} resolves to ${addresses.join(', ')}, which does not match this machine's visible local addresses (${local.join(', ') || 'none'}).`,
      commands: [
        `dig +short ${host}`,
        `nslookup ${host}`
      ]
    },
    {
      id: 'reverse-proxy-sync',
      label: 'Reverse proxy sync',
      status: config.caddySyncEnabled ? 'ready' : 'needs_user',
      userHelpRequired: !config.caddySyncEnabled,
      detail: config.caddySyncEnabled
        ? 'Caddy sync is enabled, so NaviProxy will bind this domain in the reverse proxy config.'
        : 'Caddy sync is disabled. The app will be saved, but the public domain will not be applied to Caddy automatically.',
      commands: config.caddySyncEnabled
        ? []
        : [
            'CADDY_SYNC_ENABLED=true npm run dev',
            'npm run dev'
          ]
    },
    {
      id: 'public-ports',
      label: 'Public HTTP/HTTPS ports',
      status: 'needs_user',
      userHelpRequired: true,
      detail: 'Your router/firewall must forward public traffic to Caddy on this machine. Use port 80 for HTTP and port 443 when Caddy HTTPS is enabled.',
      commands: []
    }
  ];
}

async function commandPermissionRequirements(input: unknown) {
  const parsedInput = deployDoctorInputSchema.parse(input ?? {});
  const command = parsedInput.command?.trim();
  const requirements: DeployPermissionRequirement[] = [
    ...(await publicDomainRequirements(parsedInput))
  ];

  if (!command) {
    return requirements;
  }

  try {
    const dockerRun = parseDockerRun(trimDockerPrefix(tokenizeShellCommand(command)));
    const selectedPublishedPort =
      dockerRun.ports.find((port) => port.protocol === 'tcp') ?? dockerRun.ports[0];
    const requestedHostPort = parsedInput.hostPort ?? selectedPublishedPort?.hostPort ?? null;

    requirements.push(await portRequirement(requestedHostPort));

    const uniqueMounts = Array.from(
      new Map(dockerRun.hostMounts.map((mount) => [mount.source, mount])).values()
    );
    const mountRequirements = await Promise.all(uniqueMounts.map(mountRequirement));
    requirements.push(...mountRequirements);

    if (dockerRun.privileged) {
      requirements.push({
        id: 'privileged',
        label: 'Privileged container',
        status: 'needs_user',
        userHelpRequired: true,
        detail: '--privileged gives the container broad host access. Review this image before deploying.',
        commands: []
      });
    }

    if (dockerRun.hostNetwork) {
      requirements.push({
        id: 'host-network',
        label: 'Host network',
        status: 'needs_user',
        userHelpRequired: true,
        detail: '--network host shares the host network namespace. The container can bind host ports directly.',
        commands: []
      });
    }

    if (dockerRun.hostPid || dockerRun.hostIpc) {
      requirements.push({
        id: 'host-namespace',
        label: 'Host namespace',
        status: 'needs_user',
        userHelpRequired: true,
        detail: 'This command shares a host PID or IPC namespace. Review the image and host exposure before deploying.',
        commands: []
      });
    }

    if (dockerRun.devices.length > 0) {
      requirements.push({
        id: 'devices',
        label: 'Host devices',
        status: 'needs_user',
      userHelpRequired: true,
      detail: `This command passes host devices to the container: ${dockerRun.devices.join(', ')}`,
      commands: dockerRun.devices.map(inspectDeviceCommand)
    });
  }

    if (dockerRun.capabilities.length > 0) {
      requirements.push({
        id: 'capabilities',
        label: 'Linux capabilities',
        status: 'needs_user',
        userHelpRequired: true,
        detail: `This command adds capabilities: ${dockerRun.capabilities.join(', ')}`,
        commands: []
      });
    }
  } catch (error) {
    requirements.push({
      id: 'command-parse',
      label: 'Command requirements',
      status: 'blocked',
      userHelpRequired: true,
      detail: error instanceof Error ? error.message : String(error),
      commands: []
    });
  }

  return requirements;
}

function optionName(token: string) {
  return token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
}

function optionInlineValue(token: string) {
  return token.includes('=') ? token.slice(token.indexOf('=') + 1) : null;
}

function parseDockerRun(tokens: string[]) {
  let containerName: string | null = null;
  const ports: PublishedPort[] = [];
  const hostMounts: HostMount[] = [];
  const devices: string[] = [];
  const capabilities: string[] = [];
  const cleanedArgs: string[] = [];
  let image: string | null = null;
  const warnings: string[] = [];
  let privileged = false;
  let hostNetwork = false;
  let hostPid = false;
  let hostIpc = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!image && token.startsWith('-')) {
      const name = optionName(token);
      const inlineValue = optionInlineValue(token);

      if (name === '-d' || name === '--detach') {
        continue;
      }

      if (name === '--rm') {
        warnings.push('Removed --rm so the deployed container keeps running after restart.');
        continue;
      }

      if (name === '--privileged') {
        privileged = true;
        cleanedArgs.push(token);
        continue;
      }

      if (name === '-p' || name === '--publish') {
        const value = inlineValue ?? tokens[index + 1];

        if (!value) {
          throw new DeployInputError(`${name} requires a port mapping value.`);
        }

        const parsed = parsePortSpec(value);

        if (!parsed) {
          throw new DeployInputError(`Unsupported Docker port mapping: ${value}`);
        }

        ports.push(parsed);

        if (!inlineValue) {
          index += 1;
        }
        continue;
      }

      if (name === '--network' || name === '--net') {
        const value = inlineValue ?? tokens[index + 1];

        if (!value) {
          throw new DeployInputError(`${name} requires a value.`);
        }

        if (value === 'host') {
          hostNetwork = true;
        }

        cleanedArgs.push(token);

        if (inlineValue) {
          continue;
        }

        cleanedArgs.push(value);
        index += 1;
        continue;
      }

      if (name === '--pid' || name === '--ipc') {
        const value = inlineValue ?? tokens[index + 1];

        if (!value) {
          throw new DeployInputError(`${name} requires a value.`);
        }

        if (name === '--pid' && value === 'host') {
          hostPid = true;
        }

        if (name === '--ipc' && value === 'host') {
          hostIpc = true;
        }

        cleanedArgs.push(token);

        if (inlineValue) {
          continue;
        }

        cleanedArgs.push(value);
        index += 1;
        continue;
      }

      if (name === '--device' || name === '--cap-add') {
        const value = inlineValue ?? tokens[index + 1];

        if (!value) {
          throw new DeployInputError(`${name} requires a value.`);
        }

        if (name === '--device') {
          devices.push(value);
        } else {
          capabilities.push(value);
        }

        cleanedArgs.push(token);

        if (inlineValue) {
          continue;
        }

        cleanedArgs.push(value);
        index += 1;
        continue;
      }

      if (name === '--name') {
        const value = inlineValue ?? tokens[index + 1];

        if (!value) {
          throw new DeployInputError('--name requires a value.');
        }

        containerName = value;

        if (!inlineValue) {
          index += 1;
        }
        continue;
      }

      if (name === '-v' || name === '--volume' || name === '--mount') {
        const value = inlineValue ?? tokens[index + 1];

        if (!value) {
          throw new DeployInputError(`${name} requires a value.`);
        }

        const hostMount = hostMountFromOption(name, value);

        if (hostMount) {
          hostMounts.push(hostMount);
        }

        cleanedArgs.push(token);

        if (inlineValue) {
          continue;
        }

        cleanedArgs.push(value);
        index += 1;
        continue;
      }

      cleanedArgs.push(token);

      if (inlineValue) {
        continue;
      }

      if (optionValueNames.has(name)) {
        if (!tokens[index + 1]) {
          throw new DeployInputError(`${name} requires a value.`);
        }
        cleanedArgs.push(tokens[index + 1]);
        index += 1;
        continue;
      }

      if (
        token.startsWith('-') &&
        !token.startsWith('--') &&
        token.length === 2 &&
        shortOptionsWithValues.has(token[1])
      ) {
        if (!tokens[index + 1]) {
          throw new DeployInputError(`${token} requires a value.`);
        }
        cleanedArgs.push(tokens[index + 1]);
        index += 1;
      }

      continue;
    }

    if (!image) {
      image = token;
    }

    cleanedArgs.push(token);
  }

  if (!image) {
    throw new DeployInputError('Could not find the Docker image in this command.');
  }

  return {
    containerName,
    ports,
    hostMounts,
    devices,
    capabilities,
    privileged,
    hostNetwork,
    hostPid,
    hostIpc,
    cleanedArgs,
    image,
    warnings
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function nameFromImage(image: string) {
  const withoutTag = image.split('@')[0].split(':')[0];
  return withoutTag.split('/').at(-1) || 'self-hosted-app';
}

function checkPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();

    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

async function allocatePort(preferredPort: number | null) {
  if (preferredPort) {
    if (await checkPortAvailable(preferredPort)) {
      return preferredPort;
    }

    throw new DeployInputError(`Port ${preferredPort} is already in use.`);
  }

  for (let port = 18080; port <= 19000; port += 1) {
    if (await checkPortAvailable(port)) {
      return port;
    }
  }

  throw new DeployInputError('No free port was found in the 18080-19000 range.');
}

function needsPrivilegedPortRemap(port: number) {
  return (
    port < 1024 &&
    process.platform !== 'win32' &&
    typeof process.getuid === 'function' &&
    process.getuid() !== 0
  );
}

async function resolveHostPort(requestedHostPort: number | null, warnings: string[]) {
  if (!requestedHostPort) {
    return allocatePort(null);
  }

  if (needsPrivilegedPortRemap(requestedHostPort)) {
    const allocated = await allocatePort(null);
    warnings.push(
      `Host port ${requestedHostPort} needs elevated system privileges, so NaviProxy assigned ${allocated} instead.`
    );
    return allocated;
  }

  if (await checkPortAvailable(requestedHostPort)) {
    return requestedHostPort;
  }

  const allocated = await allocatePort(null);
  warnings.push(
    `Host port ${requestedHostPort} is already in use, so NaviProxy assigned ${allocated} instead.`
  );
  return allocated;
}

export class DeployService {
  private readonly repo: DeploymentsRepo;

  constructor(
    db: NaviDatabase,
    private readonly appsService: AppsService
  ) {
    this.repo = new DeploymentsRepo(db);
  }

  options() {
    return {
      methods: [
        {
          id: 'docker_run',
          name: 'Docker run',
          capabilities: [
            'paste-command',
            'auto-port',
            'reverse-proxy',
            'public-host',
            'public-domain'
          ]
        },
        {
          id: 'docker_compose',
          name: 'Docker Compose',
          status: 'planned'
        },
        {
          id: 'existing_service',
          name: 'Existing local service',
          status: 'available-through-local-scan'
        }
      ]
    };
  }

  async doctor(input?: unknown) {
    const checks: DeployDoctorCheck[] = [];
    const grantSteps: DeployDoctorGrantStep[] = [];
    const requirements = await commandPermissionRequirements(input);
    const groups = await currentGroupNames();
    const dockerBin = config.dockerBin;

    checks.push({
      id: 'process-user',
      label: 'NaviProxy user',
      status: 'pass',
      detail: `${os.userInfo().username || 'unknown'} on ${process.platform}`
    });

    checks.push({
      id: 'docker-bin-config',
      label: 'Docker binary setting',
      status: dockerBin ? 'pass' : 'fail',
      detail: dockerBin || 'DOCKER_BIN is empty'
    });

    try {
      const version = await commandOutput(dockerBin, ['--version']);
      checks.push({
        id: 'docker-cli',
        label: 'Docker CLI',
        status: 'pass',
        detail: version
      });
    } catch (error) {
      const detail =
        isNodeError(error) && error.code === 'ENOENT'
          ? `Docker CLI was not found at "${dockerBin}".`
          : commandDetail(error);

      checks.push({
        id: 'docker-cli',
        label: 'Docker CLI',
        status: 'fail',
        detail
      });
      grantSteps.push({
        title: 'Point NaviProxy at Docker',
        description: 'Install Docker or start NaviProxy with the full Docker binary path.',
        commands: [
          'which docker',
          'DOCKER_BIN=/full/path/to/docker npm run dev'
        ]
      });

      return {
        ok: false,
        dockerBin,
        dockerHost: process.env.DOCKER_HOST ?? null,
        dockerConfig: process.env.DOCKER_CONFIG ?? null,
        platform: process.platform,
        checks,
        requirements,
        userHelpRequired: true,
        grantSteps
      };
    }

    if (process.platform === 'linux') {
      checks.push({
        id: 'docker-group',
        label: 'Docker group',
        status: groups.includes('docker') ? 'pass' : 'warn',
        detail: groups.includes('docker')
          ? 'The NaviProxy process user is in the docker group.'
          : 'The NaviProxy process user is not in the docker group. Docker may still work through rootless Docker or DOCKER_HOST.'
      });
    }

    try {
      const info = await runDockerCommand(['info', '--format', '{{json .ServerVersion}}'], {
        timeout: 45_000
      });
      checks.push({
        id: 'docker-daemon',
        label: 'Docker daemon',
        status: 'pass',
        detail: `Docker server ${info.stdout.trim().replace(/^"|"$/g, '') || 'is reachable'}`
      });
    } catch (error) {
      const detail = commandDetail(error);

      checks.push({
        id: 'docker-daemon',
        label: 'Docker daemon',
        status: error instanceof DeployRuntimeUnavailableError ? 'fail' : 'warn',
        detail
      });
      grantSteps.push(...dockerPermissionGrantSteps(detail));
    }

    const commandBlocked = requirements.some((requirement) => requirement.status === 'blocked');
    const userHelpRequired =
      checks.some((check) => check.status === 'fail') ||
      requirements.some((requirement) => requirement.userHelpRequired);
    const ok = checks.every((check) => check.status !== 'fail') && !commandBlocked;

    return {
      ok,
      dockerBin,
      dockerHost: process.env.DOCKER_HOST ?? null,
      dockerConfig: process.env.DOCKER_CONFIG ?? null,
      platform: process.platform,
      checks,
      requirements,
      userHelpRequired,
      grantSteps
    };
  }

  async preview(input: unknown) {
    const plan = await this.buildPlan(input, true);
    this.appsService.validateCreate(plan.appPayload);
    return plan;
  }

  async deploy(input: unknown) {
    let plan = await this.buildPlan(input, true);

    this.appsService.validateCreate(plan.appPayload);

    let containerId = '';
    let adoptedExistingContainer = false;

    try {
      await ensureHostMountsWritable(plan.hostMounts);
      const { stdout } = await runDockerCommand(plan.dockerArgs, {
        timeout: 240_000
      });
      containerId = stdout.trim();
    } catch (error) {
      const detail = commandDetail(error);

      if (!isContainerNameConflict(detail)) {
        throw error;
      }

      let existing = await inspectContainer(plan.containerName);

      if (!existing.State?.Running) {
        await runDockerCommand(['start', plan.containerName]);
        existing = await inspectContainer(plan.containerName);
      }

      containerId = existing.Id;
      plan = planWithExistingContainer(plan, existing);
      adoptedExistingContainer = true;
    }

    this.appsService.validateCreate(plan.appPayload);

    let created;

    try {
      created = await this.appsService.create(plan.appPayload);
      if (created.app) {
        this.repo.create({
          appId: created.app.id,
          provider: 'docker',
          resourceId: containerId,
          resourceName: plan.containerName
        });
      }
    } catch (error) {
      if (!adoptedExistingContainer) {
        await runDockerCommand(['rm', '-fv', plan.containerName]).catch(() => undefined);
      }

      if (created?.app) {
        await this.appsService.delete(created.app.id).catch(() => undefined);
      }

      throw error;
    }

    return {
      containerId,
      plan,
      app: created.app,
      proxySync: created.proxySync
    };
  }

  findManagedDeployment(appId: string) {
    return this.repo.findByAppId(appId);
  }

  async deleteManagedDeployment(appId: string) {
    const deployment = this.repo.findByAppId(appId);

    if (!deployment) {
      return null;
    }

    try {
      await runDockerCommand(['rm', '-fv', deployment.resourceName]);
    } catch (error) {
      const detail = commandDetail(error);

      if (!/No such container/i.test(detail)) {
        throw error;
      }
    }

    this.repo.delete(appId);

    return {
      provider: deployment.provider,
      resourceName: deployment.resourceName
    };
  }

  private async buildPlan(input: unknown, allocateHostPort: boolean): Promise<DockerRunPlan> {
    const parsed = deployInputSchema.parse(input);
    const dockerRun = parseDockerRun(trimDockerPrefix(tokenizeShellCommand(parsed.command)));
    const selectedPublishedPort =
      dockerRun.ports.find((port) => port.protocol === 'tcp') ?? dockerRun.ports[0];
    const containerPort = parsed.containerPort ?? selectedPublishedPort?.containerPort;

    if (!containerPort) {
      throw new DeployInputError(
        'Add a -p mapping to the Docker command or provide a container port.'
      );
    }

    const requestedHostPort =
      parsed.hostPort ?? selectedPublishedPort?.hostPort ?? null;
    const warnings = [...dockerRun.warnings];
    const hostPort =
      allocateHostPort
        ? await resolveHostPort(requestedHostPort, warnings)
        : requestedHostPort;
    const baseName =
      parsed.name ??
      dockerRun.containerName ??
      nameFromImage(dockerRun.image);
    const containerName = slugify(baseName) || `app-${containerPort}`;
    const routeMode = parsed.routeMode;
    const publicPath =
      routeMode === 'subpath'
        ? parsed.publicPath ?? `/${slugify(containerName) || 'app'}`
        : null;
    const targetUrl = `http://127.0.0.1:${hostPort ?? requestedHostPort ?? containerPort}`;
    const appPayload = {
      name: baseName,
      iconType: 'builtin' as const,
      iconValue: null,
      targetUrl,
      routeMode,
      publicHost: parsed.publicHost,
      publicPath,
      enabled: parsed.enabled,
      sortOrder: 0,
      category: parsed.category ?? 'Self-hosted',
      tags: parsed.tags,
      favorite: parsed.favorite
    };
    const dockerArgs = [
      'run',
      '-d',
      '--name',
      containerName,
      '-p',
      `${hostPort ?? requestedHostPort ?? containerPort}:${containerPort}`,
      ...dockerRun.cleanedArgs
    ];

    return {
      containerName,
      image: dockerRun.image,
      publishMode: parsed.publishMode,
      hostPort,
      containerPort,
      protocol: selectedPublishedPort?.protocol ?? 'tcp',
      targetUrl,
      hostMounts: dockerRun.hostMounts,
      appPayload,
      dockerArgs,
      warnings: [
        ...warnings,
        ...(hostPort
          ? []
          : ['A free host port will be allocated when deployment starts.']),
        ...(dockerRun.hostMounts.length
          ? ['Bind mount paths will be created and checked before Docker starts.']
          : []),
        ...(parsed.publishMode === 'public_domain_reverse_proxy'
          ? [
              'Public domain mode requires DNS to point to this machine and Caddy to receive public traffic.'
            ]
          : [
              'Reverse proxy mode will bind the host in Caddy; DNS must resolve to this machine for clients to reach it.'
            ])
      ]
    };
  }
}
