import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppRecord } from '../apps/apps.types.js';
import { buildCaddyConfig } from './caddy.builder.js';

const baseApp: AppRecord = {
  id: 'app-1',
  name: 'Jellyfin',
  slug: 'jellyfin',
  iconType: 'builtin',
  iconValue: null,
  targetUrl: 'http://127.0.0.1:8096',
  routeMode: 'subdomain',
  publicHost: 'jellyfin.lab.home',
  publicPath: null,
  enabled: true,
  sortOrder: 0,
  category: 'Media',
  tags: ['video'],
  favorite: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

test('builds http-only caddy config by default', () => {
  const config = buildCaddyConfig([baseApp], ':80', 'http://127.0.0.1:3001');
  const server = config.apps.http.servers.naviproxy;

  assert.deepEqual(server.listen, [':80']);
  assert.equal(server.routes.length, 2);
});

test('adds tls server policy for internal CA mode', () => {
  const config = buildCaddyConfig(
    [baseApp],
    ':80',
    'http://127.0.0.1:3001',
    'internal_ca'
  );

  assert.deepEqual(config.apps.http.servers.naviproxy.listen, [':80', ':443']);
  assert.equal(
    (config as { apps: { tls: { automation: { policies: Array<{ issuers: Array<{ module: string }> }> } } } })
      .apps.tls.automation.policies[0].issuers[0].module,
    'internal'
  );
});
