import { nanoid } from 'nanoid';
import type { NaviDatabase } from '../../db/database.js';

export type AuditInput = {
  action: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  sourceIp?: string | null;
};

const auditRetention = 1000;

export class AuditService {
  constructor(private readonly db: NaviDatabase) {}

  record(input: AuditInput) {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO audit_logs (
            id, action, target_type, target_id, summary, source_ip
          ) VALUES (
            @id, @action, @targetType, @targetId, @summary, @sourceIp
          )`
        )
        .run({
          id: nanoid(),
          targetId: null,
          sourceIp: null,
          ...input
        });

      this.pruneInCurrentTransaction();
    })();
  }

  list(limit = 50) {
    const normalizedLimit = Number.isFinite(limit)
      ? Math.min(Math.max(limit, 1), 200)
      : 50;

    return this.db
      .prepare(
        `SELECT
          id,
          action,
          target_type AS targetType,
          target_id AS targetId,
          summary,
          source_ip AS sourceIp,
          created_at AS createdAt
        FROM audit_logs
        ORDER BY created_at DESC
        LIMIT ?`
      )
      .all(normalizedLimit);
  }

  private pruneInCurrentTransaction() {
    this.db
      .prepare(
        `DELETE FROM audit_logs
        WHERE id IN (
          SELECT id FROM audit_logs
          ORDER BY created_at DESC
          LIMIT -1 OFFSET ?
        )`
      )
      .run(auditRetention);
  }
}
