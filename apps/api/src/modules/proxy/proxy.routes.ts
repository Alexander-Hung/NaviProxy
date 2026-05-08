import type { FastifyInstance } from 'fastify';
import type { ProxyService } from './proxy.service.js';

export async function registerProxyRoutes(
  app: FastifyInstance,
  proxyService: ProxyService
) {
  app.get('/api/proxy/config', async () => proxyService.getRenderedConfig());

  app.get('/api/proxy/history', async (request) => {
    const query = request.query as { limit?: string };
    return proxyService.listHistory(Number(query.limit ?? 20));
  });

  app.post('/api/proxy/sync', async () => proxyService.syncSafely());
}
