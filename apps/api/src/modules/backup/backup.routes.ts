import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { config } from '../../config.js';
import { AppConflictError, type AppsService } from '../apps/apps.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { SettingsService } from '../settings/settings.service.js';

export async function registerBackupRoutes(
  app: FastifyInstance,
  appsService: AppsService,
  settingsService: SettingsService,
  auditService: AuditService
) {
  app.get('/api/backup', async () => ({
    exportedAt: new Date().toISOString(),
    version: 1,
    apps: appsService.exportApps().apps,
    settings: settingsService.getAll()
  }));

  app.post('/api/backup/restore', async (request, reply) => {
    const body = request.body as {
      apps?: unknown[];
      settings?: unknown;
    };

    if (!body?.apps || !Array.isArray(body.apps)) {
      return reply.code(400).send({ message: 'Backup file does not contain apps.' });
    }

    try {
      const snapshot = {
        exportedAt: new Date().toISOString(),
        version: 1,
        apps: appsService.exportApps().apps,
        settings: settingsService.getAll()
      };

      auditService.record({
        action: 'backup.snapshot',
        targetType: 'backup',
        summary: 'Created automatic pre-restore snapshot',
        sourceIp: request.ip
      });
      appsService.recordBackupSnapshot('pre_restore', snapshot);

      const appsResult = await appsService.importApps({
        mode: 'replace',
        apps: body.apps
      });
      const settings = body.settings
        ? settingsService.update(body.settings, {
            adminTokenConfigured: Boolean(config.adminToken)
          })
        : settingsService.getAll();
      auditService.record({
        action: 'backup.restore',
        targetType: 'backup',
        summary: `Restored ${body.apps.length} apps`,
        sourceIp: request.ip
      });

      return {
        ...appsResult,
        settings,
        snapshot
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
