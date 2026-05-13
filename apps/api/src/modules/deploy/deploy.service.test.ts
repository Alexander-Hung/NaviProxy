import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { AppsService } from '../apps/apps.service.js';
import { DeployService } from './deploy.service.js';

const appsService = {
  validateCreate(input: unknown) {
    return input;
  }
} as unknown as AppsService;

test('previews docker run deployment with an allocated host port', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_run',
    command: 'docker run --rm --name test-app -p 3001 louislam/uptime-kuma:1',
    publicHost: 'uptime.lab.home',
    routeMode: 'subdomain',
    tags: ['docker']
  });

  assert.equal(plan.containerName, 'test-app');
  assert.equal(plan.image, 'louislam/uptime-kuma:1');
  assert.equal(plan.containerPort, 3001);
  assert.match(plan.targetUrl, /^http:\/\/127\.0\.0\.1:18\d{3}$/);
  assert.deepEqual(plan.appPayload.tags, ['docker']);
  assert.equal(plan.appPayload.publicHost, 'uptime.lab.home');
  assert.equal(plan.dockerArgs[0], 'run');
  assert.equal(plan.dockerArgs[1], '-d');
  assert.equal(plan.dockerArgs.includes('--rm'), false);
  assert.equal(plan.dockerArgs.includes('-p'), true);
});

test('previews bind mounts that will be prepared before deploy', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_run',
    command:
      'docker run --name mount-check -p 8088:80 -v ./data:/data --mount type=bind,source=~/cfg,target=/cfg nginx:alpine',
    publicHost: 'mount.lab.home',
    routeMode: 'subdomain'
  });

  assert.equal(plan.hostMounts.length, 2);
  assert.deepEqual(plan.hostMounts[0], { source: './data', target: '/data' });
  assert.deepEqual(plan.hostMounts[1], { source: '~/cfg', target: '/cfg' });
  assert.match(
    plan.warnings.join(' '),
    /Bind mount paths will be created and checked/
  );
});

test('parses Windows-style docker bind mounts', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_run',
    command:
      'docker run --name windows-mount -p 8089:80 -v C:\\Users\\alex\\app-data:/data --mount type=bind,source=D:\\configs,target=/cfg nginx:alpine',
    publicHost: 'windows-mount.lab.home',
    routeMode: 'subdomain'
  });

  assert.equal(plan.hostMounts.length, 2);
  assert.deepEqual(plan.hostMounts[0], {
    source: 'C:\\Users\\alex\\app-data',
    target: '/data'
  });
  assert.deepEqual(plan.hostMounts[1], {
    source: 'D:\\configs',
    target: '/cfg'
  });
});
