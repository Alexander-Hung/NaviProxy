import type { ContainersDatabase } from '../../db/database.js';

export type TlsMode = 'http' | 'auto_https' | 'internal_ca';

export type ContainerSettings = {
  tlsMode: TlsMode;
  dashboardAuthRequired: boolean;
  healthCheckIntervalSeconds: number;
  customCaddyRoutes: unknown[];
};

const defaults: ContainerSettings = {
  tlsMode: 'http',
  dashboardAuthRequired: false,
  healthCheckIntervalSeconds: 0,
  customCaddyRoutes: []
};

function isTlsMode(value: unknown): value is TlsMode {
  return value === 'http' || value === 'auto_https' || value === 'internal_ca';
}

function normalizeCustomCaddyRoutes(value: unknown): unknown[] {
  if (value === undefined) {
    return defaults.customCaddyRoutes;
  }

  const parsed =
    typeof value === 'string' && value.trim()
      ? JSON.parse(value) as unknown
      : value;

  if (!Array.isArray(parsed)) {
    throw new Error('Custom Caddy routes must be a JSON array.');
  }

  for (const route of parsed) {
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      throw new Error('Each custom Caddy route must be a JSON object.');
    }
  }

  return parsed;
}

export class SettingsService {
  constructor(private readonly db: ContainersDatabase) {}

  getAll(): ContainerSettings {
    const rows = this.db
      .prepare('SELECT key, value FROM app_settings')
      .all() as Array<{ key: string; value: string }>;
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const tlsMode = values.get('tlsMode');
    const dashboardAuthRequired = values.get('dashboardAuthRequired');
    const healthCheckIntervalSeconds = Number(
      values.get('healthCheckIntervalSeconds') ?? defaults.healthCheckIntervalSeconds
    );
    const customCaddyRoutes = values.get('customCaddyRoutes');

    return {
      tlsMode: isTlsMode(tlsMode) ? tlsMode : defaults.tlsMode,
      dashboardAuthRequired:
        dashboardAuthRequired === undefined
          ? defaults.dashboardAuthRequired
          : dashboardAuthRequired === 'true',
      healthCheckIntervalSeconds: Number.isFinite(healthCheckIntervalSeconds)
        ? Math.min(Math.max(Math.round(healthCheckIntervalSeconds), 0), 86400)
        : defaults.healthCheckIntervalSeconds,
      customCaddyRoutes: normalizeCustomCaddyRoutes(customCaddyRoutes)
    };
  }

  normalize(input: unknown, options: { adminTokenConfigured?: boolean } = {}) {
    const current = this.getAll();
    const patch = input && typeof input === 'object' ? input : {};
    const next: ContainerSettings = {
      tlsMode: isTlsMode((patch as { tlsMode?: unknown }).tlsMode)
        ? (patch as { tlsMode: TlsMode }).tlsMode
        : current.tlsMode,
      dashboardAuthRequired:
        typeof (patch as { dashboardAuthRequired?: unknown }).dashboardAuthRequired ===
        'boolean'
          ? (patch as { dashboardAuthRequired: boolean }).dashboardAuthRequired
          : current.dashboardAuthRequired,
      healthCheckIntervalSeconds:
        typeof (patch as { healthCheckIntervalSeconds?: unknown })
          .healthCheckIntervalSeconds === 'number'
          ? Math.min(
              Math.max(
                Math.round(
                  (patch as { healthCheckIntervalSeconds: number })
                    .healthCheckIntervalSeconds
                ),
                0
              ),
              86400
            )
          : current.healthCheckIntervalSeconds,
      customCaddyRoutes:
        'customCaddyRoutes' in patch
          ? normalizeCustomCaddyRoutes((patch as { customCaddyRoutes?: unknown }).customCaddyRoutes)
          : current.customCaddyRoutes
    };

    if (next.dashboardAuthRequired && !options.adminTokenConfigured) {
      throw new Error('ADMIN_TOKEN must be configured before requiring dashboard auth.');
    }

    return next;
  }

  save(next: ContainerSettings) {
    const upsert = this.db.prepare(
      `INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP`
    );

    upsert.run('tlsMode', next.tlsMode);
    upsert.run('dashboardAuthRequired', String(next.dashboardAuthRequired));
    upsert.run(
      'healthCheckIntervalSeconds',
      String(next.healthCheckIntervalSeconds)
    );
    upsert.run('customCaddyRoutes', JSON.stringify(next.customCaddyRoutes));

    return next;
  }

  update(input: unknown, options: { adminTokenConfigured?: boolean } = {}) {
    const next = this.normalize(input, options);

    this.db.transaction(() => {
      this.save(next);
    })();

    return next;
  }
}
