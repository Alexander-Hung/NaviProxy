import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
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

type DockerMount = {
  Type?: string;
  Name?: string;
  Source?: string;
  Destination?: string;
};

type DockerInspectContainer = {
  Id?: string;
  Name?: string;
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

async function collectDockerDataArchives(deployments: Array<{ provider: string; resourceName: string }>) {
  const archives: DockerMountArchive[] = [];
  let totalSize = 0;
  const seenMounts = new Set<string>();

  for (const deployment of deployments) {
    let containers: DockerInspectContainer[] = [];

    try {
      if (deployment.provider === 'docker_compose') {
        const names = await composeContainerNames(deployment.resourceName);
        containers = (await Promise.all(names.map((name) => inspectDockerContainer(name))))
          .filter((container): container is DockerInspectContainer => Boolean(container));
      } else {
        const container = await inspectDockerContainer(deployment.resourceName);
        containers = container ? [container] : [];
      }
    } catch {
      continue;
    }

    for (const container of containers) {
      const containerName = container.Name?.replace(/^\//, '') || container.Id || deployment.resourceName;

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

        const mountKey = `${mount.Type}:${mount.Source}`;

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
          deployment: deployment.resourceName,
          container: containerName,
          type: mount.Type,
          name: mount.Name ?? null,
          source: mount.Source,
          destination: mount.Destination,
          files,
          skipped
        });
      }
    }
  }

  return archives;
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

    if (
      typeof input.source !== 'string' ||
      !path.isAbsolute(input.source) ||
      !Array.isArray(input.files)
    ) {
      continue;
    }

    restored += await restoreFilesToRoot(input.source, input.files);
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
    const dockerDataArchives = await collectDockerDataArchives(deployments);

    return {
      exportedAt: new Date().toISOString(),
      version: 4,
      kind: 'the-containers-backup',
      apps: appsService.exportApps().apps,
      deployments,
      deploymentFiles,
      dockerDataArchives,
      notes: [
        'This backup includes The Containers configuration, managed deployment files, and readable Docker bind mount or named volume data.',
        'External databases, DNS records, router rules, unreadable Docker Desktop VM volume paths, skipped large files, and files outside Docker mounts may still need separate backup.'
      ],
      settings: settingsService.getAll()
    };
  });

  app.post('/api/backup/restore', async (request, reply) => {
    const body = extractBackupBody(request.body) as {
      apps?: unknown[];
      deployments?: unknown[];
      deploymentFiles?: unknown[];
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
      const dockerDataFiles = await restoreDockerDataArchives(body.dockerDataArchives);
      auditService.record({
        action: 'backup.restore',
        targetType: 'backup',
        summary: `Restored ${body.apps.length} apps, ${deploymentFiles} deployment files, and ${dockerDataFiles} Docker data files`,
        sourceIp: request.ip
      });

      return {
        ...result,
        deploymentFiles,
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
