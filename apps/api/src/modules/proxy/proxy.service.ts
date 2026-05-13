import crypto from 'node:crypto';
import net from 'node:net';
import { nanoid } from 'nanoid';
import type { ContainersDatabase } from '../../db/database.js';
import { config } from '../../config.js';
import type { AppsRepo } from '../apps/apps.repo.js';
import { buildCaddyConfig } from './caddy.builder.js';
import { CaddyClient } from './caddy.client.js';
import type { SettingsService } from '../settings/settings.service.js';

export class ProxyService {
  private readonly caddy = new CaddyClient(config.caddyAdminUrl);

  constructor(
    private readonly db: ContainersDatabase,
    private readonly appsRepo: AppsRepo,
    private readonly settingsService: SettingsService
  ) {}

  async sync() {
    const apps = this.appsRepo.findEnabled();
    const caddyConfig = buildCaddyConfig(
      apps,
      config.caddyListen,
      config.dashboardTargetUrl,
      this.settingsService.getAll().tlsMode
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
      config.dashboardTargetUrl,
      this.settingsService.getAll().tlsMode
    );
  }

  async getDiagnostics() {
    const settings = this.settingsService.getAll();
    const port443 = await checkPortAvailable(443);

    return {
      tlsMode: settings.tlsMode,
      caddyListen: [config.caddyListen],
      port443: {
        available: port443.available,
        error: port443.message
      },
      renderedConfig: this.getRenderedConfig(),
      warnings: [
        ...(settings.tlsMode === 'http'
          ? []
          : port443.available
            ? []
            : [`Port 443 is not available: ${port443.message}`]),
        ...(settings.tlsMode === 'internal_ca'
          ? ['Internal CA certificates must be trusted by client devices.']
          : [])
      ]
    };
  }

  listHistory(limit = 20) {
    const normalizedLimit = Number.isFinite(limit)
      ? Math.min(Math.max(limit, 1), 100)
      : 20;

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
      .all(normalizedLimit);
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

function checkPortAvailable(port: number) {
  return new Promise<{ available: boolean; message: string | null }>((resolve) => {
    const server = net.createServer();

    server.once('error', (error) => {
      resolve({
        available: false,
        message: error.message
      });
    });

    server.once('listening', () => {
      server.close(() =>
        resolve({
          available: true,
          message: null
        })
      );
    });

    server.listen(port, '0.0.0.0');
  });
}
