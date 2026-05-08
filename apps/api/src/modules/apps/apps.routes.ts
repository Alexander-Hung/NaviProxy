import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { config } from '../../config.js';
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
  appsService: AppsService
) {
  app.get('/api/health', async () => ({
    ok: true,
    name: 'NaviProxy',
    authRequired: Boolean(config.adminToken)
  }));

  app.get('/api/apps', async () => appsService.list());

  app.get('/api/apps/status', async () => appsService.checkStatuses());

  app.get('/api/apps/export', async () => appsService.exportApps());

  app.post('/api/apps', async (request, reply) => {
    try {
      const created = await appsService.create(request.body);
      return reply.code(201).send(created);
    } catch (error) {
      return handleAppError(error, reply);
    }
  });

  app.post('/api/apps/import', async (request, reply) => {
    try {
      return await appsService.importApps(request.body);
    } catch (error) {
      return handleAppError(error, reply);
    }
  });

  app.patch('/api/apps/reorder', async (request, reply) => {
    try {
      return await appsService.reorder(request.body);
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

    return { ok: true, proxySync: result.proxySync };
  });
}
