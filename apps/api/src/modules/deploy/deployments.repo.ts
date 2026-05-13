import type { ContainersDatabase } from '../../db/database.js';

export type DeploymentRecord = {
  appId: string;
  provider: 'docker' | 'docker_compose';
  resourceId: string;
  resourceName: string;
  deployInput: unknown | null;
  createdAt: string;
};

type DeploymentRow = {
  app_id: string;
  provider: 'docker' | 'docker_compose';
  resource_id: string;
  resource_name: string;
  deploy_input: string | null;
  created_at: string;
};

function parseDeployInput(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function toRecord(row: DeploymentRow): DeploymentRecord {
  return {
    appId: row.app_id,
    provider: row.provider,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    deployInput: parseDeployInput(row.deploy_input),
    createdAt: row.created_at
  };
}

export class DeploymentsRepo {
  constructor(private readonly db: ContainersDatabase) {}

  findByAppId(appId: string) {
    const row = this.db
      .prepare('SELECT * FROM deployment_records WHERE app_id = ?')
      .get(appId) as DeploymentRow | undefined;

    return row ? toRecord(row) : null;
  }

  create(input: {
    appId: string;
    provider: 'docker' | 'docker_compose';
    resourceId: string;
    resourceName: string;
    deployInput?: unknown;
  }) {
    this.db
      .prepare(
        `INSERT INTO deployment_records (
          app_id, provider, resource_id, resource_name, deploy_input
        ) VALUES (
          @appId, @provider, @resourceId, @resourceName, @deployInput
        )`
      )
      .run({
        ...input,
        deployInput: input.deployInput ? JSON.stringify(input.deployInput) : null
      });

    return this.findByAppId(input.appId);
  }

  updateRuntime(input: {
    appId: string;
    resourceId: string;
    resourceName: string;
    deployInput?: unknown;
  }) {
    this.db
      .prepare(
        `UPDATE deployment_records
        SET resource_id = @resourceId,
          resource_name = @resourceName,
          deploy_input = COALESCE(@deployInput, deploy_input)
        WHERE app_id = @appId`
      )
      .run({
        ...input,
        deployInput: input.deployInput ? JSON.stringify(input.deployInput) : null
      });

    return this.findByAppId(input.appId);
  }

  delete(appId: string) {
    return (
      this.db
        .prepare('DELETE FROM deployment_records WHERE app_id = ?')
        .run(appId).changes > 0
    );
  }
}
