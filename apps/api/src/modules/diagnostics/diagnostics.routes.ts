import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
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

async function scanLocalServices() {
  let services: LocalService[];

  try {
    services = await scanWithLsof();
  } catch {
    services = await scanWithSs();
  }

  const unique = new Map<string, LocalService>();

  for (const service of services) {
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
