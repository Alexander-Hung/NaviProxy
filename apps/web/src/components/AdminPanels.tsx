import { Activity, Clock, FileClock } from 'lucide-react';
import type { AuditLog, BackupSnapshot } from '../lib/api';

export function AuditLogPanel({ auditLogs }: { auditLogs: AuditLog[] }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Activity size={16} className="text-spruce dark:text-[#9be8d7]" />
        <h3 className="text-sm font-semibold">Audit log</h3>
      </div>
      {auditLogs.length > 0 ? (
        <div className="max-h-[300px] space-y-2 overflow-auto">
          {auditLogs.map((item) => (
            <div
              key={item.id}
              className="rounded border border-black/10 p-2 text-xs dark:border-white/15"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-black/70 dark:text-[#d7e4df]">
                  {item.action}
                </span>
                <span className="text-black/45 dark:text-[#9fb0aa]">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-1 text-black/55 dark:text-[#b8c7c1]">
                {item.summary}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-black/55 dark:text-[#b8c7c1]">
          No audit events yet.
        </div>
      )}
    </section>
  );
}

export function BackupSnapshotsPanel({
  backupSnapshots
}: {
  backupSnapshots: BackupSnapshot[];
}) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileClock size={16} className="text-spruce dark:text-[#9be8d7]" />
        <h3 className="text-sm font-semibold">Restore snapshots</h3>
      </div>
      {backupSnapshots.length > 0 ? (
        <div className="space-y-2">
          {backupSnapshots.map((snapshot) => (
            <div
              key={snapshot.id}
              className="rounded border border-black/10 p-2 text-xs dark:border-white/15"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-black/70 dark:text-[#d7e4df]">
                  {snapshot.reason}
                </span>
                <span className="text-black/45 dark:text-[#9fb0aa]">
                  {new Date(snapshot.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-black/55 dark:text-[#b8c7c1]">
                <Clock size={13} />
                {snapshot.payload.apps.length} apps saved before restore
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-black/55 dark:text-[#b8c7c1]">
          Restore creates a snapshot automatically.
        </div>
      )}
    </section>
  );
}
