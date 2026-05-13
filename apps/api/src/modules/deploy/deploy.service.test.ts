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
      deploy_input TEXT,
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
      deploy_input TEXT,
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
      deploy_input TEXT,
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

test('previews docker run with combined short publish flags', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      deploy_input TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_run',
    command: 'docker run -dp 8080:80 nginx:alpine',
    publicHost: 'nginx.lab.home',
    routeMode: 'subdomain'
  });

  assert.equal(plan.image, 'nginx:alpine');
  assert.equal(plan.containerPort, 80);
  assert.equal(plan.hostPort, 8080);
  assert.equal(plan.dockerArgs.includes('-dp'), false);
});

test('previews docker run host network without injecting publish flags', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      deploy_input TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_run',
    command: 'docker run --network host ghcr.io/seriousm4x/upsnap:5',
    publicHost: 'upsnap-run.lab.home',
    routeMode: 'subdomain',
    containerPort: 8090
  });

  assert.equal(plan.hostPort, 8090);
  assert.equal(plan.targetUrl, 'http://127.0.0.1:8090');
  assert.equal(plan.dockerArgs.includes('-p'), false);
  assert.match(plan.warnings.join(' '), /Host network mode detected/);
});

test('infers app name from image behind a registry port', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      deploy_input TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_run',
    command: 'docker run -p 18091:80 localhost:5000/team/app:latest',
    publicHost: 'registry-app.lab.home',
    routeMode: 'subdomain'
  });

  assert.equal(plan.containerName, 'app');
  assert.equal(plan.appPayload.name, 'app');
});

test('previews docker compose deployment with managed project metadata', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      deploy_input TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_compose',
    command: `
services:
  whoami:
    image: traefik/whoami
    ports:
      - "8089:80"
`,
    publicHost: 'whoami.lab.home',
    routeMode: 'subdomain'
  });

  assert.equal(plan.method, 'docker_compose');
  assert.equal(plan.containerName, 'whoami');
  assert.equal(plan.image, 'traefik/whoami');
  assert.equal(plan.hostPort, 8089);
  assert.equal(plan.containerPort, 80);
  assert.equal(plan.dockerArgs[0], 'compose');
  assert.equal(plan.dockerArgs.includes('up'), true);
  assert.match(plan.composeFilePath ?? '', /whoami\/compose\.yml$/);
});

test('previews docker compose deployment without ports by inferring and injecting a port', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      deploy_input TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_compose',
    command: `
services:
  web:
    image: nginx:alpine
`,
    publicHost: 'web.lab.home',
    routeMode: 'subdomain'
  });

  assert.equal(plan.method, 'docker_compose');
  assert.equal(plan.containerPort, 80);
  assert.match(plan.targetUrl, /^http:\/\/127\.0\.0\.1:18\d{3}$/);
  assert.match(plan.composeContent ?? '', /ports:\n\s+- ['"]?18\d{3}:80['"]?/);
  assert.match(plan.warnings.join(' '), /inferred container port 80/);
});

test('previews host-network compose without injecting ports', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      deploy_input TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_compose',
    command: `
services:
  upsnap:
    cap_add:
      - NET_RAW
    cap_drop:
      - ALL
    container_name: upsnap
    image: ghcr.io/seriousm4x/upsnap:5
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./data:/app/pb_data
`,
    publicHost: 'upsnap.lab.home',
    routeMode: 'subdomain'
  });

  assert.equal(plan.containerName, 'upsnap');
  assert.equal(plan.containerPort, 8090);
  assert.equal(plan.hostPort, 8090);
  assert.equal(plan.targetUrl, 'http://127.0.0.1:8090');
  assert.doesNotMatch(plan.composeContent ?? '', /ports:/);
  assert.match(plan.warnings.join(' '), /Host network mode detected/);
});

test('previews docker compose deployment with long-form ports', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      deploy_input TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_compose',
    command: `
services:
  web:
    image: nginx:alpine
    ports:
      - target: 80
        published: 18090
`,
    publicHost: 'long-form.lab.home',
    routeMode: 'subdomain'
  });

  assert.equal(plan.hostPort, 18090);
  assert.equal(plan.containerPort, 80);
  assert.equal(plan.targetUrl, 'http://127.0.0.1:18090');
});

test('previews docker compose with structured YAML ports, expose, and bind mounts', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      deploy_input TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_compose',
    command: `
services:
  web:
    container_name: registry-web
    image: localhost:5000/team/web:latest
    ports:
      - published: "18100"
        target: "3000"
        protocol: tcp
    volumes:
      - type: bind
        source: ./data
        target: /app/data
  worker:
    image: redis:7
    expose:
      - "6379"
`,
    publicHost: 'registry-web.lab.home',
    routeMode: 'subdomain'
  });

  assert.equal(plan.containerName, 'registry-web');
  assert.equal(plan.image, 'localhost:5000/team/web:latest');
  assert.equal(plan.hostPort, 18100);
  assert.equal(plan.containerPort, 3000);
  assert.equal(plan.hostMounts[0].source, './data');
  assert.match(plan.hostMounts[0].baseDir ?? '', /registry-web$/);
});

test('selects the web service from a multi-service compose file', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      deploy_input TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const plan = await deployService.preview({
    method: 'docker_compose',
    command: `
services:
  db:
    image: postgres:16
    ports:
      - "15432:5432"
  web:
    image: ghcr.io/example/project-web:latest
    ports:
      - "18088:3000"
`,
    publicHost: 'project.lab.home',
    routeMode: 'subdomain'
  });

  assert.equal(plan.containerName, 'web');
  assert.equal(plan.image, 'ghcr.io/example/project-web:latest');
  assert.equal(plan.hostPort, 18088);
  assert.equal(plan.containerPort, 3000);
  assert.equal(plan.targetUrl, 'http://127.0.0.1:18088');
  assert.match(plan.composeContent ?? '', /18088:3000/);
});

test('reports compose host permission requirements across services', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deployment_records (
      app_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      deploy_input TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const deployService = new DeployService(db, appsService);
  const doctor = await deployService.doctor({
    method: 'docker_compose',
    command: `
services:
  scanner:
    image: ghcr.io/example/scanner:latest
    privileged: true
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
  web:
    image: nginx:alpine
    ports:
      - "18092:80"
`,
    publicHost: 'scanner.lab.home',
    routeMode: 'subdomain'
  });
  const requirementIds = doctor.requirements.map((requirement) => requirement.id);

  assert.equal(requirementIds.includes('compose-privileged'), true);
  assert.equal(requirementIds.includes('compose-capabilities'), true);
  assert.equal(requirementIds.includes('compose-devices'), true);
});
