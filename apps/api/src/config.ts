import { existsSync } from 'node:fs';
import path from 'node:path';

function parseCorsOrigin(value: string | undefined) {
  if (!value) {
    return false;
  }

  if (value === '*') {
    return true;
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length === 1 ? origins[0] : origins;
}

function defaultDatabasePath() {
  const dataDir = path.resolve(process.cwd(), '../../data');
  const legacyPath = path.join(dataDir, 'naviproxy.sqlite');

  return existsSync(legacyPath)
    ? legacyPath
    : path.join(dataDir, 'the-containers.sqlite');
}

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3001),
  adminToken: process.env.ADMIN_TOKEN ?? '',
  dashboardAuthRequired: process.env.DASHBOARD_AUTH_REQUIRED === 'true',
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  databasePath:
    process.env.DATABASE_PATH ??
    defaultDatabasePath(),
  webDistPath:
    process.env.WEB_DIST_PATH ??
    path.resolve(process.cwd(), '../web/dist'),
  caddyAdminUrl: process.env.CADDY_ADMIN_URL ?? 'http://127.0.0.1:2019',
  caddySyncEnabled: process.env.CADDY_SYNC_ENABLED === 'true',
  caddyListen: process.env.CADDY_LISTEN ?? ':80',
  dockerBin: process.env.DOCKER_BIN ?? 'docker',
  deploymentsPath:
    process.env.DEPLOYMENTS_PATH ??
    path.resolve(process.cwd(), '../../data/deployments'),
  healthCheckIntervalSeconds: Number(process.env.HEALTH_CHECK_INTERVAL_SECONDS ?? 0),
  dashboardTargetUrl:
    process.env.THE_CONTAINERS_DASHBOARD_TARGET_URL ??
    process.env.NAVIPROXY_DASHBOARD_TARGET_URL ??
    `http://127.0.0.1:${Number(process.env.PORT ?? 3001)}`
};
