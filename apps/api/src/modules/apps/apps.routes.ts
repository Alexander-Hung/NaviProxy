import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { config } from '../../config.js';
import type { AuditService } from '../audit/audit.service.js';
import { AppConflictError, type AppsService } from './apps.service.js';

function handleAppError(error: unknown, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.code(400).send({ message: 'Invalid app input', issues: error.issues });
  }

  if (error instanceof AppConflictError) {
    return reply.code(409).send({ message: error.message });
  }

  throw error;
}

export async function registerAppsRoutes(
  app: FastifyInstance,
  appsService: AppsService,
  auditService: AuditService
) {
  app.get('/api/health', async () => ({
    ok: true,
    name: 'NaviProxy',
    authRequired: Boolean(config.adminToken)
  }));

  app.get('/api/apps', async () => appsService.list());

  app.get('/api/apps/status', async () => appsService.checkStatuses());

  app.get('/api/apps/:id/health-history', async (request) => {
    const { id } = request.params as { id: string };
    const { limit } = request.query as { limit?: string };
    return appsService.healthHistory(id, Number(limit ?? 30));
  });

  app.get('/api/apps/export', async () => appsService.exportApps());

  app.post('/api/apps', async (request, reply) => {
    try {
      const created = await appsService.create(request.body);
      auditService.record({
        action: 'app.create',
        targetType: 'app',
        targetId: created.app?.id,
        summary: `Created ${created.app?.name ?? 'app'}`,
        sourceIp: request.ip
      });
      return reply.code(201).send(created);
    } catch (error) {
      return handleAppError(error, reply);
    }
  });

  app.post('/api/apps/import', async (request, reply) => {
    try {
      const result = await appsService.importApps(request.body);
      auditService.record({
        action: 'app.import',
        targetType: 'app',
        summary: `Imported ${result.apps.length} apps`,
        sourceIp: request.ip
      });
      return result;
    } catch (error) {
      return handleAppError(error, reply);
    }
  });

  app.patch('/api/apps/reorder', async (request, reply) => {
    try {
      const result = await appsService.reorder(request.body);
      auditService.record({
        action: 'app.reorder',
        targetType: 'app',
        summary: `Reordered ${result.apps.length} apps`,
        sourceIp: request.ip
      });
      return result;
    } catch (error) {
      return handleAppError(error, reply);
    }
  });

  app.put('/api/apps/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const updated = await appsService.update(id, request.body);

      if (!updated) {
        return reply.code(404).send({ message: 'App not found' });
      }

      auditService.record({
        action: 'app.update',
        targetType: 'app',
        targetId: updated.app?.id,
        summary: `Updated ${updated.app?.name ?? id}`,
        sourceIp: request.ip
      });
      return updated;
    } catch (error) {
      return handleAppError(error, reply);
    }
  });

  app.delete('/api/apps/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await appsService.delete(id);

    if (!result.deleted) {
      return reply.code(404).send({ message: 'App not found' });
    }

    auditService.record({
      action: 'app.delete',
      targetType: 'app',
      targetId: id,
      summary: `Deleted app ${id}`,
      sourceIp: request.ip
    });
    return { ok: true, proxySync: result.proxySync };
  });
}
