import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
import http from 'node:http';
import os from 'node:os';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';

const execFileAsync = promisify(execFile);

type LocalService = {
  address: string;
  port: number;
  pid: number | null;
  processName: string | null;
  targetUrl: string;
};

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal && entry.family === 'IPv4')
    .map((entry) => entry.address);
}

function targetHost(address: string) {
  if (address === '*' || address === '0.0.0.0' || address === '::') {
    return '127.0.0.1';
  }

  if (address.startsWith('[') && address.endsWith(']')) {
    return address.slice(1, -1);
  }

  return address;
}

function targetUrl(address: string, port: number) {
  const host = targetHost(address);
  const formattedHost = host.includes(':') ? `[${host}]` : host;

  return `http://${formattedHost}:${port}`;
}

function normalizeAddress(value: string) {
  if (value.startsWith('[')) {
    const closing = value.indexOf(']');
    return closing >= 0 ? value.slice(1, closing) : value;
  }

  const lastColon = value.lastIndexOf(':');
  return lastColon >= 0 ? value.slice(0, lastColon) : value;
}

export function parseAddressPort(name: string) {
  const value = name.replace(/^TCP\s+/, '').replace(/\s+\(LISTEN\)$/, '');
  const lastColon = value.lastIndexOf(':');

  if (lastColon < 0) {
    return null;
  }

  const port = Number(value.slice(lastColon + 1));

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }

  return {
    address: normalizeAddress(value),
    port
  };
}

function serviceKey(service: LocalService) {
  return `${service.address}:${service.port}:${service.pid ?? ''}:${service.processName ?? ''}`;
}

async function scanWithLsof() {
  const { stdout } = await execFileAsync('lsof', [
    '-nP',
    '-iTCP',
    '-sTCP:LISTEN',
    '-F',
    'pcn'
  ]);
  const services: LocalService[] = [];
  let current: { pid: number | null; processName: string | null } = {
    pid: null,
    processName: null
  };

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const type = line[0];
    const value = line.slice(1);

    if (type === 'p') {
      current = {
        pid: Number(value) || null,
        processName: null
      };
      continue;
    }

    if (type === 'c') {
      current = {
        ...current,
        processName: value || null
      };
      continue;
    }

    if (type !== 'n') {
      continue;
    }

    const parsed = parseAddressPort(value);

    if (!parsed) {
      continue;
    }

    services.push({
      ...parsed,
      pid: current.pid,
      processName: current.processName,
      targetUrl: targetUrl(parsed.address, parsed.port)
    });
  }

  return services;
}

async function scanWithSs() {
  const { stdout } = await execFileAsync('ss', ['-ltnpH']);
  const services: LocalService[] = [];

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const parts = line.split(/\s+/);
    const localAddress = parts[3] ?? parts[2];
    const parsed = parseAddressPort(localAddress);

    if (!parsed) {
      continue;
    }

    const processMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);

    services.push({
      ...parsed,
      pid: processMatch ? Number(processMatch[2]) : null,
      processName: processMatch?.[1] ?? null,
      targetUrl: targetUrl(parsed.address, parsed.port)
    });
  }

  return services;
}

function dockerSocketPaths(): string[] {
  const paths = ['/var/run/docker.sock'];

  if (os.platform() === 'darwin') {
    paths.push(`${os.homedir()}/.docker/run/docker.sock`);
  }

  return paths;
}

async function fetchDockerJson(socketPath: string, apiPath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath, path: apiPath, method: 'GET', headers: { Host: 'localhost' } },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`Docker API ${res.statusCode}`));
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Docker socket timeout')));
    req.end();
  });
}

type DockerPort = { IP: string; PrivatePort: number; PublicPort?: number; Type: string };
type DockerContainer = { Names: string[]; Ports: DockerPort[]; State: string };

async function scanWithDocker(): Promise<LocalService[]> {
  for (const socketPath of dockerSocketPaths()) {
    try {
      const containers = await fetchDockerJson(socketPath, '/containers/json') as DockerContainer[];
      const services: LocalService[] = [];

      for (const container of containers) {
        if (container.State !== 'running') {
          continue;
        }

        const name = (container.Names?.[0] ?? '').replace(/^\//, '');

        for (const port of container.Ports ?? []) {
          if (port.Type !== 'tcp' || !port.PublicPort) {
            continue;
          }

          const address = port.IP === '' ? '0.0.0.0' : port.IP;

          services.push({
            address,
            port: port.PublicPort,
            pid: null,
            processName: name,
            targetUrl: targetUrl(address, port.PublicPort)
          });
        }
      }

      return services;
    } catch {
      // try next socket path
    }
  }

  return [];
}

async function scanLocalServices() {
  const [systemServices, dockerServices] = await Promise.all([
    (async () => {
      try {
        return await scanWithLsof();
      } catch {
        return await scanWithSs();
      }
    })(),
    scanWithDocker()
  ]);

  // Docker container names are more useful than "docker-proxy" — replace where ports match
  const dockerByPort = new Map<number, string>();
  for (const service of dockerServices) {
    if (!dockerByPort.has(service.port)) {
      dockerByPort.set(service.port, service.processName ?? '');
    }
  }

  const enhanced = systemServices.map((service) => {
    const containerName = dockerByPort.get(service.port);
    return containerName ? { ...service, processName: containerName } : service;
  });

  // Add Docker services that the system scan missed (userland-proxy disabled)
  const systemPorts = new Set(systemServices.map((s) => s.port));
  const dockerOnly = dockerServices.filter((s) => !systemPorts.has(s.port));

  const unique = new Map<string, LocalService>();

  for (const service of [...enhanced, ...dockerOnly]) {
    unique.set(serviceKey(service), service);
  }

  return [...unique.values()].sort((left, right) => {
    if (left.port !== right.port) {
      return left.port - right.port;
    }

    return (left.processName ?? '').localeCompare(right.processName ?? '');
  });
}

export async function registerDiagnosticsRoutes(app: FastifyInstance) {
  app.get('/api/diagnostics/dns', async (request, reply) => {
    const { host } = request.query as { host?: string };

    if (!host) {
      return reply.code(400).send({ message: 'Host is required' });
    }

    try {
      const records = await dns.lookup(host, { all: true });
      const locals = localAddresses();
      const addresses = records.map((record) => record.address);

      return {
        host,
        addresses,
        localAddresses: locals,
        matchesLocalAddress: addresses.some((address) => locals.includes(address))
      };
    } catch (error) {
      return reply.code(422).send({
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/diagnostics/local-services', async (_request, reply) => {
    try {
      return {
        scannedAt: new Date().toISOString(),
        services: await scanLocalServices()
      };
    } catch (error) {
      return reply.code(503).send({
        message:
          error instanceof Error
            ? error.message
            : 'Unable to scan local listening ports'
      });
    }
  });
}
