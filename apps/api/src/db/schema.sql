CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon_type TEXT NOT NULL DEFAULT 'url',
  icon_value TEXT,
  target_url TEXT NOT NULL,
  route_mode TEXT NOT NULL CHECK (route_mode IN ('subdomain', 'subpath')),
  public_host TEXT NOT NULL,
  public_path TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_apps_enabled ON apps(enabled);
CREATE INDEX IF NOT EXISTS idx_apps_public_host ON apps(public_host);
CREATE INDEX IF NOT EXISTS idx_apps_route_mode ON apps(route_mode);
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deployment_records (
  app_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('docker', 'docker_compose', 'binary_service')),
  resource_id TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  deploy_input TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deployment_records_provider_resource
  ON deployment_records(provider, resource_name);

CREATE TABLE IF NOT EXISTS proxy_config_versions (
  id TEXT PRIMARY KEY,
  caddy_config_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_health_checks (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER NOT NULL,
  error TEXT,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_health_checks_app_id_checked_at
  ON app_health_checks(app_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  summary TEXT NOT NULL,
  source_ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_backup_snapshots_created_at
  ON backup_snapshots(created_at DESC);
