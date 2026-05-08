import { config } from '../../config.js';
import type { AppsService } from '../apps/apps.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { SettingsService } from '../settings/settings.service.js';

export function startHealthScheduler(
  appsService: AppsService,
  settingsService: SettingsService,
  auditService: AuditService
) {
  let running = false;

  function currentInterval() {
    return (
      settingsService.getAll().healthCheckIntervalSeconds ||
      config.healthCheckIntervalSeconds
    );
  }

  function scheduleNext() {
    const interval = currentInterval();
    const delay = interval > 0 ? interval * 1000 : 60_000;

    const timer = setTimeout(() => void tick(), delay);
    timer.unref?.();
  }

  async function tick() {
    const interval = currentInterval();

    if (interval <= 0 || running) {
      scheduleNext();
      return;
    }

    running = true;

    try {
      const statuses = await appsService.checkStatuses();
      const failing = statuses.filter((status) => !status.ok).length;
      auditService.record({
        action: 'health.check',
        targetType: 'apps',
        summary: `Checked ${statuses.length} apps; ${failing} failing`
      });
    } catch (error) {
      auditService.record({
        action: 'health.check_failed',
        targetType: 'apps',
        summary: error instanceof Error ? error.message : String(error)
      });
    } finally {
      running = false;
      scheduleNext();
    }
  }

  void tick();
}
