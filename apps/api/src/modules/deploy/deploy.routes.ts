import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
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

  app.get('/api/deployments/:appId', async (request, reply) => {
    try {
      const { appId } = request.params as { appId: string };
      const deployment = await deployService.managedDeploymentStatus(appId);

      if (!deployment) {
        return reply.code(404).send({ message: 'Managed deployment not found' });
      }

      return deployment;
    } catch (error) {
      return handleDeployError(error, reply);
    }
  });

  app.get('/api/deployments/:appId/logs', async (request, reply) => {
    try {
      const { appId } = request.params as { appId: string };
      const { tail } = z.object({
        tail: z.coerce.number().int().min(20).max(1000).default(200)
      }).parse(request.query);
      const logs = await deployService.deploymentLogs(appId, tail);

      if (!logs) {
        return reply.code(404).send({ message: 'Managed deployment not found' });
      }

      auditService.record({
        action: 'deploy.logs',
        targetType: 'app',
        targetId: appId,
        summary: `Viewed logs for ${logs.resourceName}`,
        sourceIp: request.ip
      });

      return logs;
    } catch (error) {
      return handleDeployError(error, reply);
    }
  });

  app.get('/api/deployments/:appId/redeploy-preview', async (request, reply) => {
    try {
      const { appId } = request.params as { appId: string };
      const preview = await deployService.redeployPreview(appId);

      if (!preview) {
        return reply.code(404).send({ message: 'Managed deployment not found' });
      }

      return preview;
    } catch (error) {
      return handleDeployError(error, reply);
    }
  });

  app.get('/api/deployments/:appId/drift', async (request, reply) => {
    try {
      const { appId } = request.params as { appId: string };
      const drift = await deployService.deploymentDrift(appId);

      if (!drift) {
        return reply.code(404).send({ message: 'Managed deployment not found' });
      }

      return drift;
    } catch (error) {
      return handleDeployError(error, reply);
    }
  });

  app.post('/api/deployments/:appId/drift/repair', async (request, reply) => {
    try {
      const { appId } = request.params as { appId: string };
      const { action } = z.object({
        action: z.enum(['start', 'redeploy', 'update_target_from_runtime'])
      }).parse(request.body);
      const result = await deployService.repairDeploymentDrift(appId, action);

      if (!result) {
        return reply.code(404).send({ message: 'Managed deployment not found' });
      }

      auditService.record({
        action: `deploy.repair.${action}`,
        targetType: 'app',
        targetId: appId,
        summary: `Repaired deployment drift with ${action}`,
        sourceIp: request.ip
      });

      return result;
    } catch (error) {
      return handleDeployError(error, reply);
    }
  });

  app.post('/api/deployments/:appId/action', async (request, reply) => {
    try {
      const { appId } = request.params as { appId: string };
      const { action } = z.object({
        action: z.enum(['start', 'stop', 'restart', 'pull', 'redeploy'])
      }).parse(request.body);
      const deployment = await deployService.manageDeployment(appId, action);

      if (!deployment) {
        return reply.code(404).send({ message: 'Managed deployment not found' });
      }

      auditService.record({
        action: `deploy.${action}`,
        targetType: 'app',
        targetId: appId,
        summary: `${action} ${deployment.resourceName}`,
        sourceIp: request.ip
      });

      return deployment;
    } catch (error) {
      return handleDeployError(error, reply);
    }
  });
}
