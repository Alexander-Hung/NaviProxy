import type { NaviDatabase } from '../../db/database.js';

export type DeploymentRecord = {
  appId: string;
  provider: 'docker' | 'docker_compose';
  resourceId: string;
  resourceName: string;
  createdAt: string;
};

type DeploymentRow = {
  app_id: string;
  provider: 'docker' | 'docker_compose';
  resource_id: string;
  resource_name: string;
  created_at: string;
};

function toRecord(row: DeploymentRow): DeploymentRecord {
  return {
    appId: row.app_id,
    provider: row.provider,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    createdAt: row.created_at
  };
}

export class DeploymentsRepo {
  constructor(private readonly db: NaviDatabase) {}

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
  }) {
    this.db
      .prepare(
        `INSERT INTO deployment_records (
          app_id, provider, resource_id, resource_name
        ) VALUES (
          @appId, @provider, @resourceId, @resourceName
        )`
      )
      .run(input);

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
