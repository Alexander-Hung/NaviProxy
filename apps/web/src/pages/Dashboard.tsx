import { Plus, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppCard } from '../components/AppCard';
import { api, type AppStatus, type NaviApp } from '../lib/api';

type Props = {
  onOpenAdmin: () => void;
};

export function Dashboard({ onOpenAdmin }: Props) {
  const [apps, setApps] = useState<NaviApp[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AppStatus>>({});
  const [search, setSearch] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const [nextApps, nextStatuses] = await Promise.all([
        api.listApps(),
        api.appStatuses().catch(() => [])
      ]);

      setApps(nextApps);
      setStatuses(
        Object.fromEntries(nextStatuses.map((status) => [status.id, status]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const enabledApps = apps.filter((app) => {
    const query = search.trim().toLowerCase();
    const text = [
      app.name,
      app.publicHost,
      app.category ?? '',
      ...app.tags
    ]
      .join(' ')
      .toLowerCase();

    return app.enabled && (!favoriteOnly || app.favorite) && (!query || text.includes(query));
  });

  return (
    <div className="pb-20 sm:pb-0">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase text-spruce dark:text-[#86d8c6]">
            Gateway
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-normal sm:text-4xl">
            NaviProxy
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-black/60 dark:text-[#c5d2cd]">
            A focused dashboard for the services already running across your
            homelab.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            className="grid h-11 w-11 place-items-center rounded border border-black/10 bg-white text-black/65 transition hover:text-black dark:border-white/15 dark:bg-[#18211e] dark:text-[#d7e4df] dark:hover:border-[#8fe0ce]/40 dark:hover:text-white"
            onClick={() => void load()}
            title="Refresh apps"
            aria-label="Refresh apps"
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="inline-flex h-11 items-center gap-2 rounded bg-spruce px-4 text-sm font-semibold text-white transition hover:bg-[#11564a]"
            onClick={onOpenAdmin}
          >
            <Plus size={18} />
            Add app
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded border border-coral/30 bg-coral/10 p-4 text-sm text-coral">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 rounded border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-[#141d1a] sm:grid-cols-[minmax(0,1fr),auto]">
        <input
          className="field"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search services, categories, tags"
        />
        <label className="flex h-11 items-center gap-2 text-sm font-medium text-black/70 dark:text-[#d7e4df]">
          <input
            type="checkbox"
            className="h-4 w-4 accent-spruce"
            checked={favoriteOnly}
            onChange={(event) => setFavoriteOnly(event.target.checked)}
          />
          Favorites
        </label>
      </div>

      {loading ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-[164px] animate-pulse rounded border border-black/10 bg-black/5 dark:border-white/15 dark:bg-[#18211e]"
            />
          ))}
        </div>
      ) : enabledApps.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {enabledApps.map((app) => (
            <AppCard key={app.id} app={app} status={statuses[app.id]} />
          ))}
        </div>
      ) : (
        <section className="mt-8 rounded border border-dashed border-black/20 bg-white p-8 text-center dark:border-white/20 dark:bg-[#141d1a]">
          <h2 className="text-lg font-semibold">No apps yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-black/55 dark:text-[#b8c7c1]">
            Add your first service and NaviProxy will prepare both the dashboard
            card and the reverse proxy route.
          </p>
          <button
            className="mt-5 inline-flex h-11 items-center gap-2 rounded bg-spruce px-4 text-sm font-semibold text-white transition hover:bg-[#11564a]"
            onClick={onOpenAdmin}
          >
            <Plus size={18} />
            Add app
          </button>
        </section>
      )}
    </div>
  );
}
