import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.js';

function requestToken(request: FastifyRequest) {
  const direct = request.headers['x-naviproxy-token'];

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

export function registerAdminAuth(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    if (!config.adminToken || !request.url.startsWith('/api/')) {
      return;
    }

    if (isPublicApi(request)) {
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
