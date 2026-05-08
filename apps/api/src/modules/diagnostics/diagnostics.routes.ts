import dns from 'node:dns/promises';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal && entry.family === 'IPv4')
    .map((entry) => entry.address);
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
}
