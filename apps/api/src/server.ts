import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { registerAdminAuth } from './auth.js';
import { config } from './config.js';
import { createDatabase } from './db/database.js';
import { registerAuditRoutes } from './modules/audit/audit.routes.js';
import { AuditService } from './modules/audit/audit.service.js';
import { registerBackupRoutes } from './modules/backup/backup.routes.js';
import { registerDiagnosticsRoutes } from './modules/diagnostics/diagnostics.routes.js';
import { AppsRepo } from './modules/apps/apps.repo.js';
import { AppsService } from './modules/apps/apps.service.js';
import { registerAppsRoutes } from './modules/apps/apps.routes.js';
import { ProxyService } from './modules/proxy/proxy.service.js';
import { registerProxyRoutes } from './modules/proxy/proxy.routes.js';
import { registerSettingsRoutes } from './modules/settings/settings.routes.js';
import { SettingsService } from './modules/settings/settings.service.js';
import { startHealthScheduler } from './modules/health/health.scheduler.js';

const app = Fastify({
  logger: true
});

const db = createDatabase();
const appsRepo = new AppsRepo(db);
const auditService = new AuditService(db);
const settingsService = new SettingsService(db);
const proxyService = new ProxyService(db, appsRepo, settingsService);
const appsService = new AppsService(db, proxyService);

app.addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (_request, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';

    if (!raw) {
      done(null, undefined);
      return;
    }

    try {
      done(null, JSON.parse(raw));
    } catch (error) {
      done(error as Error, undefined);
    }
  }
);

await app.register(cors, {
  origin: config.corsOrigin
});

registerAdminAuth(app, {
  dashboardAuthRequired: () =>
    config.dashboardAuthRequired || settingsService.getAll().dashboardAuthRequired
});

await registerAppsRoutes(app, appsService, auditService);
await registerProxyRoutes(app, proxyService, auditService);
await registerDiagnosticsRoutes(app);
await registerSettingsRoutes(app, settingsService, auditService);
await registerBackupRoutes(app, appsService, settingsService, auditService);
await registerAuditRoutes(app, auditService);
startHealthScheduler(appsService, settingsService, auditService);

const indexPath = path.join(config.webDistPath, 'index.html');
const faviconPath = path.join(config.webDistPath, 'favicon.ico');

if (fs.existsSync(indexPath)) {
  await app.register(fastifyStatic, {
    root: path.join(config.webDistPath, 'assets'),
    prefix: '/assets/'
  });

  if (fs.existsSync(faviconPath)) {
    app.get('/favicon.ico', async (_request, reply) => {
      return reply.type('image/x-icon').send(fs.createReadStream(faviconPath));
    });
  }

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
