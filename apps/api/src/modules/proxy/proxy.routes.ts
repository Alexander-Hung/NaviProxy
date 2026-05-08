import type { FastifyInstance } from 'fastify';
import type { AuditService } from '../audit/audit.service.js';
import type { ProxyService } from './proxy.service.js';

export async function registerProxyRoutes(
  app: FastifyInstance,
  proxyService: ProxyService,
  auditService: AuditService
) {
  app.get('/api/proxy/config', async () => proxyService.getRenderedConfig());

  app.get('/api/proxy/diagnostics', async () => proxyService.getDiagnostics());

  app.get('/api/proxy/history', async (request) => {
    const query = request.query as { limit?: string };
    return proxyService.listHistory(Number(query.limit ?? 20));
  });

  app.post('/api/proxy/sync', async (request) => {
    const result = await proxyService.syncSafely();
    auditService.record({
      action: 'proxy.sync',
      targetType: 'proxy',
      summary: `Proxy sync ${result.status}`,
      sourceIp: request.ip
    });
    return result;
  });
}
