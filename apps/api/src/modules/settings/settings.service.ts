import type { NaviDatabase } from '../../db/database.js';

export type TlsMode = 'http' | 'auto_https' | 'internal_ca';

export type NaviSettings = {
  tlsMode: TlsMode;
  dashboardAuthRequired: boolean;
  healthCheckIntervalSeconds: number;
};

const defaults: NaviSettings = {
  tlsMode: 'http',
  dashboardAuthRequired: false,
  healthCheckIntervalSeconds: 0
};

function isTlsMode(value: unknown): value is TlsMode {
  return value === 'http' || value === 'auto_https' || value === 'internal_ca';
}

export class SettingsService {
  constructor(private readonly db: NaviDatabase) {}

  getAll(): NaviSettings {
    const rows = this.db
      .prepare('SELECT key, value FROM app_settings')
      .all() as Array<{ key: string; value: string }>;
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const tlsMode = values.get('tlsMode');
    const dashboardAuthRequired = values.get('dashboardAuthRequired');
    const healthCheckIntervalSeconds = Number(
      values.get('healthCheckIntervalSeconds') ?? defaults.healthCheckIntervalSeconds
    );

    return {
      tlsMode: isTlsMode(tlsMode) ? tlsMode : defaults.tlsMode,
      dashboardAuthRequired:
        dashboardAuthRequired === undefined
          ? defaults.dashboardAuthRequired
          : dashboardAuthRequired === 'true',
      healthCheckIntervalSeconds: Number.isFinite(healthCheckIntervalSeconds)
        ? Math.min(Math.max(Math.round(healthCheckIntervalSeconds), 0), 86400)
        : defaults.healthCheckIntervalSeconds
    };
  }

  update(input: unknown, options: { adminTokenConfigured?: boolean } = {}) {
    const current = this.getAll();
    const patch = input && typeof input === 'object' ? input : {};
    const next: NaviSettings = {
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
          : current.healthCheckIntervalSeconds
    };

    if (next.dashboardAuthRequired && !options.adminTokenConfigured) {
      throw new Error('ADMIN_TOKEN must be configured before requiring dashboard auth.');
    }
    const upsert = this.db.prepare(
      `INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP`
    );

    this.db.transaction(() => {
      upsert.run('tlsMode', next.tlsMode);
      upsert.run('dashboardAuthRequired', String(next.dashboardAuthRequired));
      upsert.run(
        'healthCheckIntervalSeconds',
        String(next.healthCheckIntervalSeconds)
      );
    })();

    return next;
  }
}
