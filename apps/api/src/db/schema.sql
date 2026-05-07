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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_apps_enabled ON apps(enabled);
CREATE INDEX IF NOT EXISTS idx_apps_public_host ON apps(public_host);
CREATE INDEX IF NOT EXISTS idx_apps_route_mode ON apps(route_mode);

CREATE TABLE IF NOT EXISTS proxy_config_versions (
  id TEXT PRIMARY KEY,
  caddy_config_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
