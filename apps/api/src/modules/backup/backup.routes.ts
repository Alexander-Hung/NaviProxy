import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ZodError } from 'zod';
import { config } from '../../config.js';
import { AppConflictError, type AppsService } from '../apps/apps.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { SettingsService } from '../settings/settings.service.js';

type BackupFile = {
  path: string;
  encoding: 'base64';
  content: string;
  size: number;
};

type DockerMountArchive = {
  deployment: string;
  container: string;
  origin: 'the_containers' | 'registered_app' | 'compose' | 'docker';
  type: 'bind' | 'volume';
  name: string | null;
  source: string;
  destination: string;
  files: BackupFile[];
  skipped: Array<{
    path: string;
    reason: string;
    size?: number;
  }>;
};

type DockerProjectFile = BackupFile & {
  absolutePath: string;
  project: string | null;
  container: string;
};

type DockerMount = {
  Type?: string;
  Name?: string;
  Source?: string;
  Destination?: string;
};

type DockerInspectContainer = {
  Id?: string;
  Name?: string;
  Config?: {
    Image?: string;
    Labels?: Record<string, string>;
  };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
  Mounts?: DockerMount[];
};

const maxBackupFileSize = 1024 * 1024;
const maxBackupFilesTotalSize = 5 * 1024 * 1024;
const maxDockerDataFileSize = Number(process.env.BACKUP_DOCKER_DATA_MAX_FILE_BYTES ?? 25 * 1024 * 1024);
const maxDockerDataTotalSize = Number(process.env.BACKUP_DOCKER_DATA_MAX_TOTAL_BYTES ?? 256 * 1024 * 1024);
const execFileAsync = promisify(execFile);

function safeRelativePath(value: string) {
  return (
    value &&
    !path.isAbsolute(value) &&
    !value.includes('\0') &&
    !value.split(/[\\/]+/).includes('..')
  );
}

function safeDeploymentTarget(relativePath: string) {
  const root = path.resolve(config.deploymentsPath);
  const target = path.resolve(root, relativePath);

  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

async function collectDeploymentFiles() {
  const files: BackupFile[] = [];
  let totalSize = 0;

  async function walk(dir: string, prefix = '') {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relativePath = path.posix.join(prefix, entry.name);
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stat = await fs.stat(fullPath);

      if (stat.size > maxBackupFileSize || totalSize + stat.size > maxBackupFilesTotalSize) {
        continue;
      }

      const content = await fs.readFile(fullPath);
      totalSize += stat.size;
      files.push({
        path: relativePath,
        encoding: 'base64',
        content: content.toString('base64'),
        size: stat.size
      });
    }
  }

  await walk(config.deploymentsPath);
  return files;
}

async function runDocker(args: string[]) {
  return execFileAsync(config.dockerBin, args, {
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024
  });
}

async function inspectDockerContainer(name: string) {
  const { stdout } = await runDocker(['inspect', name]);
  const parsed = JSON.parse(stdout) as DockerInspectContainer[];
  return parsed[0] ?? null;
}

async function composeContainerNames(projectName: string) {
  const { stdout } = await runDocker([
    'ps',
    '-a',
    '--filter',
    `label=com.docker.compose.project=${projectName}`,
    '--format',
    '{{.Names}}'
  ]);

  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function allDockerContainerNames() {
  const { stdout } = await runDocker([
    'ps',
    '-a',
    '--format',
    '{{.Names}}'
  ]);

  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function appTargetPorts(apps: Array<{ targetUrl?: string }>) {
  const ports = new Set<number>();

  for (const app of apps) {
    if (!app.targetUrl) {
      continue;
    }

    try {
      const url = new URL(app.targetUrl);
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));

      if (Number.isInteger(port) && port >= 1 && port <= 65535) {
        ports.add(port);
      }
    } catch {
      // Ignore legacy or partial target URLs in imported backups.
    }
  }

  return ports;
}

