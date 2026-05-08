import { AlertTriangle } from 'lucide-react';

export function RouteModeWarning() {
  return (
    <div className="flex gap-3 rounded border border-amber/30 bg-amber/10 p-3 text-sm text-[#6f4a08] dark:border-amber/35 dark:bg-amber/15 dark:text-[#ffe0a0]">
      <AlertTriangle className="mt-0.5 shrink-0" size={18} />
      <p>
        Subpath mode may break target app assets, redirects, cookie paths,
        WebSocket endpoints, or OAuth callbacks. Subdomain mode is recommended
        for most homelab services.
      </p>
    </div>
  );
}
