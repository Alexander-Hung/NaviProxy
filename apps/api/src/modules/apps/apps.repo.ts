import type { NaviDatabase } from '../../db/database.js';
import type { AppRecord, AppRow } from './apps.types.js';

function toRecord(row: AppRow): AppRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    iconType: row.icon_type,
    iconValue: row.icon_value,
    targetUrl: row.target_url,
    routeMode: row.route_mode,
    publicHost: row.public_host,
    publicPath: row.public_path,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class AppsRepo {
  constructor(private readonly db: NaviDatabase) {}

  findAll() {
    const rows = this.db
      .prepare(
        'SELECT * FROM apps ORDER BY sort_order ASC, created_at DESC'
      )
      .all() as AppRow[];

    return rows.map(toRecord);
  }

  findEnabled() {
    const rows = this.db
      .prepare(
        'SELECT * FROM apps WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC'
      )
      .all() as AppRow[];

    return rows.map(toRecord);
  }

  findById(id: string) {
    const row = this.db
      .prepare('SELECT * FROM apps WHERE id = ?')
      .get(id) as AppRow | undefined;

    return row ? toRecord(row) : null;
  }

  findBySlug(slug: string) {
    const row = this.db
      .prepare('SELECT * FROM apps WHERE slug = ?')
      .get(slug) as AppRow | undefined;

    return row ? toRecord(row) : null;
  }

  create(app: AppRecord) {
    this.db
      .prepare(
        `INSERT INTO apps (
          id, name, slug, icon_type, icon_value, target_url, route_mode,
          public_host, public_path, enabled, sort_order
        ) VALUES (
          @id, @name, @slug, @iconType, @iconValue, @targetUrl, @routeMode,
          @publicHost, @publicPath, @enabled, @sortOrder
        )`
      )
      .run({
        ...app,
        enabled: app.enabled ? 1 : 0
      });

    return this.findById(app.id);
  }

  update(id: string, patch: Omit<AppRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    this.db
      .prepare(
        `UPDATE apps SET
          name = @name,
          slug = @slug,
          icon_type = @iconType,
          icon_value = @iconValue,
          target_url = @targetUrl,
          route_mode = @routeMode,
          public_host = @publicHost,
          public_path = @publicPath,
          enabled = @enabled,
          sort_order = @sortOrder,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = @id`
      )
      .run({
        id,
        ...patch,
        enabled: patch.enabled ? 1 : 0
      });

    return this.findById(id);
  }

  delete(id: string) {
    return this.db.prepare('DELETE FROM apps WHERE id = ?').run(id).changes > 0;
  }

  updateSortOrder(id: string, sortOrder: number) {
    this.db
      .prepare(
        'UPDATE apps SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      )
      .run(sortOrder, id);

    return this.findById(id);
  }

  replaceAll(apps: AppRecord[]) {
    const insert = this.db.prepare(
      `INSERT INTO apps (
        id, name, slug, icon_type, icon_value, target_url, route_mode,
        public_host, public_path, enabled, sort_order, created_at, updated_at
      ) VALUES (
        @id, @name, @slug, @iconType, @iconValue, @targetUrl, @routeMode,
        @publicHost, @publicPath, @enabled, @sortOrder, @createdAt, @updatedAt
      )`
    );

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM apps').run();

      for (const app of apps) {
        insert.run({
          ...app,
          enabled: app.enabled ? 1 : 0
        });
      }
    })();

    return this.findAll();
  }
}
