import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.js';

function requestToken(request: FastifyRequest) {
  const direct =
    request.headers['x-the-containers-token'] ??
    request.headers['x-naviproxy-token'];

  if (typeof direct === 'string') {
    return direct;
  }

  const authorization = request.headers.authorization;

  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }

  return null;
}

function isPublicApi(request: FastifyRequest) {
  if (request.method !== 'GET') {
    return false;
  }

  const url = request.url.split('?')[0];

  if (config.dashboardAuthRequired) {
    return url === '/api/health';
  }

  return url === '/api/health' || url === '/api/apps';
}

function tokenMatches(candidate: string | null) {
  if (!candidate) {
    return false;
  }

  const expected = Buffer.from(config.adminToken);
  const received = Buffer.from(candidate);

  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received)
  );
}

export function registerAdminAuth(
  app: FastifyInstance,
  options: { dashboardAuthRequired?: () => boolean } = {}
) {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return;
    }

    const url = request.url.split('?')[0];
    const dashboardApiRequiresAuth =
      options.dashboardAuthRequired?.() && url === '/api/apps';

    if (!config.adminToken) {
      if (dashboardApiRequiresAuth) {
        return reply.code(503).send({
          message:
            'Dashboard auth is required, but ADMIN_TOKEN is not configured on the API.'
        });
      }

      return;
    }

    if (
      isPublicApi(request) &&
      !dashboardApiRequiresAuth
    ) {
      return;
    }

    if (tokenMatches(requestToken(request))) {
      return;
    }

    return reply.code(401).send({
      message: 'Admin token required'
    });
  });
}
