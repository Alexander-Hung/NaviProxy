import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { createDatabase } from './db/database.js';
import { AppsRepo } from './modules/apps/apps.repo.js';
import { AppsService } from './modules/apps/apps.service.js';
import { registerAppsRoutes } from './modules/apps/apps.routes.js';
import { ProxyService } from './modules/proxy/proxy.service.js';
import { registerProxyRoutes } from './modules/proxy/proxy.routes.js';

const app = Fastify({
  logger: true
});

const db = createDatabase();
const appsRepo = new AppsRepo(db);
const proxyService = new ProxyService(db, appsRepo);
const appsService = new AppsService(db, proxyService);

await app.register(cors, {
  origin: true
});

await registerAppsRoutes(app, appsService);
await registerProxyRoutes(app, proxyService);

const indexPath = path.join(config.webDistPath, 'index.html');

if (fs.existsSync(indexPath)) {
  await app.register(fastifyStatic, {
    root: path.join(config.webDistPath, 'assets'),
    prefix: '/assets/'
  });

  app.get('/', async (_request, reply) => {
    return reply.type('text/html').send(fs.createReadStream(indexPath));
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ message: 'Route not found' });
    }

    return reply.type('text/html').send(fs.createReadStream(indexPath));
  });
}

await app.listen({
  host: config.host,
  port: config.port
});
