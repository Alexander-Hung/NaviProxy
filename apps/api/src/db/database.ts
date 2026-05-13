import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const schemaPath = new URL('./schema.sql', import.meta.url);
const migrations = [
  {
    id: '20260508_app_metadata_health_settings',
    up(db: Database.Database) {
      ensureColumn(db, 'apps', 'category', 'TEXT');
      ensureColumn(db, 'apps', 'tags', "TEXT NOT NULL DEFAULT '[]'");
      ensureColumn(db, 'apps', 'favorite', 'INTEGER NOT NULL DEFAULT 0');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_apps_category ON apps(category);
        CREATE INDEX IF NOT EXISTS idx_apps_favorite ON apps(favorite);
      `);
    }
  },
  {
    id: '20260512_deployment_records',
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS deployment_records (
          app_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL CHECK (provider IN ('docker')),
          resource_id TEXT NOT NULL,
          resource_name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_deployment_records_provider_resource
          ON deployment_records(provider, resource_name);
      `);
    }
  },
  {
    id: '20260513_deployment_records_compose_provider',
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS deployment_records_next (
          app_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL CHECK (provider IN ('docker', 'docker_compose')),
          resource_id TEXT NOT NULL,
          resource_name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
        );

        INSERT OR IGNORE INTO deployment_records_next (
          app_id, provider, resource_id, resource_name, created_at
        )
        SELECT app_id, provider, resource_id, resource_name, created_at
        FROM deployment_records;

        DROP TABLE deployment_records;
        ALTER TABLE deployment_records_next RENAME TO deployment_records;

        CREATE INDEX IF NOT EXISTS idx_deployment_records_provider_resource
          ON deployment_records(provider, resource_name);
      `);
    }
  },
  {
    id: '20260513_deployment_records_deploy_input',
    up(db: Database.Database) {
      ensureColumn(db, 'deployment_records', 'deploy_input', 'TEXT');
    }
  }
];

function columnExists(db: Database.Database, table: string, column: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;

  return rows.some((row) => row.name === column);
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateDatabase(db: Database.Database) {
  const applied = db
    .prepare('SELECT id FROM schema_migrations')
    .all() as Array<{ id: string }>;
  const appliedIds = new Set(applied.map((row) => row.id));

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.id);
    })();
  }
}

export function createDatabase() {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

  const db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  migrateDatabase(db);

  return db;
}

export type ContainersDatabase = ReturnType<typeof createDatabase>;
