import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import type { AuditService } from '../audit/audit.service.js';
import { AppConflictError } from '../apps/apps.service.js';
import {
  DeployExecutionError,
  DeployInputError,
  DeployRuntimeUnavailableError,
  type DeployService
} from './deploy.service.js';

function handleDeployError(error: unknown, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.code(400).send({ message: 'Invalid deploy input', issues: error.issues });
  }

  if (error instanceof DeployInputError) {
    return reply.code(400).send({ message: error.message });
  }

  if (error instanceof DeployExecutionError) {
    return reply.code(502).send({ message: error.message });
  }

  if (error instanceof DeployRuntimeUnavailableError) {
    return reply.code(503).send({ message: error.message });
  }

  if (error instanceof AppConflictError) {
    return reply.code(409).send({ message: error.message });
  }

  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    return reply.code(503).send({
      message: 'Docker CLI was not found on this host.'
    });
  }

  throw error;
}

export async function registerDeployRoutes(
  app: FastifyInstance,
  deployService: DeployService,
  auditService: AuditService
) {
  app.get('/api/deploy/options', async () => deployService.options());

  app.get('/api/deploy/doctor', async () => deployService.doctor());

  app.post('/api/deploy/doctor', async (request) => deployService.doctor(request.body));

  app.post('/api/deploy/preview', async (request, reply) => {
    try {
      return await deployService.preview(request.body);
    } catch (error) {
      return handleDeployError(error, reply);
    }
  });

  app.post('/api/deploy/docker-run', async (request, reply) => {
    try {
      const result = await deployService.deploy(request.body);

      auditService.record({
        action: 'deploy.docker_run',
        targetType: 'app',
        targetId: result.app?.id,
        summary: `Deployed ${result.plan.containerName} from ${result.plan.image}`,
        sourceIp: request.ip
      });

      return reply.code(201).send(result);
    } catch (error) {
      return handleDeployError(error, reply);
    }
  });
}
