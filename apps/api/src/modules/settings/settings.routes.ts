import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ProxyService } from '../proxy/proxy.service.js';
import type { SettingsService } from './settings.service.js';

export async function registerSettingsRoutes(
  app: FastifyInstance,
  settingsService: SettingsService,
  proxyService: ProxyService,
  auditService: AuditService
) {
  app.get('/api/settings', async () => settingsService.getAll());

  app.put('/api/settings', async (request, reply) => {
    try {
      const settings = settingsService.update(request.body, {
        adminTokenConfigured: Boolean(config.adminToken)
      });
      auditService.record({
        action: 'settings.update',
        targetType: 'settings',
        summary: 'Updated gateway settings',
        sourceIp: request.ip
      });
      const proxySync = await proxyService.syncSafely();

      return {
        settings,
        proxySync
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