function containerHostPorts(container: DockerInspectContainer) {
  const ports = new Set<number>();

  for (const bindings of Object.values(container.NetworkSettings?.Ports ?? {})) {
    for (const binding of bindings ?? []) {
      const port = Number(binding.HostPort);

      if (Number.isInteger(port) && port >= 1 && port <= 65535) {
        ports.add(port);
      }
    }
  }

  return ports;
}

function containerName(container: DockerInspectContainer) {
  return container.Name?.replace(/^\//, '') || container.Id || 'unknown-container';
}

function containerComposeProject(container: DockerInspectContainer) {
  return container.Config?.Labels?.['com.docker.compose.project'] ?? null;
}

function containerComposeConfigFiles(container: DockerInspectContainer) {
  const raw = container.Config?.Labels?.['com.docker.compose.project.config_files'];

  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((file) => file.trim())
    .filter((file) => path.isAbsolute(file));
}

function originForContainer(
  container: DockerInspectContainer,
  managedNames: Set<string>,
  registeredPorts: Set<number>
): DockerMountArchive['origin'] {
  const name = containerName(container);

  if (managedNames.has(name) || (containerComposeProject(container) && managedNames.has(containerComposeProject(container) ?? ''))) {
    return 'the_containers';
  }

  for (const port of containerHostPorts(container)) {
    if (registeredPorts.has(port)) {
      return 'registered_app';
    }
  }

  return containerComposeProject(container) ? 'compose' : 'docker';
}

async function collectFilesFromPath(
  root: string,
  options: {
    maxFileSize: number;
    remainingBytes: () => number;
    consumeBytes: (bytes: number) => void;
  }
) {
  const files: BackupFile[] = [];
  const skipped: DockerMountArchive['skipped'] = [];
  const resolvedRoot = path.resolve(root);

  async function walk(dir: string, prefix = '') {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      skipped.push({ path: prefix || '.', reason: 'unreadable' });
      return;
    }

    for (const entry of entries) {
      const relativePath = path.posix.join(prefix, entry.name);
      const fullPath = path.join(dir, entry.name);
      const resolvedPath = path.resolve(fullPath);

      if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`) && resolvedPath !== resolvedRoot) {
        skipped.push({ path: relativePath, reason: 'outside-root' });
        continue;
      }

      if (entry.isSymbolicLink()) {
        skipped.push({ path: relativePath, reason: 'symlink' });
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
        continue;
      }

      if (!entry.isFile()) {
        skipped.push({ path: relativePath, reason: 'not-file' });
        continue;
      }

      const stat = await fs.stat(fullPath);

      if (stat.size > options.maxFileSize) {
        skipped.push({ path: relativePath, reason: 'file-too-large', size: stat.size });
        continue;
      }

      if (stat.size > options.remainingBytes()) {
        skipped.push({ path: relativePath, reason: 'bundle-size-limit', size: stat.size });
        continue;
      }

      const content = await fs.readFile(fullPath);
      options.consumeBytes(stat.size);
      files.push({
        path: relativePath,
        encoding: 'base64',
        content: content.toString('base64'),
        size: stat.size
      });
    }
  }

  await walk(resolvedRoot);
  return { files, skipped };
}

async function discoverBackupContainers(
  deployments: Array<{ provider: string; resourceName: string }>,
  apps: Array<{ targetUrl?: string }>
) {
  const backupScope = (process.env.BACKUP_DOCKER_SCOPE ?? 'all').toLowerCase();
  const managedNames = new Set(deployments.map((deployment) => deployment.resourceName));
  const registeredPorts = appTargetPorts(apps);
  const containersByName = new Map<string, DockerInspectContainer>();

  for (const deployment of deployments) {
    try {
      if (deployment.provider === 'docker_compose') {
        const names = await composeContainerNames(deployment.resourceName);

        for (const name of names) {
          const container = await inspectDockerContainer(name);

          if (container) {
            containersByName.set(containerName(container), container);
          }
        }
      } else {
        const container = await inspectDockerContainer(deployment.resourceName);

        if (container) {
          containersByName.set(containerName(container), container);
        }
      }
    } catch {
      continue;
    }
  }

  if (backupScope !== 'managed') {
    try {
      const names = await allDockerContainerNames();

      for (const name of names) {
        if (containersByName.has(name)) {
          continue;
        }

        const container = await inspectDockerContainer(name);

        if (container) {
          containersByName.set(containerName(container), container);
        }
      }
    } catch {
      // Docker may be unavailable on development machines. The app backup still remains useful.
    }
  }

  return [...containersByName.values()].map((container) => ({
    container,
    origin: originForContainer(container, managedNames, registeredPorts)
  }));
}

async function collectDockerProjectFiles(
  containers: Array<{ container: DockerInspectContainer; origin: DockerMountArchive['origin'] }>
) {
  const files: DockerProjectFile[] = [];
  const seen = new Set<string>();

  for (const { container } of containers) {
    for (const filePath of containerComposeConfigFiles(container)) {
      const resolved = path.resolve(filePath);

      if (seen.has(resolved)) {
        continue;
      }

      seen.add(resolved);

      try {
        const stat = await fs.stat(resolved);

        if (!stat.isFile() || stat.size > maxBackupFileSize) {
          continue;
        }

        const content = await fs.readFile(resolved);

        files.push({
          path: path.basename(resolved),
          absolutePath: resolved,
          project: containerComposeProject(container),
          container: containerName(container),
          encoding: 'base64',
          content: content.toString('base64'),
          size: stat.size
        });
      } catch {
        continue;
      }
    }
  }

  return files;
}

async function collectDockerDataArchives(
  containers: Array<{ container: DockerInspectContainer; origin: DockerMountArchive['origin'] }>
) {
  const archives: DockerMountArchive[] = [];
  let totalSize = 0;
  const seenMounts = new Set<string>();

  for (const { container, origin } of containers) {
    const name = containerName(container);
    const deployment = containerComposeProject(container) ?? name;

    for (const mount of container.Mounts ?? []) {
      if (
        mount.Type !== 'bind' &&
        mount.Type !== 'volume'
      ) {
        continue;
      }

      if (!mount.Source || !mount.Destination) {
        continue;
      }

      const mountKey = `${mount.Type}:${mount.Name ?? mount.Source}`;

      if (seenMounts.has(mountKey)) {
        continue;
      }

      seenMounts.add(mountKey);

      const { files, skipped } = await collectFilesFromPath(mount.Source, {
        maxFileSize: maxDockerDataFileSize,
        remainingBytes: () => Math.max(0, maxDockerDataTotalSize - totalSize),
        consumeBytes: (bytes) => {
          totalSize += bytes;
        }
      });

      archives.push({
        deployment,
        container: name,
        origin,
        type: mount.Type,
        name: mount.Name ?? null,
        source: mount.Source,
        destination: mount.Destination,
        files,
        skipped
      });
    }
  }

  return archives;
}

async function restoreDockerProjectFiles(files: unknown) {
  if (!Array.isArray(files)) {
    return 0;
  }

  let restored = 0;

  for (const file of files) {
    if (!file || typeof file !== 'object') {
      continue;
    }

    const input = file as Partial<DockerProjectFile>;

    if (
      typeof input.absolutePath !== 'string' ||
      !path.isAbsolute(input.absolutePath) ||
      input.encoding !== 'base64' ||
      typeof input.content !== 'string'
    ) {
      continue;
    }

    await fs.mkdir(path.dirname(input.absolutePath), { recursive: true });
    await fs.writeFile(input.absolutePath, Buffer.from(input.content, 'base64'), { mode: 0o600 });
    restored += 1;
  }

  return restored;
}

async function writeBackupFilesToRoot(root: string, files: BackupFile[]) {
  let restored = 0;
  const resolvedRoot = path.resolve(root);

  for (const file of files) {
    if (!safeRelativePath(file.path)) {
      continue;
    }

    const target = path.resolve(resolvedRoot, file.path);

    if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
      continue;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(file.content, 'base64'), { mode: 0o600 });
    restored += 1;
  }

  return restored;
}

async function restoreNamedVolume(name: string, files: BackupFile[]) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'the-containers-volume-restore-'));
  const helperName = `the-containers-restore-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    await writeBackupFilesToRoot(tmpRoot, files);
    await runDocker(['volume', 'create', name]);

    try {
      await runDocker(['create', '--name', helperName, '-v', `${name}:/restore`, 'busybox:latest', 'sh']);
    } catch {
      await runDocker(['pull', 'busybox:latest']);
      await runDocker(['create', '--name', helperName, '-v', `${name}:/restore`, 'busybox:latest', 'sh']);
    }

    await runDocker(['cp', `${tmpRoot}${path.sep}.`, `${helperName}:/restore`]);
    return files.length;
  } finally {
    await runDocker(['rm', '-f', helperName]).catch(() => undefined);
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function backupFilesFromUnknown(files: unknown) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files.flatMap((file) => {
    if (!file || typeof file !== 'object') {
      return [];
    }

    const input = file as Partial<BackupFile>;

    if (
      typeof input.path !== 'string' ||
      input.encoding !== 'base64' ||
      typeof input.content !== 'string' ||
      typeof input.size !== 'number' ||
      !safeRelativePath(input.path)
    ) {
      return [];
    }

    return [{
      path: input.path,
      encoding: input.encoding,
      content: input.content,
      size: input.size
    }];
  });
}

async function restoreMountArchive(input: Partial<DockerMountArchive>) {
  const files = backupFilesFromUnknown(input.files);

  if (files.length === 0) {
    return 0;
  }

  if (input.type === 'volume' && typeof input.name === 'string' && input.name) {
    try {
      return await restoreNamedVolume(input.name, files);
    } catch {
      if (typeof input.source !== 'string' || !path.isAbsolute(input.source)) {
        return 0;
      }
    }
  }

  if (typeof input.source !== 'string' || !path.isAbsolute(input.source)) {
    return 0;
  }

  return restoreFilesToRoot(input.source, files);
}

async function restoreDeploymentFiles(files: unknown) {
  if (!Array.isArray(files)) {
    return 0;
  }

  let restored = 0;

  for (const file of files) {
    if (!file || typeof file !== 'object') {
      continue;
    }

    const input = file as Partial<BackupFile>;

    if (
      typeof input.path !== 'string' ||
      input.encoding !== 'base64' ||
      typeof input.content !== 'string' ||
      !safeRelativePath(input.path)
    ) {
      continue;
    }

    const target = safeDeploymentTarget(input.path);

    if (!target) {
      continue;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(input.content, 'base64'), { mode: 0o600 });
    restored += 1;
  }

  return restored;
}

async function restoreFilesToRoot(root: string, files: unknown) {
  if (!Array.isArray(files)) {
    return 0;
  }

  let restored = 0;
  const resolvedRoot = path.resolve(root);

  for (const file of files) {
    if (!file || typeof file !== 'object') {
      continue;
    }

    const input = file as Partial<BackupFile>;

    if (
      typeof input.path !== 'string' ||
      input.encoding !== 'base64' ||
      typeof input.content !== 'string' ||
      !safeRelativePath(input.path)
    ) {
      continue;
    }

    const target = path.resolve(resolvedRoot, input.path);

    if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
      continue;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(input.content, 'base64'), { mode: 0o600 });
    restored += 1;
  }

  return restored;
}

async function restoreDockerDataArchives(archives: unknown) {
  if (!Array.isArray(archives)) {
    return 0;
  }

  let restored = 0;

  for (const archive of archives) {
    if (!archive || typeof archive !== 'object') {
      continue;
    }

    const input = archive as Partial<DockerMountArchive>;

    restored += await restoreMountArchive(input);
  }

  return restored;
}

function extractBackupBody(input: unknown) {
  if (Array.isArray(input)) {
    return { apps: input };
  }

  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const data = record.data && typeof record.data === 'object'
    ? record.data as Record<string, unknown>
    : {};
  const payload = record.payload && typeof record.payload === 'object'
    ? record.payload as Record<string, unknown>
    : {};

  return {
    ...record,
    apps: record.apps ?? data.apps ?? payload.apps ?? record.items ?? data.items ?? payload.items,
    deployments: record.deployments ?? data.deployments ?? payload.deployments,
    deploymentFiles:
      record.deploymentFiles ??
      record.deployment_files ??
      data.deploymentFiles ??
      data.deployment_files ??
      payload.deploymentFiles ??
      payload.deployment_files,
    dockerDataArchives:
      record.dockerDataArchives ??
      record.docker_data_archives ??
      data.dockerDataArchives ??
      data.docker_data_archives ??
      payload.dockerDataArchives ??
      payload.docker_data_archives,
    dockerProjectFiles:
      record.dockerProjectFiles ??
      record.docker_project_files ??
      data.dockerProjectFiles ??
      data.docker_project_files ??
      payload.dockerProjectFiles ??
      payload.docker_project_files,
    settings: record.settings ?? data.settings ?? payload.settings
  };
}

export async function registerBackupRoutes(
  app: FastifyInstance,
  appsService: AppsService,
  settingsService: SettingsService,
  auditService: AuditService
) {
  app.get('/api/backup', async () => {
    const deploymentFiles = await collectDeploymentFiles();
    const deployments = appsService.exportDeployments();
    const apps = appsService.exportApps().apps;
    const dockerContainers = await discoverBackupContainers(deployments, apps);
    const dockerProjectFiles = await collectDockerProjectFiles(dockerContainers);
    const dockerDataArchives = await collectDockerDataArchives(dockerContainers);

    return {
      exportedAt: new Date().toISOString(),
      version: 5,
      kind: 'the-containers-backup',
      apps,
      deployments,
      deploymentFiles,
      dockerProjectFiles,
      dockerDataArchives,
      notes: [
        'This backup includes The Containers configuration, managed deployment files, discovered Docker Compose project files, and readable Docker bind mount or named volume data.',
        'By default BACKUP_DOCKER_SCOPE=all scans all local Docker containers, including Dockge-managed stacks and manually started containers. Set BACKUP_DOCKER_SCOPE=managed to only include The Containers managed deployments.',
        'External databases, DNS records, router rules, unreadable host paths, skipped large files, and files outside Docker mounts may still need separate backup.'
      ],
      settings: settingsService.getAll()
    };
  });

  app.post('/api/backup/restore', async (request, reply) => {
    const body = extractBackupBody(request.body) as {
      apps?: unknown[];
      deployments?: unknown[];
      deploymentFiles?: unknown[];
      dockerProjectFiles?: unknown[];
      dockerDataArchives?: unknown[];
      settings?: unknown;
    };

    if (!body?.apps || !Array.isArray(body.apps)) {
      return reply.code(400).send({ message: 'Backup file does not contain apps.' });
    }

    try {
      const result = await appsService.restoreBackup({
        apps: body.apps,
        deployments: body.deployments,
        settings: body.settings,
        settingsService,
        adminTokenConfigured: Boolean(config.adminToken)
      });
      const deploymentFiles = await restoreDeploymentFiles(body.deploymentFiles);
      const dockerProjectFiles = await restoreDockerProjectFiles(body.dockerProjectFiles);
      const dockerDataFiles = await restoreDockerDataArchives(body.dockerDataArchives);
      auditService.record({
        action: 'backup.restore',
        targetType: 'backup',
        summary: `Restored ${body.apps.length} apps, ${deploymentFiles} deployment files, ${dockerProjectFiles} Docker project files, and ${dockerDataFiles} Docker data files`,
        sourceIp: request.ip
      });

      return {
        ...result,
        deploymentFiles,
        dockerProjectFiles,
        dockerDataFiles
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          message: 'Invalid backup input',
          issues: error.issues
        });
      }

      if (error instanceof AppConflictError) {
        return reply.code(409).send({ message: error.message });
      }

      throw error;
    }
  });

  app.get('/api/backup/snapshots', async () => appsService.listBackupSnapshots());
}
