import { ExternalLink, Globe2, Pencil, Route, Trash2 } from 'lucide-react';
import type { NaviApp } from '../lib/api';

type Props = {
  app: NaviApp;
  onEdit?: (app: NaviApp) => void;
  onDelete?: (id: string) => void;
};

function appHref(app: NaviApp) {
  const host = app.publicHost;
  const path = app.routeMode === 'subpath' ? app.publicPath ?? '' : '';
  return `http://${host}${path}`;
}

function Icon({ app }: { app: NaviApp }) {
  if (app.iconType === 'emoji' && app.iconValue) {
    return <span className="text-2xl">{app.iconValue}</span>;
  }

  if (app.iconType === 'url' && app.iconValue) {
    return (
      <img
        src={app.iconValue}
        alt=""
        className="h-8 w-8 rounded object-cover"
        loading="lazy"
      />
    );
  }

  return <Globe2 size={24} />;
}

export function AppCard({ app, onEdit, onDelete }: Props) {
  const href = appHref(app);

  return (
    <article className="panel group flex min-h-[164px] flex-col justify-between p-4 transition hover:-translate-y-0.5 hover:shadow-soft dark:hover:border-[#8fe0ce]/25">
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded bg-[#e8f3ef] text-spruce dark:bg-[#203c36] dark:text-[#9be8d7]">
          <Icon app={app} />
        </div>
        {onEdit || onDelete ? (
          <div className="flex gap-1">
            {onEdit ? (
              <button
                className="grid h-9 w-9 place-items-center rounded text-black/45 transition hover:bg-spruce/10 hover:text-spruce dark:text-[#a9bbb4] dark:hover:bg-[#8fe0ce]/10 dark:hover:text-[#9be8d7]"
                onClick={() => onEdit(app)}
                title="Edit app"
                aria-label="Edit app"
              >
                <Pencil size={17} />
              </button>
            ) : null}
            {onDelete ? (
              <button
                className="grid h-9 w-9 place-items-center rounded text-black/45 transition hover:bg-coral/10 hover:text-coral dark:text-[#a9bbb4] dark:hover:bg-coral/15 dark:hover:text-[#ff9b8c]"
                onClick={() => onDelete(app.id)}
                title="Delete app"
                aria-label="Delete app"
              >
                <Trash2 size={17} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div>
        <h2 className="mt-4 truncate text-lg font-semibold">{app.name}</h2>
        <div className="mt-2 flex items-center gap-2 text-xs text-black/55 dark:text-[#b8c7c1]">
          <Route size={14} />
          <span className="truncate">
            {app.routeMode === 'subdomain'
              ? app.publicHost
              : `${app.publicHost}${app.publicPath}`}
          </span>
        </div>
        <div className="mt-1 truncate text-xs text-black/45 dark:text-[#9fb0aa]">
          {app.targetUrl}
        </div>
      </div>

      <a
        className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded bg-ink px-3 text-sm font-semibold text-white transition hover:bg-spruce dark:bg-[#dff3ec] dark:text-[#0f1714] dark:hover:bg-[#9be8d7]"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        Open
        <ExternalLink size={15} />
      </a>
    </article>
  );
}
