import type { FastifyInstance } from 'fastify';
import type { AuditService } from './audit.service.js';

export async function registerAuditRoutes(
  app: FastifyInstance,
  auditService: AuditService
) {
  app.get('/api/audit', async (request) => {
    const { limit } = request.query as { limit?: string };
    return auditService.list(Number(limit ?? 50));
  });
}
