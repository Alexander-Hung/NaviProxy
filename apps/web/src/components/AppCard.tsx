import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Info,
  Pencil,
  Route,
  Trash2,
  XCircle
} from 'lucide-react';
import type { AppStatus, NaviApp } from '../lib/api';

type Props = {
  app: NaviApp;
  status?: AppStatus;
  onEdit?: (app: NaviApp) => void;
  onDelete?: (app: NaviApp) => void;
  onDetails?: (app: NaviApp) => void;
  onMoveUp?: (app: NaviApp) => void;
  onMoveDown?: (app: NaviApp) => void;
};

function appHref(app: NaviApp) {
  const host = app.publicHost;
  const path = app.routeMode === 'subpath' ? app.publicPath ?? '' : '';
  const scheme = window.location.protocol === 'https:' ? 'https' : 'http';

  return `${scheme}://${host}${path}`;
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

export function AppCard({
  app,
  status,
  onEdit,
  onDelete,
  onDetails,
  onMoveUp,
  onMoveDown
}: Props) {
  const href = appHref(app);

  return (
    <article className="panel group flex min-h-[164px] flex-col justify-between p-4 transition hover:-translate-y-0.5 hover:shadow-soft dark:hover:border-[#8fe0ce]/25">
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded bg-[#e8f3ef] text-spruce dark:bg-[#203c36] dark:text-[#9be8d7]">
          <Icon app={app} />
        </div>
        {onEdit || onDelete || onDetails || onMoveUp || onMoveDown ? (
          <div className="flex flex-wrap justify-end gap-1">
            {onMoveUp ? (
              <button
                className="grid h-9 w-9 place-items-center rounded text-black/45 transition hover:bg-spruce/10 hover:text-spruce dark:text-[#a9bbb4] dark:hover:bg-[#8fe0ce]/10 dark:hover:text-[#9be8d7]"
                onClick={() => onMoveUp(app)}
                title="Move up"
                aria-label="Move up"
              >
                <ArrowUp size={17} />
              </button>
            ) : null}
            {onMoveDown ? (
              <button
                className="grid h-9 w-9 place-items-center rounded text-black/45 transition hover:bg-spruce/10 hover:text-spruce dark:text-[#a9bbb4] dark:hover:bg-[#8fe0ce]/10 dark:hover:text-[#9be8d7]"
                onClick={() => onMoveDown(app)}
                title="Move down"
                aria-label="Move down"
              >
                <ArrowDown size={17} />
              </button>
            ) : null}
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
            {onDetails ? (
              <button
                className="grid h-9 w-9 place-items-center rounded text-black/45 transition hover:bg-spruce/10 hover:text-spruce dark:text-[#a9bbb4] dark:hover:bg-[#8fe0ce]/10 dark:hover:text-[#9be8d7]"
                onClick={() => onDetails(app)}
                title="App details"
                aria-label="App details"
              >
                <Info size={17} />
              </button>
            ) : null}
            {onDelete ? (
              <button
                className="grid h-9 w-9 place-items-center rounded text-black/45 transition hover:bg-coral/10 hover:text-coral dark:text-[#a9bbb4] dark:hover:bg-coral/15 dark:hover:text-[#ff9b8c]"
                onClick={() => onDelete(app)}
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
        {(app.favorite || app.category || app.tags.length > 0) ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {app.favorite ? (
              <span className="rounded bg-amber/15 px-2 py-0.5 text-xs font-semibold text-amber">
                Favorite
              </span>
            ) : null}
            {app.category ? (
              <span className="rounded bg-spruce/10 px-2 py-0.5 text-xs font-semibold text-spruce dark:text-[#9be8d7]">
                {app.category}
              </span>
            ) : null}
            {app.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded bg-black/5 px-2 py-0.5 text-xs text-black/50 dark:bg-white/10 dark:text-[#b8c7c1]"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
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
        {status ? (
          <div
            className={`mt-3 inline-flex max-w-full items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold ${
              status.ok
                ? 'bg-spruce/10 text-spruce dark:bg-[#8fe0ce]/10 dark:text-[#9be8d7]'
                : 'bg-coral/10 text-coral dark:bg-coral/15 dark:text-[#ff9b8c]'
            }`}
            title={status.error ?? undefined}
          >
            {status.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            <span className="truncate">
              {status.ok
                ? `${status.statusCode ?? 'OK'} in ${status.responseTimeMs}ms`
                : status.error ?? 'Offline'}
            </span>
          </div>
        ) : null}
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
