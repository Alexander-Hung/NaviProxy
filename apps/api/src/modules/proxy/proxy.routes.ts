import type { FastifyInstance } from 'fastify';
import type { ProxyService } from './proxy.service.js';

export async function registerProxyRoutes(
  app: FastifyInstance,
  proxyService: ProxyService
) {
  app.get('/api/proxy/config', async () => proxyService.getRenderedConfig());

  app.post('/api/proxy/sync', async () => proxyService.sync());
}
