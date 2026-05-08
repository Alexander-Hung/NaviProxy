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
      const result = await appsService.restoreBackup({
        apps: body.apps,
        settings: body.settings,
        settingsService,
        adminTokenConfigured: Boolean(config.adminToken)
      });
      auditService.record({
        action: 'backup.restore',
        targetType: 'backup',
        summary: `Restored ${body.apps.length} apps`,
        sourceIp: request.ip
      });

      return result;
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
