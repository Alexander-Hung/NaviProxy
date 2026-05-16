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
import { registerDeployRoutes } from './modules/deploy/deploy.routes.js';
import { DeployService } from './modules/deploy/deploy.service.js';
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
const deployService = new DeployService(db, appsService);

function scheduleStartupProxySync(attempt = 1) {
  const maxAttempts = 12;
  const retryDelayMs = 5_000;

  void proxyService.syncSafely().then((result) => {
    if (result.status === 'success' || result.status === 'skipped') {
      auditService.record({
        action: 'proxy.startup_sync',
        targetType: 'proxy',
        summary:
          result.status === 'success'
            ? `Startup proxy sync succeeded on attempt ${attempt}`
            : 'Startup proxy sync skipped because Caddy sync is disabled'
      });
      app.log.info(
        {
          status: result.status,
          attempt
        },
        'Startup proxy sync completed'
      );
      return;
    }

    auditService.record({
      action: 'proxy.startup_sync_failed',
      targetType: 'proxy',
      summary: `Attempt ${attempt} failed: ${result.errorMessage ?? 'Unknown error'}`
    });

    if (attempt >= maxAttempts) {
      app.log.error(
        {
          attempt,
          errorMessage: result.errorMessage
        },
        'Startup proxy sync failed after all attempts'
      );
      return;
    }

    app.log.warn(
      {
        attempt,
        nextAttempt: attempt + 1,
        errorMessage: result.errorMessage
      },
      'Startup proxy sync failed; retrying'
    );

    const timer = setTimeout(
      () => scheduleStartupProxySync(attempt + 1),
      retryDelayMs
    );
    timer.unref?.();
  });
}

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

await registerAppsRoutes(app, appsService, auditService, deployService);
await registerProxyRoutes(app, proxyService, auditService);
await registerDiagnosticsRoutes(app);
await registerDeployRoutes(app, deployService, auditService);
await registerSettingsRoutes(app, settingsService, proxyService, auditService);
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

scheduleStartupProxySync();
