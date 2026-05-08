import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import type { NaviDatabase } from '../../db/database.js';
import { config } from '../../config.js';
import type { AppsRepo } from '../apps/apps.repo.js';
import { buildCaddyConfig } from './caddy.builder.js';
import { CaddyClient } from './caddy.client.js';

export class ProxyService {
  private readonly caddy = new CaddyClient(config.caddyAdminUrl);

  constructor(
    private readonly db: NaviDatabase,
    private readonly appsRepo: AppsRepo
  ) {}

  async sync() {
    const apps = this.appsRepo.findEnabled();
    const caddyConfig = buildCaddyConfig(
      apps,
      config.caddyListen,
      config.dashboardTargetUrl
    );
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(caddyConfig))
      .digest('hex');

    if (!config.caddySyncEnabled) {
      this.recordVersion(hash, 'skipped', 'Caddy sync disabled');
      return { status: 'skipped' as const, hash, config: caddyConfig };
    }

    try {
      await this.caddy.loadConfig(caddyConfig);
      this.recordVersion(hash, 'success', null);
      return { status: 'success' as const, hash, config: caddyConfig };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordVersion(hash, 'failed', message);
      throw error;
    }
  }

  async syncSafely() {
    try {
      return await this.sync();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        status: 'failed' as const,
        hash: null,
        errorMessage: message
      };
    }
  }

  getRenderedConfig() {
    return buildCaddyConfig(
      this.appsRepo.findEnabled(),
      config.caddyListen,
      config.dashboardTargetUrl
    );
  }

  listHistory(limit = 20) {
    return this.db
      .prepare(
        `SELECT
          id,
          caddy_config_hash AS caddyConfigHash,
          status,
          error_message AS errorMessage,
          created_at AS createdAt
        FROM proxy_config_versions
        ORDER BY created_at DESC
        LIMIT ?`
      )
      .all(Math.min(Math.max(limit, 1), 100));
  }

  private recordVersion(
    hash: string,
    status: 'success' | 'failed' | 'skipped',
    errorMessage: string | null
  ) {
    this.db
      .prepare(
        `INSERT INTO proxy_config_versions (
          id, caddy_config_hash, status, error_message
        ) VALUES (?, ?, ?, ?)`
      )
      .run(nanoid(), hash, status, errorMessage);
  }
}
