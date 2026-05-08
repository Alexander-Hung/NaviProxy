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

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3001),
  adminToken: process.env.ADMIN_TOKEN ?? '',
  dashboardAuthRequired: process.env.DASHBOARD_AUTH_REQUIRED === 'true',
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  databasePath:
    process.env.DATABASE_PATH ??
    path.resolve(process.cwd(), '../../data/naviproxy.sqlite'),
  webDistPath:
    process.env.WEB_DIST_PATH ??
    path.resolve(process.cwd(), '../web/dist'),
  caddyAdminUrl: process.env.CADDY_ADMIN_URL ?? 'http://127.0.0.1:2019',
  caddySyncEnabled: process.env.CADDY_SYNC_ENABLED === 'true',
  caddyListen: process.env.CADDY_LISTEN ?? ':80',
  healthCheckIntervalSeconds: Number(process.env.HEALTH_CHECK_INTERVAL_SECONDS ?? 0),
  dashboardTargetUrl:
    process.env.NAVIPROXY_DASHBOARD_TARGET_URL ??
    `http://127.0.0.1:${Number(process.env.PORT ?? 3001)}`
};
