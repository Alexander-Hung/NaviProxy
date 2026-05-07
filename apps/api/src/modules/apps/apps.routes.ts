import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { AppsService } from './apps.service.js';

export async function registerAppsRoutes(
  app: FastifyInstance,
  appsService: AppsService
) {
  app.get('/api/health', async () => ({
    ok: true,
    name: 'NaviProxy'
  }));

  app.get('/api/apps', async () => appsService.list());

  app.post('/api/apps', async (request, reply) => {
    try {
      const created = await appsService.create(request.body);
      return reply.code(201).send(created);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ message: 'Invalid app input', issues: error.issues });
      }

      throw error;
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
      if (error instanceof ZodError) {
        return reply.code(400).send({ message: 'Invalid app input', issues: error.issues });
      }

      throw error;
    }
  });

  app.delete('/api/apps/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await appsService.delete(id);

    if (!deleted) {
      return reply.code(404).send({ message: 'App not found' });
    }

    return { ok: true };
  });
}
